import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const window = {};
vm.runInNewContext(readFileSync(new URL('../js/config.js', import.meta.url), 'utf8'), { window });
const config = window.RAWAA_CONFIG;
const doc = readFileSync(new URL('../docs/SALES-VIDEO-STRATEGY-AR.md', import.meta.url), 'utf8');

test('video strategy is clearly draft-only and keeps approved product prices current', () => {
  assert.match(doc, /مسودة داخلية للمراجعة/);
  assert.match(doc, /لا نشر ولا إعلان مدفوع/);
  assert.match(doc, /لا توجد في المستودع مبيعات محلية/);
  for (const product of config.products) {
    assert.ok(doc.includes(`${product.sizeLabel} — $${product.price}`), `missing current reference price for ${product.sizeLabel}`);
  }
  assert.match(doc, /فتح واتساب وحده لا يرسل طلبك/);
  assert.match(doc, /التوفر والإجمالي ورسوم التوصيل/);
  assert.doesNotMatch(doc, /utm_content=size_guide/);
});

test('video payment examples recalculate from the store config', () => {
  const product = config.products.find(item => item.id === 'serum-50');
  const shamCash = config.payment.methods.find(method => method.id === 'shamcash');
  const cod = config.payment.methods.find(method => method.id === 'cod');
  const hama = config.delivery.zones.find(zone => zone.id === 'hama');
  const other = config.delivery.zones.find(zone => zone.id === 'other');
  const shamDiscounted = product.price * (1 - shamCash.discountPercent / 100);
  const totals = [
    shamDiscounted + (hama.freeWithShamCash ? 0 : hama.fee),
    shamDiscounted + other.fee,
    product.price + hama.fee,
    product.price + other.fee
  ].map(value => `$${value.toFixed(2)}`);
  for (const total of totals) assert.ok(doc.includes(total), `missing current reference total ${total}`);
  assert.ok(doc.includes(`خصم ${shamCash.discountPercent}%`));
  assert.ok(doc.includes(`إضافة العطر $${config.customization.scentPrice}`));
});
