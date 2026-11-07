import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const doc = readFileSync(path.join(ROOT, 'docs/HAMA-OPS-KIT-AR.md'), 'utf8');
const config = readFileSync(path.join(ROOT, 'js/config.js'), 'utf8');

/** أسعار الأحجام كما هي في المصدر الوحيد. */
const prices = [...config.matchAll(/price:\s*(\d+(?:\.\d+)?)/g)].map(m => Number(m[1]));

function pricesIn(text) {
  const found = new Set();
  for (const m of text.matchAll(/\$\s?(\d+(?:\.\d+)?)/g)) found.add(Number(m[1]));
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s?\$/g)) found.add(Number(m[1]));
  return found;
}

test('سلّم الأسعار في عدّة التشغيل يطابق js/config.js', () => {
  assert.equal(prices.length, 3, `توقّعت ٣ أسعار في config.js، وجدت ${prices.length}`);
  for (const price of prices) {
    assert.ok(
      new RegExp(`\\$\\s?${String(price).replace('.', '\\.')}\\b`).test(doc),
      `السعر ${price}$ غائب عن عدّة التشغيل`
    );
  }
});

test('رسوم التوصيل في عدّة التشغيل تطابق إعدادات المتجر', () => {
  const otherZone = config.match(/id:\s*'other',[^}]*fee:\s*(\d+(?:\.\d+)?)/s);
  const hamaZone = config.match(/id:\s*'hama',[^}]*fee:\s*(\d+(?:\.\d+)?)/s);
  assert.ok(hamaZone, 'تعرفة حماة موجودة في config.js');
  assert.ok(otherZone, 'تعرفة باقي المحافظات موجودة في config.js');
  assert.equal(Number(hamaZone[1]), 0);
  assert.equal(Number(otherZone[1]), 2);
  assert.match(doc, /التوصيل مجاني داخل حماة لجميع طرق الدفع/);
  assert.doesNotMatch(doc, /باقي المحافظات ٤\$/);
});

test('لا رقم من السلّم القديم في عدّة التشغيل', () => {
  const forbidden = new Set([19, 26, 29, 17, 18, 24, 22, 30, 34, 46, 48, 23.4]);
  const seen = pricesIn(doc);
  const stale = [...seen].filter(value => forbidden.has(value));
  assert.deepEqual(stale, [], `أرقام قديمة: ${stale.join('، ')}`);
});

test('الأقسام الثمانية موجودة', () => {
  for (const heading of [
    'رسائل ما بعد الطلب',
    'كتالوج واتساب',
    'الإحالة والولاء',
    'أول ٥٠ زبونة',
    'معايير اختيار المؤثرات',
    'نسخ CTA بديلة',
    'جدول التتبّع الأسبوعي',
    'تنبيهات الامتثال'
  ]) {
    assert.ok(doc.includes(heading), `قسم مفقود: ${heading}`);
  }
});

test('لا كسر للسعر ولا ندرة ولا وعود طبية', () => {
  assert.ok(!/~~/.test(doc), 'لا أسعار مشطوبة');
  assert.ok(!/خصم\s*إضافي\s*فعال/.test(doc), 'لا خصم إضافي');
  // العبارة تُذكر مرة واحدة فقط، وبصيغة منع لا بصيغة وعد.
  const guarantee = doc.match(/مضمون\s*١٠٠٪|مضمون\s*100/g) || [];
  assert.ok(guarantee.length <= 1 && doc.includes('ممنوع في الـCTA'), 'الضمان المطلق مذكور كمنع فقط');
  assert.ok(!/يعالج\s*التساقط/.test(doc), 'لا ادعاء علاجي');
  assert.ok(doc.includes('لا نبيع أقل من $13'), 'قاعدة الحد الأدنى للسعر مكتوبة');
});

test('التوصيل المجاني العام ليس مكافأة إحالة، ولا مكافأة مالية غير معتمدة', () => {
  assert.ok(/لا نستخدمه كميزة إحالة/.test(doc), 'التوصيل المجاني داخل حماة ليس مكافأة إحالة إضافية');
  assert.ok(/لا يُفعَّل خصم إحالة أو عطر مجاني قبل موافقة المالك/.test(doc), 'لا مكافأة إحالة أو هدية بلا اعتماد');
  assert.ok(/عطر مجاني/.test(doc), 'سياسة الولاء موصوفة بوضوح');
});
