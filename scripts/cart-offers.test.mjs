/**
 * اختبار تكامل السلة مع العروض — يعمل في Node عبر jsdom، بلا متصفح وبلا شبكة.
 *
 * يحمّل صفحة المنتج الحقيقية (serum.html)، ثم يحقن خانات عروض قبل تشغيل cart.js،
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

const serumHtml = (await read('serum.html')).replace(/<script[\s\S]*?<\/script>/g, '');
const html = serumHtml;
const serumViewsJs = await read('js/serum-views.js');
const offersJs = await read('js/offers.js');
const cartJs = await read('js/cart.js');
const configJs = await read('js/config.js');

/** نافذة كاملة بسلوك مطابق للموقع، مع خانات عروض مُحقَنة قبل تحميل السلة. */
async function boot(slots, pageHtml = serumHtml) {
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

test('بلا عروض: الأسعار كما هي 13 / 16 / 25', async () => {
  const w = await boot(NO_OFFER);
  const shown = [...w.document.querySelectorAll('#products .size-option-price')].map((n) => n.textContent.trim());
  assert.deepEqual(shown, ['$13', '$16', '$25']);
  const unitNode = w.document.querySelector('[data-unit-live]');
  assert.ok(unitNode && !unitNode.classList.contains('sr-only'), 'سعر الوحدة ليس مخفيًا بصريًا');
  assert.match(unitNode.textContent, /\$0\.32/);
  w.document.querySelector('[data-size-for="serum-30"] input').click();
  assert.match(unitNode.textContent, /\$0\.43/, '30 مل = 13 ÷ 30');
  w.document.querySelector('[data-size-for="serum-100"] input').click();
  assert.match(unitNode.textContent, /\$0\.25/, '100 مل = 25 ÷ 100');

  const api = w.__RAWAA_TEST__;
  api.addToCart('serum-50');
  api.setMethod('cod', true);
  const totals = api.totals();
  assert.equal(totals.subtotal, 16);
  assert.equal(totals.offer, 0);
  assert.equal(totals.delivery, 0, 'التوصيل داخل حماة مجاني مع الدفع عند الاستلام');
  assert.equal(totals.amount, 16);
  assert.equal(w.document.querySelector('[data-row-offer]').hidden, true);
});

test('عرض 10% على 50 مل يظهر قبل/بعد ويُحتسب في السلة', async () => {
  const w = await boot(HALF_50);
  const doc = w.document;

  const priceNode = doc.querySelector('[data-size-for="serum-50"] .size-option-price');
  assert.equal(priceNode.textContent.replace(/\s+/g, ' ').trim(), '$16 $14.40');
  assert.ok(priceNode.querySelector('s'), 'السعر القديم مشطوب لا محذوف');
  const flag = doc.querySelector('[data-size-for="serum-50"] .size-option-flag--offer');
  assert.equal(flag.textContent, '−10% · عرض نصف');
  assert.match(doc.querySelector('[data-unit-live]').textContent, /\$0\.29/, 'سعر الوحدة يتبع السعر بعد عرض الحجم');
  assert.equal(doc.querySelector('[data-size-for="serum-30"] .size-option-flag--offer'), null);

  const api = w.__RAWAA_TEST__;
  api.addToCart('serum-50');
  api.setMethod('cod', true);
  const totals = api.totals();
  assert.equal(totals.subtotal, 16, 'قيمة المنتجات تبقى السعر المعلن');
  assert.equal(totals.offer, 1.6, 'قيمة العرض ظاهرة كخصم مستقل');
  assert.equal(totals.net, 14.4);
  assert.equal(totals.amount, 14.4, '14.40 + توصيل حماة المجاني');

  const row = doc.querySelector('[data-row-offer]');
  assert.equal(row.hidden, false);
  assert.equal(doc.querySelector('[data-cart-offer]').textContent, '− $1.60');
  assert.match(doc.querySelector('[data-offer-label]').textContent, /عرض نصف/);

  const msg = api.buildOrderMessage();
  assert.match(msg, /14\.40/);
  assert.match(msg, /بدل \$16/);
  assert.match(msg, /خصم عرض «عرض نصف»: − \$1\.60/);
  assert.match(msg, /قيمة المنتجات: \$16/);
  assert.match(msg, /المجموع المرجعي: \$14\.40/);
});

test('العرض المقيَّد بحجم لا يمسّ بقية الأحجام', async () => {
  const w = await boot(HALF_50);
  const api = w.__RAWAA_TEST__;
  api.setMethod('cod', true);
  api.addToCart('serum-30');
  api.addToCart('serum-30');
  assert.equal(api.totals().amount, 26);   // 13×2 + توصيل حماة المجاني
  api.addToCart('serum-50');
  assert.equal(api.totals().offer, 1.6);
  assert.equal(api.totals().net, 40.4);    // 13 + 13 + 14.40
  assert.equal(api.totals().amount, 40.4);
});

test('تراكم العرض مع شام كاش: العرض أولًا ثم 10% ثم التوصيل', async () => {
  const w = await boot(HALF_50);
  const api = w.__RAWAA_TEST__;
  api.addToCart('serum-50');
  api.setMethod('shamcash', true);
  api.setZone('hama', true);
  const t = api.totals();
  assert.equal(t.net, 14.4);
  assert.equal(t.discount, 1.44, 'خصم شام كاش يُحسب على السعر بعد العرض');
  assert.equal(t.delivery, 0, 'توصيل مجاني داخل حماة مع شام كاش');
  assert.equal(t.amount, 12.96);
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
  assert.equal(api.totals().amount, 25);   // 25 + توصيل حماة المجاني
  assert.equal(w.document.querySelector('[data-row-offer]').hidden, true);
});

test('نسبة فوق السقف تُهمَل ولا تغيّر السعر', async () => {
  const reckless = [{ id: 'typo', label: 'خطأ مطبعي', type: 'percent', value: 90, enabled: true }];
  const w = await boot(reckless);
  const api = w.__RAWAA_TEST__;
  api.addToCart('serum-100');
  api.setMethod('cod', true);
  assert.equal(api.totals().offer, 0);
  assert.equal(api.totals().amount, 25);
});

test('سعر خاص لحجم يُعرض ويُحتسب كسعر جديد', async () => {
  const w = await boot([{ id: 'big', label: 'سهرة', type: 'sizePrice', sizeId: 'serum-100', value: 20, enabled: true }]);
  const node = w.document.querySelector('[data-size-for="serum-100"] .size-option-price');
  assert.equal(node.textContent.replace(/\s+/g, ' ').trim(), '$25 $20');
  const api = w.__RAWAA_TEST__;
  api.addToCart('serum-100');
  api.setMethod('shamcash', true);
  api.setZone('other', true);
  // 20 − 2 (شام كاش) + 2 (توصيل المحافظات) = 20
  assert.equal(api.totals().amount, 20);
});

test('صفحة السيروم تحمل العرض نفسه ولا تختلف عن الرئيسية', async () => {
  const w = await boot(HALF_50, serumHtml);
  const node = w.document.querySelector('[data-size-for="serum-50"] .size-option-price');
  assert.equal(node.textContent.replace(/\s+/g, ' ').trim(), '$16 $14.40');
  const api = w.__RAWAA_TEST__;
  api.addToCart('serum-50');
  api.setMethod('shamcash', true);
  assert.equal(api.totals().amount, 12.96);
  assert.equal(w.document.querySelector('[data-cart-offer]').textContent, '− $1.60');
});

// ───────────────────── عروض العبوات في السلة الحقيقية ─────────────────────

const TWO_50 = [{ id: 'two-50', label: 'عبوتان للاستعمال اليومي', type: 'bundle', qty: 2, sizeId: 'serum-50', value: 30, enabled: true }];

test('عرض عبوتين: الشارة على بطاقة الحجم والكمية 2 تُحسب بسعر العرض', async () => {
  const w = await boot(TWO_50);
  const doc = w.document;
  const flag = doc.querySelector('[data-size-for="serum-50"] .size-option-flag--bundle');
  assert.equal(flag.textContent, 'عبوتان بـ $30');
  assert.equal(doc.querySelector('[data-size-for="serum-30"] .size-option-flag--bundle'), null);

  const api = w.__RAWAA_TEST__;
  api.setMethod('cod', true);
  api.addToCart('serum-50');
  assert.equal(api.totals().amount, 16, 'عبوة واحدة تبقى 16 والتوصيل مجاني داخل حماة');
  api.addToCart('serum-50');
  const two = api.totals();
  assert.equal(two.subtotal, 32);
  assert.equal(two.offer, 2);
  assert.equal(two.net, 30);
  assert.equal(two.amount, 30, '30 + توصيل حماة المجاني');

  assert.equal(doc.querySelector('[data-row-offer]').hidden, false);
  assert.equal(doc.querySelector('[data-cart-offer]').textContent, '− $2');
  assert.match(doc.querySelector('[data-offer-label]').textContent, /عبوتان/);
  assert.match(doc.querySelector('[data-cart-item="serum-50"] .cart-item-unit').textContent, /عبوتان بـ \$30/);

  const msg = api.buildOrderMessage();
  assert.match(msg, /\$15 للواحدة = \$30/);
  assert.match(msg, /خصم عرض «عبوتان للاستعمال اليومي»: − \$2/);
});

test('ثلاث عبوات مع عرض «عبوتان»: عبوتان + واحدة بسعرها', async () => {
  const w = await boot(TWO_50);
  const api = w.__RAWAA_TEST__;
  api.setMethod('cod', true);
  for (let i = 0; i < 3; i += 1) api.addToCart('serum-50');
  const t = api.totals();
  assert.equal(t.offer, 2);
  assert.equal(t.net, 46, '30 + 16');
  assert.equal(t.amount, 46, 'توصيل حماة مجاني بعد تطبيق عرض العبوات');
});

test('ثلاث عبوات مع عرض «3 بـ 66$»: 66$ لا 75$، ثم شام كاش', async () => {
  const three = [{ id: 'three', label: 'ثلاث عبوات', type: 'bundle', qty: 3, sizeId: 'serum-100', value: 66, enabled: true }];
  const w = await boot(three);
  const api = w.__RAWAA_TEST__;
  api.addToCart('serum-100'); api.addToCart('serum-100'); api.addToCart('serum-100');
  api.setMethod('shamcash', true);
  api.setZone('hama', true);
  const t = api.totals();
  assert.equal(t.offer, 9, '75 − 66');
  assert.equal(t.net, 66);
  assert.equal(t.discount, 6.6);
  assert.equal(t.amount, 59.4);
});

test('عرض العبوة لا يُطبَّق على حجم آخر ولا يفسد إضافة العطر', async () => {
  const w = await boot(TWO_50);
  const api = w.__RAWAA_TEST__;
  api.setMethod('cod', true);
  api.addToCart('serum-30'); api.addToCart('serum-30');
  assert.equal(api.totals().offer, 0, 'الحجم 30 مل ليس له عرض');
  assert.equal(api.totals().net, 26);
  api.addToCart('serum-50'); api.addToCart('serum-50');
  const t = api.totals();
  assert.equal(t.offer, 2);
  assert.equal(t.subtotal, 58, 'قيمة المنتجات المعلنة 26 + 32');
  assert.equal(t.net, 56);
});

test('عرضان: واحد للحجم وواحد لكل العبوات — الأرخص يُختار بلا تكرار', async () => {
  const both = [
    { id: 'two-50', label: 'عبوتان 50', type: 'bundle', qty: 2, sizeId: 'serum-50', value: 30, enabled: true },
    { id: 'three-any', label: 'ثلاث عبوات', type: 'bundle', qty: 3, value: 69, enabled: true }
  ];
  const w = await boot(both);
  const api = w.__RAWAA_TEST__;
  api.setMethod('cod', true);
  for (let i = 0; i < 3; i += 1) api.addToCart('serum-100');
  // 75 ← «ثلاث بـ 69» مقابل «عبوتان بـ 30» (لا ينطبق على 100 مل لأنه مقيَّد بـ50)
  assert.equal(api.totals().net, 69);
  assert.equal(api.totals().offer, 6);
});

test('عرض العبوة يظهر في صفحة السيروم بالرقم نفسه', async () => {
  const w = await boot(TWO_50, serumHtml);
  const api = w.__RAWAA_TEST__;
  api.setMethod('shamcash', true);
  api.addToCart('serum-50'); api.addToCart('serum-50');
  // 30 − 3 = 27 داخل حماة بتوصيل مجاني
  assert.equal(api.totals().amount, 27);
  assert.equal(w.document.querySelector('[data-cart-offer]').textContent, '− $2');
});

test('تعذّر المشاركة الأصلية ينسخ رابط السلة أو يعرضه يدويًا', async () => {
  const w = await boot(NO_OFFER);
  w.__RAWAA_TEST__.addToCart('serum-50');
  const doc = w.document;
  const button = doc.querySelector('[data-cart-share]');
  const url = button.getAttribute('data-share-url');
  const toastRegion = doc.querySelector('[data-toast-region]');
  toastRegion.replaceChildren();
  let copied = '';

  Object.defineProperty(w.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (value) => { copied = value; } }
  });
  Object.defineProperty(w.navigator, 'share', {
    configurable: true,
    value: () => Promise.reject(new Error('share unavailable'))
  });

  button.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(copied, url);
  assert.match(toastRegion.textContent, /تم نسخ رابط السلة/);
});

