/**
 * حارس العقد بين البناء والمراقبة.
 *
 * هذا الملف موجود لأن عطلًا حقيقيًا عاش ٧ دورات مراقبة دون اكتشاف:
 * البناء ينشر `config.js` بصياغة، والمراقب يقرأ بصياغة أخرى، وكل اختبار كان
 * يفحص «دالة الاستخراج على نص المصدر» فقط. الفجوة كانت في **مخرَج البناء** نفسه.
 *
 * القاعدة التي يحرسها هذا الملف:
 *   ١. نسخة النشر قابلة للقراءة بدالة المراقبة نفسها.
 *   ٢. قيم الطلب الحرجة في نسخة النشر مطابقة للمصدر تمامًا.
 *   ٣. الحقول الداخلية غائبة، وأي حقل داخلي جديد غير مسجّل يفشل هنا.
 *   ٤. الصياغة الغريبة تفشل مغلقًا، لا تُمرَّر بصمت.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readPublishedConfig, renderPublishedConfig } from '../scripts/lib/public-config.mjs';
import { readOrderConfig, diffOrderConfig, extractOrderConfig, orderConfigFromObject } from '../scripts/order-config-monitor.mjs';

const source = await readFile(new URL('../js/config.js', import.meta.url), 'utf8');
const built = renderPublishedConfig(source);

test('the published config is readable by the same monitor that reads the source', () => {
  const fromSource = readOrderConfig(source, { label: 'source' });
  const fromPublished = readOrderConfig(built.output, { label: 'published' });
  assert.deepEqual(fromPublished, fromSource);
});

test('published and source agree on every order-critical value', () => {
  const fromSource = readOrderConfig(source);
  const fromPublished = readOrderConfig(built.output);
  assert.deepEqual(diffOrderConfig(fromSource, fromPublished), []);
});

test('prices, delivery and payment rules survive publishing unchanged', () => {
  const live = readPublishedConfig(built.output);
  assert.deepEqual(live.products.map(p => [p.id, p.sizeMl, p.price]), [
    ['serum-30', 30, 13], ['serum-50', 50, 16], ['serum-100', 100, 25]
  ]);
  assert.deepEqual(live.delivery.zones.map(z => [z.id, z.fee]), [['hama', 0], ['other', 2]]);
  assert.equal(live.payment.methods.find(m => m.id === 'shamcash').discountPercent, 10);
});

test('internal cost and integration notes never reach the published file', () => {
  assert.ok(!built.output.includes('costing'), 'costing leaked into published config');
  assert.ok(!built.output.includes('apiNote'), 'apiNote leaked into published config');
  assert.ok(!built.output.includes('unitCost'), 'cost fields leaked into published config');
  assert.deepEqual(built.removed.sort(), ['costing', 'payment.methods[].apiNote']);
});

test('the published file is frozen against runtime mutation', () => {
  // deepFreeze is part of the contract: a public config that can be mutated at
  // runtime would let any injected script rewrite prices in the DOM.
  assert.match(built.output, /Object\.freeze/);
  assert.match(built.output, /deepFreeze/);
});

test('a price change in the source flows into the published file and is detected', () => {
  const raised = source.replace('price: 16,', 'price: 17,');
  const published = renderPublishedConfig(raised);
  const live = readOrderConfig(published.output);
  assert.equal(live.products.find(p => p.id === 'serum-50').price, 17);
  assert.deepEqual(
    diffOrderConfig(readOrderConfig(source), live),
    ['products'],
    'a changed price must show up as a products mismatch'
  );
});

test('fails closed on a config that is neither source nor published format', () => {
  assert.throws(() => readOrderConfig('just some text'), /unrecognised config format/);
  assert.throws(() => readOrderConfig(''), /unrecognised config format/);
  assert.throws(() => readOrderConfig('<html></html>'), /unrecognised config format/);
});

test('fails closed when the published object is missing order-critical parts', () => {
  assert.throws(() => orderConfigFromObject({ products: [] }), /published/);
  assert.throws(
    () => orderConfigFromObject({ products: [{ id: 'a', sizeMl: 1, price: 1 }], delivery: {}, payment: {} }),
    /published/
  );
  // A published file whose products were tampered with must not silently pass.
  const broken = built.output.replace('"sizeMl": 50', '"sizeMl": 500');
  assert.throws(() => {
    const live = readOrderConfig(broken);
    assert.deepEqual(diffOrderConfig(readOrderConfig(source), live), []);
  }, /AssertionError|Expected values/);
});

test('the source extractor still refuses unsupported payment methods', () => {
  assert.throws(() => extractOrderConfig(source.replace("id: 'cod',", "id: 'other-method',")));
});

test('rendering is deterministic so the build gate can rely on it', () => {
  const again = renderPublishedConfig(source);
  assert.equal(again.output, built.output);
});
