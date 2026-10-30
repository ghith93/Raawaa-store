import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { prepareOrder, formatOwnerAlert } from './order-core.mjs';

const source = await readFile(new URL('../js/config.js', import.meta.url), 'utf8');
const sandbox = { window: {} };
vm.runInNewContext(source, sandbox);
const cfg = sandbox.window.RAWAA_CONFIG;
const base = { name: 'زبونة تجريبية', phone: '0991234567', address: 'حماة', items: [{ id: 'serum-50', qty: 1 }], zone: 'hama', method: 'shamcash' };

test('uses trusted configuration and calculates fragrance and sham cash in cents', () => {
  const order = prepareOrder({ ...base, scent: 'vanilla', oil: 'argan', totalCents: 1 }, cfg);
  assert.equal(order.subtotalCents, 2800);
  assert.equal(order.discountCents, 280);
  assert.equal(order.deliveryCents, 0);
  assert.equal(order.totalCents, 2520);
  assert.equal(order.oilPricePending, true);
  assert.equal(order.status, 'pending_review');
});

test('both delivery methods and zones use store rules', () => {
  const expected = { 'hama:shamcash': 2340, 'hama:cod': 2800, 'other:shamcash': 2740, 'other:cod': 3000 };
  for (const [choice, total] of Object.entries(expected)) {
    const [zone, method] = choice.split(':');
    assert.equal(prepareOrder({ ...base, zone, method }, cfg).totalCents, total);
  }
});

test('multiple sizes charge fragrance for each unit and unscented is free', () => {
  const items = [{ id: 'serum-30', qty: 2 }, { id: 'serum-100', qty: 1 }];
  assert.equal(prepareOrder({ ...base, items, scent: 'rose', method: 'cod' }, cfg).totalCents, 7500);
  assert.equal(prepareOrder({ ...base, items, scent: 'unscented', method: 'cod' }, cfg).totalCents, 6900);
});

test('fails closed on malformed contact, products, quantities, options and delivery', () => {
  const invalid = [
    { phone: 'x' }, { address: '' }, { name: '\n\u0001' }, { items: [] },
    { items: [{ id: 'unknown', qty: 1 }] }, { items: [{ id: 'serum-30', qty: 11 }] },
    { items: [{ id: 'serum-30', qty: 1 }, { id: 'serum-30', qty: 1 }] },
    { zone: 'elsewhere' }, { method: 'fake' }, { scent: 'fake' }, { oil: 'fake' },
    { scent: 'custom' }, { oil: 'other' }
  ];
  for (const change of invalid) assert.throws(() => prepareOrder({ ...base, ...change }, cfg));
});

test('notification contains only a valid reference, not customer details', () => {
  const alert = formatOwnerAlert('RAWAA-1234AB');
  assert.match(alert, /RAWAA-1234AB/);
  assert.ok(!alert.includes(base.phone));
  assert.throws(() => formatOwnerAlert('<bad>'));
});

test('phone requires seven actual digits and permits familiar Syrian and Arabic-Indic formats', () => {
  for (const phone of ['0991234567', '+963 991 234 567', '٠٩٩١٢٣٤٥٦٧', '+٩٦٣ (٩٩١) ٢٣٤-٥٦٧', '123-4567']) {
    assert.equal(prepareOrder({ ...base, phone }, cfg).phone, phone);
  }
  for (const phone of ['-------', '+(--- ---)', '12 - ٣٤٥٦', '12+34567', '++963991234567', '1234567+']) {
    assert.throws(() => prepareOrder({ ...base, phone }, cfg), /INVALID_PHONE/);
  }
  assert.throws(() => prepareOrder({ ...base, phone:'123\n4567' }, cfg), /INVALID_CONTACT/);
  assert.throws(() => prepareOrder({ ...base, phone:'1'.repeat(31) }, cfg), /INVALID_CONTACT/);
});

test('same offer engine as the browser: server total matches the storefront', () => {
  const withOffer = { ...cfg, offers: { maxPercent: 30, slots: [
    { id: 'half', label: 'عرض', type: 'percent', value: 10, sizeId: 'serum-50', enabled: true }
  ] } };
  // 50 مل × 1: 26 ← 23.40، ثم شام كاش −10% ← 21.06 داخل حماة (توصيل مجاني)
  const order = prepareOrder({ ...base, items: [{ id: 'serum-50', qty: 1 }] }, withOffer);
  assert.equal(order.offerCents, 260);
  assert.equal(order.subtotalCents, 2340);
  assert.equal(order.totalCents, 2106);
  // والحجم الآخر لا يتأثر بالعرض المقيَّد
  assert.equal(prepareOrder({ ...base, items: [{ id: 'serum-30', qty: 1 }] }, withOffer).totalCents, 1710);
});

test('bundle offer: the server charges the package price, not qty × unit', () => {
  const withBundle = { ...cfg, offers: { maxPercent: 30, slots: [
    { id: 'two-50', label: 'عبوتان', type: 'bundle', qty: 2, sizeId: 'serum-50', value: 46, enabled: true }
  ] } };
  const order = prepareOrder({ ...base, items: [{ id: 'serum-50', qty: 2 }], method: 'cod' }, withBundle);
  assert.equal(order.offerCents, 600);       // 52 − 46
  assert.equal(order.subtotalCents, 4600);
  assert.equal(order.totalCents, 4800);      // + توصيل حماة 2$
  // 3 عبوات = عبوتان + واحدة بسعرها
  const three = prepareOrder({ ...base, items: [{ id: 'serum-50', qty: 3 }], method: 'cod' }, withBundle);
  assert.equal(three.subtotalCents, 7200);
  assert.equal(three.totalCents, 7400);
});