test('تعذّر نسخ رابط المشاركة يعرض النص يدويًا لتستطيع الزائرة نسخه', async () => {
  const w = await boot(NO_OFFER);
  w.__RAWAA_TEST__.addToCart('serum-30');
  const button = w.document.querySelector('[data-cart-share]');
  const url = button.getAttribute('data-share-url');
  const toastRegion = w.document.querySelector('[data-toast-region]');
  toastRegion.replaceChildren();
  Object.defineProperty(w.navigator, 'share', {
    configurable: true,
    value: () => Promise.reject(new Error('share unavailable'))
  });
  Object.defineProperty(w.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: () => Promise.reject(new Error('clipboard denied')) }
  });

  button.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(toastRegion.textContent, /تعذّر النسخ؛ انسخي الرابط يدويًا/);
  assert.ok(toastRegion.textContent.includes(url));
});

test('إلغاء المشاركة من الزائرة لا يعرض تنبيه خطأ أو رابطًا غير مطلوب', async () => {
  const w = await boot(NO_OFFER);
  w.__RAWAA_TEST__.addToCart('serum-50');
  const toastRegion = w.document.querySelector('[data-toast-region]');
  toastRegion.replaceChildren();
  const cancel = new Error('share cancelled');
  cancel.name = 'AbortError';
  Object.defineProperty(w.navigator, 'share', {
    configurable: true,
    value: () => Promise.reject(cancel)
  });

  w.document.querySelector('[data-cart-share]').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(toastRegion.textContent, '');
});

