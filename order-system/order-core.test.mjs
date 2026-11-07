import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { prepareOrder, formatOwnerAlert } from './order-core.mjs';
import pricing from './order-pricing.js';

const source = await readFile(new URL('../js/config.js', import.meta.url), 'utf8');
const sandbox = { window: {} };
vm.runInNewContext(source, sandbox);
const cfg = sandbox.window.RAWAA_CONFIG;
const base = { name: 'زبونة تجريبية', phone: '0991234567', address: 'حماة', items: [{ id: 'serum-50', qty: 1 }], zone: 'hama', method: 'shamcash' };

test('uses trusted configuration and calculates fragrance and sham cash in cents', () => {
  const order = prepareOrder({ ...base, scent: 'vanilla', oil: 'argan', totalCents: 1 }, cfg);
  assert.equal(order.subtotalCents, 1800);
  // الخصم على المنتج (1600) وحده = 160؛ العطر (200) يدخل المجموع بلا خصم.
  assert.equal(order.discountCents, 160);
  assert.equal(order.deliveryCents, 0);
  assert.equal(order.totalCents, 1640);
  assert.equal(order.oilPricePending, true);
  assert.equal(order.status, 'pending_review');
});

test('both delivery methods and zones use store rules', () => {
  // سياسة 7 نوفمبر 2026: التوصيل مجاني دائمًا، وخصم 10% لشام كاش على المنتجات.
  const expected = { 'hama:shamcash': 1440, 'hama:cod': 1600, 'other:shamcash': 1440, 'other:cod': 1600 };
  for (const [choice, total] of Object.entries(expected)) {
    const [zone, method] = choice.split(':');
    assert.equal(prepareOrder({ ...base, zone, method }, cfg).totalCents, total);
  }
});

test('multiple sizes charge fragrance for each unit and unscented is free', () => {
  const items = [{ id: 'serum-30', qty: 2 }, { id: 'serum-100', qty: 1 }];
  assert.equal(prepareOrder({ ...base, items, scent: 'rose', method: 'cod' }, cfg).totalCents, 5700);
  assert.equal(prepareOrder({ ...base, items, scent: 'unscented', method: 'cod' }, cfg).totalCents, 5100);
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

test('the browser estimate matches server preparation across offers, options and delivery methods', () => {
  const cases = [
    { items: [{ id: 'serum-30', qty: 1 }], zone: 'hama', method: 'shamcash', scent: 'vanilla', oil: '' },
    { items: [{ id: 'serum-50', qty: 2 }], zone: 'other', method: 'cod', scent: 'unscented', oil: 'argan' },
    { items: [{ id: 'serum-100', qty: 1 }], zone: 'other', method: 'shamcash', scent: 'rose', oil: '' }
  ];
  const withBundle = { ...cfg, offers: { maxPercent: 30, slots: [
    { id: 'two-50', label: 'عبوتان', type: 'bundle', qty: 2, sizeId: 'serum-50', value: 30, enabled: true }
  ] } };
  assert.throws(() => pricing.calculateOrderEstimate(cases[0], withBundle, null), /PRICING_UNAVAILABLE/);
  cases.push({ items: [{ id: 'serum-50', qty: 2 }], zone: 'hama', method: 'cod', scent: 'unscented', oil: '' });

  for (const [index, selection] of cases.entries()) {
    const config = index === cases.length - 1 ? withBundle : cfg;
    const preview = pricing.calculateOrderEstimate(selection, config);
    const order = prepareOrder({ ...base, ...selection, totalCents: 1 }, config);
    for (const key of ['entries', 'subtotalCents', 'offerCents', 'discountCents', 'deliveryCents', 'totalCents', 'oilPricePending']) {
      assert.deepEqual(preview[key], order[key], `${key} mismatch for case ${index + 1}`);
    }
  }
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
  // 50 مل × 1: 16 ← 14.40، ثم شام كاش −10% ← 12.96 داخل حماة (توصيل مجاني)
  const order = prepareOrder({ ...base, items: [{ id: 'serum-50', qty: 1 }] }, withOffer);
  assert.equal(order.offerCents, 160);
  assert.equal(order.subtotalCents, 1440);
  assert.equal(order.totalCents, 1296);
  // والحجم الآخر لا يتأثر بالعرض المقيَّد
  assert.equal(prepareOrder({ ...base, items: [{ id: 'serum-30', qty: 1 }] }, withOffer).totalCents, 1170);
});

test('bundle offer: the server charges the package price, not qty × unit', () => {
  const withBundle = { ...cfg, offers: { maxPercent: 30, slots: [
    { id: 'two-50', label: 'عبوتان', type: 'bundle', qty: 2, sizeId: 'serum-50', value: 30, enabled: true }
  ] } };
  const order = prepareOrder({ ...base, items: [{ id: 'serum-50', qty: 2 }], method: 'cod' }, withBundle);
  assert.equal(order.offerCents, 200);       // 32 − 30
  assert.equal(order.subtotalCents, 3000);
  assert.equal(order.totalCents, 3000);      // التوصيل مجاني الآن (سياسة 7 نوفمبر 2026)
  // 3 عبوات = عبوتان + واحدة بسعرها
  const three = prepareOrder({ ...base, items: [{ id: 'serum-50', qty: 3 }], method: 'cod' }, withBundle);
  assert.equal(three.subtotalCents, 4600);
  assert.equal(three.totalCents, 4600);      // بلا رسوم توصيل
});

test('scent surcharge is never discounted by the payment method', () => {
  const items = [{ id: 'serum-50', qty: 2 }];
  const plain = prepareOrder({ ...base, items, scent: 'unscented', method: 'shamcash' }, cfg);
  const scented = prepareOrder({ ...base, items, scent: 'rose', method: 'shamcash' }, cfg);
  // نفس الخصم في الحالتين؛ الفرق في الإجمالي هو قيمة العطر كاملة فقط.
  assert.equal(scented.discountCents, plain.discountCents);
  assert.equal(scented.totalCents - plain.totalCents, 2 * Math.round(cfg.customization.scentPrice * 100));
});
