/**
 * اختبار تكامل السلة مع العروض — يعمل في Node عبر jsdom، بلا متصفح وبلا شبكة.
 *
 * يحمّل صفحة المنتج الحقيقية (index.html)، ثم يحقن خانات عروض قبل تشغيل cart.js،
 * ويتحقق من: السعر المعروض في بطاقة الحجم، السلة، الإجمالي، رسالة واتساب،
 * واختفاء العرض بعد انتهائه، وسقوط نسبة فوق السقف.
 *
 * التشغيل: node --test scripts/cart-offers.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const root = new URL('../', import.meta.url);
const read = (file) => readFile(new URL(file, root), 'utf8');

const html = (await read('index.html')).replace(/<script[\s\S]*?<\/script>/g, '');
const serumHtml = (await read('serum.html')).replace(/<script[\s\S]*?<\/script>/g, '');
const serumViewsJs = await read('js/serum-views.js');
const offersJs = await read('js/offers.js');
const cartJs = await read('js/cart.js');
const configJs = await read('js/config.js');

/** نافذة كاملة بسلوك مطابق للموقع، مع خانات عروض مُحقَنة قبل تحميل السلة. */
async function boot(slots, pageHtml) {
  const dom = new JSDOM(pageHtml || html, {
    url: 'https://raawaa-store.pages.dev/',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const { window } = dom;
  // jsdom بلا محرّك عرض: بدائل صامتة لما يستخدمه الموقع من واجهات المتصفح.
  window.matchMedia = window.matchMedia || function () {
    return { matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} };
  };
  window.IntersectionObserver = window.IntersectionObserver || class {
    observe() {} unobserve() {} disconnect() {}
  };
  window.scrollTo = () => {};

  // ننتظر دورة الحدث حتى يُغلق jsdom مرحلة التحميل، فيعمل boot في cart.js فورًا.
  await new Promise((resolve) => setTimeout(resolve, 0));

  window.eval(configJs);
  // الإعدادات المجمّدة تُنسخ قبل الحقن — cart.js يقرأ window.RAWAA_CONFIG عند تحميله.
  const clone = JSON.parse(JSON.stringify(window.RAWAA_CONFIG));
  clone.offers.slots = slots;
  window.RAWAA_CONFIG = clone;
  window.eval(offersJs);
  window.eval(cartJs);
  if (pageHtml) window.eval(serumViewsJs);
  return window;
}

const NO_OFFER = [];
const HALF_50 = [{
  id: 'half', label: 'عرض نصف', type: 'percent', value: 10,
  sizeId: 'serum-50', enabled: true, badge: '−10%'
}];

test('بلا عروض: الأسعار كما هي 19 / 26 / 29', async () => {
  const w = await boot(NO_OFFER);
  const shown = [...w.document.querySelectorAll('#products .size-option-price')].map((n) => n.textContent.trim());
  assert.deepEqual(shown, ['$19', '$26', '$29']);

  const api = w.__RAWAA_TEST__;
  api.addToCart('serum-50');
  api.setMethod('cod', true);
  const totals = api.totals();
  assert.equal(totals.subtotal, 26);
  assert.equal(totals.offer, 0);
  assert.equal(totals.delivery, 2, 'الدفع عند الاستلام داخل حماة = 2$');
  assert.equal(totals.amount, 28);
  assert.equal(w.document.querySelector('[data-row-offer]').hidden, true);
});

test('عرض 10% على 50 مل يظهر قبل/بعد ويُحتسب في السلة', async () => {
  const w = await boot(HALF_50);
  const doc = w.document;

  const priceNode = doc.querySelector('[data-size-for="serum-50"] .size-option-price');
  assert.equal(priceNode.textContent.replace(/\s+/g, ' ').trim(), '$26 $23.40');
  assert.ok(priceNode.querySelector('s'), 'السعر القديم مشطوب لا محذوف');
  const flag = doc.querySelector('[data-size-for="serum-50"] .size-option-flag--offer');
  assert.equal(flag.textContent, '−10% · عرض نصف');
  assert.equal(doc.querySelector('[data-size-for="serum-30"] .size-option-flag--offer'), null);

  const api = w.__RAWAA_TEST__;
  api.addToCart('serum-50');
  api.setMethod('cod', true);
  const totals = api.totals();
  assert.equal(totals.subtotal, 26, 'قيمة المنتجات تبقى السعر المعلن');
  assert.equal(totals.offer, 2.6, 'قيمة العرض ظاهرة كخصم مستقل');
  assert.equal(totals.net, 23.4);
  assert.equal(totals.amount, 25.4, '23.40 + 2$ توصيل حماة');

  const row = doc.querySelector('[data-row-offer]');
  assert.equal(row.hidden, false);
  assert.equal(doc.querySelector('[data-cart-offer]').textContent, '− $2.60');
  assert.match(doc.querySelector('[data-offer-label]').textContent, /عرض نصف/);

  const msg = api.buildOrderMessage();
  assert.match(msg, /23\.40/);
  assert.match(msg, /بدل \$26/);
  assert.match(msg, /خصم عرض «عرض نصف»: − \$2\.60/);
  assert.match(msg, /قيمة المنتجات: \$26/);
  assert.match(msg, /المجموع المرجعي: \$25\.40/);
});

test('العرض المقيَّد بحجم لا يمسّ بقية الأحجام', async () => {
  const w = await boot(HALF_50);
  const api = w.__RAWAA_TEST__;
  api.setMethod('cod', true);
  api.addToCart('serum-30');
  api.addToCart('serum-30');
  assert.equal(api.totals().amount, 40);   // 19×2 + 2 توصيل
  api.addToCart('serum-50');
  assert.equal(api.totals().offer, 2.6);
  assert.equal(api.totals().net, 61.4);    // 19 + 19 + 23.40
  assert.equal(api.totals().amount, 63.4);
});

test('تراكم العرض مع شام كاش: العرض أولًا ثم 10% ثم التوصيل', async () => {
  const w = await boot(HALF_50);
  const api = w.__RAWAA_TEST__;
  api.addToCart('serum-50');
  api.setMethod('shamcash', true);
  api.setZone('hama', true);
  const t = api.totals();
  assert.equal(t.net, 23.4);
  assert.equal(t.discount, 2.34, 'خصم شام كاش يُحسب على السعر بعد العرض');
  assert.equal(t.delivery, 0, 'توصيل مجاني داخل حماة مع شام كاش');
  assert.equal(t.amount, 21.06);
});

test('عرض منتهٍ لا يُطبَّق ويبقى السعر الأصلي', async () => {
  const past = [{
    id: 'old', label: 'عرض قديم', type: 'percent', value: 20,
    enabled: true, endsAt: '2020-01-01'
  }];
  const w = await boot(past);
  const api = w.__RAWAA_TEST__;
  api.addToCart('serum-100');
  api.setMethod('cod', true);
  assert.equal(api.totals().offer, 0);
  assert.equal(api.totals().amount, 31);   // 29 + 2 توصيل
  assert.equal(w.document.querySelector('[data-row-offer]').hidden, true);
});

test('نسبة فوق السقف تُهمَل ولا تغيّر السعر', async () => {
  const reckless = [{ id: 'typo', label: 'خطأ مطبعي', type: 'percent', value: 90, enabled: true }];
  const w = await boot(reckless);
  const api = w.__RAWAA_TEST__;
  api.addToCart('serum-100');
  api.setMethod('cod', true);
  assert.equal(api.totals().offer, 0);
  assert.equal(api.totals().amount, 31);
});

test('سعر خاص لحجم يُعرض ويُحتسب كسعر جديد', async () => {
  const w = await boot([{ id: 'big', label: 'سهرة', type: 'sizePrice', sizeId: 'serum-100', value: 26, enabled: true }]);
  const node = w.document.querySelector('[data-size-for="serum-100"] .size-option-price');
  assert.equal(node.textContent.replace(/\s+/g, ' ').trim(), '$29 $26');
  const api = w.__RAWAA_TEST__;
  api.addToCart('serum-100');
  api.setMethod('shamcash', true);
  api.setZone('other', true);
  // 26 − 2.60 (شام كاش) + 4 (توصيل المحافظات) = 27.40
  assert.equal(api.totals().amount, 27.4);
});

test('صفحة السيروم تحمل العرض نفسه ولا تختلف عن الرئيسية', async () => {
  const w = await boot(HALF_50, serumHtml);
  const node = w.document.querySelector('[data-size-for="serum-50"] .size-option-price');
  assert.equal(node.textContent.replace(/\s+/g, ' ').trim(), '$26 $23.40');
  const api = w.__RAWAA_TEST__;
  api.addToCart('serum-50');
  api.setMethod('shamcash', true);
  assert.equal(api.totals().amount, 21.06);
  assert.equal(w.document.querySelector('[data-cart-offer]').textContent, '− $2.60');
});