test('عند معرفة انقطاع الإنترنت لا يفتح واتساب ولا يفرغ السلة', async () => {
  const w = await boot(NO_OFFER);
  const api = w.__RAWAA_TEST__;
  api.addToCart('serum-50');
  const doc = w.document;
  const toastRegion = doc.querySelector('[data-toast-region]');
  toastRegion.replaceChildren();
  let openCalls = 0;
  w.open = () => { openCalls += 1; return null; };
  Object.defineProperty(w.navigator, 'onLine', { configurable: true, value: false });

  doc.querySelector('[data-cart-checkout]').click();
  assert.equal(openCalls, 0);
  assert.equal(api.totals().count, 1);
  assert.equal(doc.querySelector('[data-cart-fallback]').hidden, false);
  assert.match(doc.querySelector('[data-cart-fallback-link]').href, /^https:\/\/wa\.me\//);
  assert.match(toastRegion.textContent, /لم يتم إرسال شيء/);
});

test('الاتصال متاح: الرسالة توضح أن فتح الرابط لا يرسل الطلب تلقائيًا', async () => {
  const w = await boot(NO_OFFER);
  const api = w.__RAWAA_TEST__;
  api.addToCart('serum-30');
  const toastRegion = w.document.querySelector('[data-toast-region]');
  toastRegion.replaceChildren();
  let openedUrl = '';
  w.open = (url) => { openedUrl = url; return { closed: false, opener: {} }; };
  Object.defineProperty(w.navigator, 'onLine', { configurable: true, value: true });

  w.document.querySelector('[data-cart-checkout]').click();
  assert.match(openedUrl, /^https:\/\/wa\.me\//);
  assert.equal(api.totals().count, 1);
  assert.match(toastRegion.textContent, /أرسلي الرسالة بنفسك/);
  assert.match(toastRegion.textContent, /لا يُعد الطلب مؤكدًا/);
});
