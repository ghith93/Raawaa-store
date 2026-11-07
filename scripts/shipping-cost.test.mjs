/*
 * حارس تكلفة الشحن — «التوصيل المجاني للزبونة ليس مجانيًا على المالك».
 *
 * القصة: بعد قرار التوصيل المجاني (D-2026-11-07)، صار المالك يتحمّل رسم الشحن
 * عن كل طلب. كل حساب ربح في المستودع كان **يتجاهله**، فكان يُظهر ربحًا أعلى من
 * الحقيقة بـ$2 لكل طلب — في الأداة الداخلية، وفي سطر «ملاحظة الهامش» داخل السلة،
 * وفي `ref-audit`. رقمٌ واحد ناقص في ثلاثة مواضع لا يظهر كخطأ، بل كربح.
 *
 * المالك أعطى القيمة: $2.00 لكل طلب. هذا الاختبار يثبت أن:
 *   ١. القيمة موجودة في js/config.js وحده، ولا تُكرَّر كرقم في أي ملف آخر.
 *   ٢. كل موضع يحسب ربحًا يقرأها فعلًا (لا يتركها صفرًا بصمت).
 *   ٣. أسوأ حالة (وحدة واحدة + أعلى خصم) تبقى موجبة عند تكلفة العبوة العليا.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(resolve(ROOT, path), 'utf8');

function loadConfig() {
  const window = {};
  new Function('window', read('js/config.js'))(window);
  return window.RAWAA_CONFIG;
}

const config = loadConfig();
const SHIPPING = config.costing.shippingCostPerOrder;

test('تكلفة الشحن معرَّفة في الإعدادات وبقيمة المالك ٢ دولار', () => {
  assert.equal(typeof SHIPPING, 'number', 'costing.shippingCostPerOrder مفقود');
  assert.equal(SHIPPING, 2, 'قيمة المالك المُعلنة هي 2.00 دولار لكل طلب');
  assert.match(config.costing.note, /توصيل/, 'الملاحظة يجب أن تذكر تكلفة التوصيل');
});

test('لا موضع يعيد كتابة رقم الشحن حرفيًا', () => {
  // الشرط: كل حساب ربح يقرأ الحقل، ولا يضع `2` بنفسه.
  const consumers = ['js/cart.js', 'scripts/ref-audit.mjs'];
  for (const file of consumers) {
    const code = read(file)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    assert.match(code, /shippingCostPerOrder/, `${file} لا يقرأ costing.shippingCostPerOrder`);
    assert.doesNotMatch(
      code,
      /(?:shipping|shipCost|deliveryCost)\w*\s*=\s*2(?:\.0+)?\b/i,
      `${file} يكتب رقم الشحن حرفيًا بدل قراءته من الإعدادات`
    );
  }
});

test('margin_calc.py يقرأ القيمة افتراضيًا بدل صفر', () => {
  const source = read('scripts/margin_calc.py');
  assert.match(source, /shippingCostPerOrder/);
  // الافتراضي يجب أن يكون None (أي «اقرأ من الإعدادات») لا 0.0 (أي «تجاهل»).
  assert.match(source, /--shipping",\s*type=float,\s*default=None/,
    'الافتراضي 0.0 يُخفي التكلفة؛ يجب أن يكون None ليُقرأ من الإعدادات');
});

test('أسوأ حالة بيع تبقى مربحة بعد احتساب الشحن', () => {
  const maxCost = config.costing.unitCostMax;
  const maxDiscount = Math.max(0, ...config.payment.methods.map(m => m.discountPercent || 0));
  const rows = config.products.map(product => ({
    id: product.id,
    profit: +(product.price * (1 - maxDiscount / 100) - maxCost - SHIPPING).toFixed(2)
  }));
  for (const row of rows) {
    assert.ok(row.profit > 0, `${row.id}: ربح ${row.profit}$ في أسوأ حالة — غير مربح`);
  }
  // الرقم المنشور في BENCHMARKS/LAUNCH-KIT لـ30 مل يجب أن يطابق الحساب.
  assert.equal(rows.find(r => r.id === 'serum-30').profit, 5.7, '30 مل شام كاش يجب أن يكون $5.70');
});

test('التكلفة داخلية ولا تظهر للزبونة في نسخة النشر', () => {
  // منطق التنظيف يعيش في scripts/lib/public-config.mjs وحده (والسكربت يستدعيه).
  // هذا شرط سابق نؤكده هنا لأن أي عرض لهذه القيمة سيكشف هامش المالك للعميل.
  const lib = read('scripts/lib/public-config.mjs');
  assert.match(lib, /INTERNAL_TOP_LEVEL[^=]*=\s*\[[^\]]*'costing'/,
    'costing يجب أن يبقى في قائمة الحقول الداخلية المحذوفة من نسخة النشر');
});

test('القيمة فعليًا تُحذف من المخرَج المنشور', async () => {
  const { renderPublishedConfig } = await import('./lib/public-config.mjs');
  const { output } = renderPublishedConfig(read('js/config.js'));
  assert.doesNotMatch(output, /shippingCostPerOrder/, 'تكلفة الشحن تسرّبت إلى نسخة النشر');
  assert.doesNotMatch(output, /unitCostMax/, 'تكلفة العبوة تسرّبت إلى نسخة النشر');
});
