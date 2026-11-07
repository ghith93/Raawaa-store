/**
 * اختبارات محرّر التسعير.
 *
 * الحارس الأهم هنا: المحرّر يجب أن يرفض **كل** عرض يرفضه محرّك المتجر الحقيقي.
 * لو قبِل المحرّر عرضًا وأسقطه js/offers.js بصمت، لظنّ المالك أن العرض يعمل
 * وهو لا يعمل — وهذا أسوأ من رفض صريح.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import editor from '../owner/pricing-editor.mjs';

const source = await readFile(new URL('../js/config.js', import.meta.url), 'utf8');
const sandbox = { window: {} };
vm.runInNewContext(source, sandbox);
const config = JSON.parse(JSON.stringify(sandbox.window.RAWAA_CONFIG));

const store = { window: {} };
vm.runInNewContext(await readFile(new URL('../js/offers.js', import.meta.url), 'utf8'), store);
const offers = store.window.RawaaOffers;

test('accepts a valid price change and produces a reviewable total', () => {
  const result = editor.validatePrices(config.products, { 'serum-50': 18 });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
});

test('rejects zero, negative, non-numeric and over-precise prices', () => {
  for (const bad of [0, -3, 'abc', 12.345, Infinity]) {
    const result = editor.validatePrices(config.products, { 'serum-50': bad });
    assert.ok(result.errors.length > 0, `should reject ${bad}`);
  }
  assert.ok(editor.validatePrices(config.products, { 'unknown-size': 10 }).errors.length > 0);
});

test('warns when a larger size becomes cheaper than a smaller one, without blocking', () => {
  const result = editor.validatePrices(config.products, { 'serum-100': 10 });
  assert.deepEqual(result.errors, []);
  assert.match(result.warnings.join(' '), /أرخص/);
});

test('delivery and discount validation protects the money path', () => {
  assert.deepEqual(editor.validateDelivery({ zones: [{ id: 'hama', label: 'حماة', fee: 0 }], defaultZone: 'hama' }).errors, []);
  assert.ok(editor.validateDelivery({ zones: [{ id: 'hama', label: 'حماة', fee: -1 }], defaultZone: 'hama' }).errors.length > 0);
  assert.ok(editor.validateDelivery({ zones: [{ id: 'hama', label: 'حماة', fee: 0 }], defaultZone: 'ghost' }).errors.length > 0);
  assert.deepEqual(editor.validateDiscount(10).errors, []);
  assert.ok(editor.validateDiscount(-5).errors.length > 0);
  assert.ok(editor.validateDiscount(95).errors.length > 0);
});

test('the editor rejects every offer the real store engine would silently drop', () => {
  const cases = [
    { id: 'over-cap', label: 'سقف', type: 'percent', value: 90, enabled: true },
    { id: 'not-cheaper', label: 'أغلى', type: 'sizePrice', sizeId: 'serum-100', value: 40, enabled: true },
    { id: 'bad-qty', label: 'كمية', type: 'bundle', qty: 0, value: 20, enabled: true },
    { id: 'no-discount', label: 'بلا خصم', type: 'bundle', qty: 2, value: 50, enabled: true },
    { id: 'bad-date', label: 'تاريخ', type: 'percent', value: 10, endsAt: '30-11-2026', enabled: true },
    { id: 'ends-first', label: 'مقلوب', type: 'percent', value: 10, startsAt: '2026-12-01', endsAt: '2026-11-01', enabled: true },
    { id: 'ghost-size', label: 'حجم', type: 'sizePrice', sizeId: 'serum-999', value: 10, enabled: true }
  ];
  for (const offer of cases) {
    const mine = editor.validateOffer(offer, config.products, config.offers);
    assert.ok(mine.errors.length > 0, `editor must reject ${offer.id}`);
    // والمحرّك الحقيقي يجب أن يرفضه أيضًا — نفس الحكم.
    const prices = Object.fromEntries(config.products.map(p => [p.id, Math.round(p.price * 100)]));
    const engineVerdict = offers.evaluate({ maxPercent: config.offers.maxPercent, slots: [offer] }, prices, '2026-11-07');
    assert.equal(engineVerdict.slots.length, 0, `store engine must also drop ${offer.id}`);
  }
});

test('the editor is deliberately stricter than the engine on blank labels', () => {
  // المتجر يمرّر الاسم الأبيض لأن ' ' نص غير فارغ في JavaScript، فتظهر خانة
  // فارغة في السلة. المحرّر يرفضه عمدًا: أقبح من رفض صريح أن ينشر المالك عرضًا
  // بلا اسم. القاعدة العامة: كل ما يرفضه المتجر يرفضه المحرّر، وليس العكس.
  const blank = { id: 'blank-label', label: ' ', type: 'percent', value: 10, enabled: true };
  assert.ok(editor.validateOffer(blank, config.products, config.offers).errors.length > 0);
});

test('the editor accepts offers the store engine also accepts', () => {
  const good = [
    { id: 'launch-15', label: 'عرض الإطلاق', type: 'percent', value: 15, enabled: true, endsAt: '2026-12-31' },
    { id: 'two-50', label: 'عبوتان للاستعمال اليومي', type: 'bundle', qty: 2, sizeId: 'serum-50', value: 29, enabled: true },
    { id: 'big-100', label: 'سعر خاص للكبيرة', type: 'sizePrice', sizeId: 'serum-100', value: 22, enabled: true }
  ];
  for (const offer of good) {
    assert.deepEqual(editor.validateOffer(offer, config.products, config.offers).errors, [], `should accept ${offer.id}`);
    const prices = Object.fromEntries(config.products.map(p => [p.id, Math.round(p.price * 100)]));
    const engineVerdict = offers.evaluate({ maxPercent: config.offers.maxPercent, slots: [offer] }, prices, '2026-11-07');
    assert.equal(engineVerdict.slots.length, 1, `store engine should also accept ${offer.id}`);
  }
});

test('duplicate offer ids are surfaced as a warning', () => {
  const result = editor.validateOffers([
    { id: 'same', label: 'عرض أول', type: 'percent', value: 10, enabled: true },
    { id: 'same', label: 'عرض ثانٍ', type: 'percent', value: 12, enabled: true }
  ], config.products, config.offers);
  assert.deepEqual(result.errors, []);
  assert.match(result.warnings.join(' '), /مكرر/);
});

test('the price matrix shows exactly what a customer pays, per zone and method', () => {
  const rows = editor.priceMatrix(config, { 'serum-50': 18 });
  assert.equal(rows.length, config.products.length * config.delivery.zones.length * config.payment.methods.length);
  const hamaSham = rows.find(r => r.productId === 'serum-50' && r.zoneId === 'hama' && r.methodId === 'shamcash');
  assert.equal(hamaSham.subtotal, 18);
  assert.equal(hamaSham.discountCents, 180);
  assert.equal(hamaSham.deliveryCents, 0, 'التوصيل مجاني وفق السياسة المعتمدة');
  assert.equal(hamaSham.total, 16.2);

  const otherCod = rows.find(r => r.productId === 'serum-50' && r.zoneId === 'other' && r.methodId === 'cod');
  assert.equal(otherCod.total, 18, 'الاستلام بلا خصم وبلا رسوم توصيل');
});

test('applyPricesToSource edits only the named size and leaves comments intact', () => {
  const { source: next, applied } = editor.applyPricesToSource(source, { 'serum-50': 19 });
  assert.equal(applied.length, 1);
  assert.deepEqual(applied[0], { id: 'serum-50', from: 16, to: 19 });
  const reloaded = { window: {} };
  vm.runInNewContext(next, reloaded);
  assert.equal(reloaded.window.RAWAA_CONFIG.products.find(p => p.id === 'serum-50').price, 19);
  assert.equal(reloaded.window.RAWAA_CONFIG.products.find(p => p.id === 'serum-30').price, 13);
  assert.equal(reloaded.window.RAWAA_CONFIG.products.find(p => p.id === 'serum-100').price, 25);
  // التعليقات التوثيقية لا تُفقد — فرق صغير يراجعه المالك بسهولة.
  assert.ok(next.includes('المصدر المركزي لإعدادات العلامة'));
});

test('applyPricesToSource is a no-op when nothing changed', () => {
  const { source: next, applied } = editor.applyPricesToSource(source, {});
  assert.deepEqual(applied, []);
  assert.equal(next, source);
});

test('rendered offer lines are valid JavaScript that the config parser accepts', () => {
  const line = editor.renderOfferLine({ id: 'trial', label: 'تجربة', type: 'percent', value: 12, enabled: true, badge: 'تجربة' });
  const wrapped = `(function(){ window.OUT = [\n${line}\n]; })();`;
  const box = { window: {} };
  vm.runInNewContext(wrapped, box);
  assert.equal(JSON.stringify(box.window.OUT), JSON.stringify([{ id: 'trial', label: 'تجربة', type: 'percent', value: 12, enabled: true, badge: 'تجربة' }]));
});

test('the change summary spells out direction and amount for the owner', () => {
  const lines = editor.summarizeChange(config, { prices: { 'serum-50': 18, 'serum-30': 13 } });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /زيادة/);
  assert.match(lines[0], /\$16/);
  assert.match(lines[0], /\$18/);
  assert.deepEqual(editor.summarizeChange(config, { prices: {} }), []);
});
