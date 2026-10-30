/**
 * اختبار محرّك العروض — بلا متصفح وبلا DOM.
 * js/offers.js لا يلمس Date عند الاستدعاء، فكل تاريخ يُمرَّر صريحًا هنا.
 * التشغيل: node --test scripts/offers.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';


const source = await readFile(new URL('../js/offers.js', import.meta.url), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
const Offers = sandbox.window.RawaaOffers;

// الأسعار المعتمدة 19 / 26 / 29 → بالسنتات كما يبنيها cart.js
const PRICES = { 'serum-30': 1900, 'serum-50': 2600, 'serum-100': 2900 };
const DAY = '2026-10-30';

function state(slots, extra = {}) {
  return Offers.evaluate({ maxPercent: 30, slots, ...extra }, PRICES, DAY);
}

test('بلا خانات: لا عرض ولا تغيير في أي سعر', () => {
  const result = state([]);
  assert.equal(result.slots.length, 0);
  assert.equal(result.skipped.length, 0);
  const unit = Offers.unitPrice(Offers.pick(result.slots, 'serum-50'), PRICES['serum-50']);
  assert.equal(unit.cents, 2600);
  assert.equal(unit.cutCents, 0);
});

test('الخانة لا تعمل إلا بتفعيل صريح', () => {
  const result = state([{ id: 'x', label: 'عرض', type: 'percent', value: 10 }]);
  assert.equal(result.slots.length, 0);
  assert.equal(result.skipped[0].reason, 'not-enabled');
});

test('نسبة على حجم واحد تُخصم من سعره فقط', () => {
  const result = state([{ id: 'p30', label: 'عرض 30 مل', type: 'percent', value: 10, sizeId: 'serum-30', enabled: true }]);
  const unit = Offers.unitPrice(Offers.pick(result.slots, 'serum-30'), PRICES['serum-30']);
  assert.equal(unit.cents, 1710);
  assert.equal(unit.cutCents, 190);
  // الحجم الآخر لا يتأثر
  const other = Offers.unitPrice(Offers.pick(result.slots, 'serum-50'), PRICES['serum-50']);
  assert.equal(other.cents, 2600);
});

test('سعر خاص لحجم: sizePrice أدنى من السعر الأصلي فقط', () => {
  const ok = state([{ id: 's100', label: 'سعر خاص', type: 'sizePrice', sizeId: 'serum-100', value: 26, enabled: true }]);
  assert.equal(Offers.unitPrice(Offers.pick(ok.slots, 'serum-100'), PRICES['serum-100']).cents, 2600);

  const wrong = state([{ id: 's100', label: 'سعر أعلى', type: 'sizePrice', sizeId: 'serum-100', value: 31, enabled: true }]);
  assert.equal(wrong.slots.length, 0);
  assert.equal(wrong.skipped[0].reason, 'not-a-discount');
});

test('سقف النسبة يمنع خطأً مطبعيًا مكلفًا', () => {
  const over = state([{ id: 'big', label: 'خطأ', type: 'percent', value: 45, enabled: true }]);
  assert.equal(over.slots.length, 0);
  assert.equal(over.skipped[0].reason, 'over-cap');

  const raised = state([{ id: 'big', label: 'موسمي', type: 'percent', value: 40, enabled: true }], { maxPercent: 40 });
  assert.equal(raised.slots.length, 1);
});

test('التواريخ: لا يبدأ قبل موعده ولا يستمر بعد انتهائه', () => {
  const future = state([{ id: 'f', label: 'قريبًا', type: 'percent', value: 10, enabled: true, startsAt: '2026-11-01' }]);
  assert.equal(future.skipped[0].reason, 'not-started');

  const expired = state([{ id: 'e', label: 'منتهٍ', type: 'percent', value: 10, enabled: true, endsAt: '2026-10-29' }]);
  assert.equal(expired.skipped[0].reason, 'expired');

  const lastDay = state([{ id: 'l', label: 'آخر يوم', type: 'percent', value: 10, enabled: true, endsAt: DAY }]);
  assert.equal(lastDay.slots.length, 1, 'يوم الانتهاء نفسه ما زال داخل العرض');

  const reversed = state([{ id: 'r', label: 'معكوس', type: 'percent', value: 10, enabled: true, startsAt: '2026-12-01', endsAt: '2026-11-01' }]);
  assert.equal(reversed.skipped[0].reason, 'ends-before-start');
});

test('مبلغ ثابت على الطلب يُقصّ عند قيمة المنتجات', () => {
  assert.equal(Offers.orderCut({ type: 'amount', value: 5 }, 8000), 500);
  assert.equal(Offers.orderCut({ type: 'amount', value: 500 }, 8000), 8000);
  // العرض العام لا يُخصم من إضافة العطر لأنه لا يراها أصلًا
  assert.equal(Offers.orderCut({ type: 'percent', value: 10 }, 8000), 800);
});

test('الأولوية لترتيب المصفوفة، ولكل نطاق عرض واحد', () => {
  const result = state([
    { id: 'first', label: 'الأول', type: 'percent', value: 5, sizeId: 'serum-50', enabled: true },
    { id: 'second', label: 'الثاني', type: 'percent', value: 20, sizeId: 'serum-50', enabled: true }
  ]);
  const picked = Offers.pick(result.slots, 'serum-50');
  assert.equal(picked.id, 'first');
  assert.equal(Offers.pick(result.slots, null), null);
});

test('خانة بحجم غير موجود تُهمَل ولا تكسر الواجهة', () => {
  const result = state([{ id: 'ghost', label: 'وهمي', type: 'percent', value: 10, sizeId: 'serum-999', enabled: true }]);
  assert.equal(result.slots.length, 0);
  assert.equal(result.skipped[0].reason, 'bad-size');
});

test('تاريخ اليوم يُبنى محليًا بصيغة YYYY-MM-DD', () => {
  assert.equal(Offers.todayISO(new Date(2026, 9, 30, 23, 59)), '2026-10-30');
  assert.equal(Offers.todayISO(new Date(2027, 0, 5, 0, 1)), '2027-01-05');
});

test('الشارة مشتقة حين لا يكتبها المالك', () => {
  assert.equal(Offers.badge({ type: 'percent', value: 15 }), '−15%');
  assert.equal(Offers.badge({ type: 'amount', value: 5 }), '−$5');
  assert.equal(Offers.badge({ type: 'sizePrice', value: 26 }), 'سعر خاص');
  assert.equal(Offers.badge({ type: 'percent', value: 15, badge: 'إطلاق' }), 'إطلاق');
});

test('تركيب التسعير كما في السلة: العرض أولًا ثم شام كاش ثم التوصيل', () => {
  // سلة: 50 مل × 2 + 30 مل × 1 + عطر 2$ = (2600*2) + 1900 + 600 = 7700
  // عرض 10% على 50 مل، ثم شام كاش 10%، ثم توصيل 2$ (حماة) يُلغى لأنه مجاني.
  const result = state([{ id: 'half', label: 'عرض', type: 'percent', value: 10, sizeId: 'serum-50', enabled: true }]);
  const unit50 = Offers.unitPrice(Offers.pick(result.slots, 'serum-50'), 2600);
  const productCents = unit50.cents * 2 + 1900;
  const scentCents = 200 * 3;
  const subtotal = productCents + scentCents;
  const shamcash = Math.round(subtotal * 10 / 100);
  assert.equal(unit50.cents, 2340);
  assert.equal(productCents, 6580);
  assert.equal(subtotal, 7180);
  assert.equal(shamcash, 718);
  assert.equal(subtotal - shamcash, 6462); // $64.62 مع توصيل مجاني داخل حماة
});

test('لا تُستورد أي مكتبة ولا يُقرأ أي ملف خارجي في محرّك العروض', () => {
  assert.ok(!/require\(|import\s|fetch\(|XMLHttpRequest/.test(source));
});
