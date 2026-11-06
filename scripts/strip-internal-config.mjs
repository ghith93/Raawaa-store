#!/usr/bin/env node
/**
 * ينشر نسخة عامة من js/config.js بلا الحقول الداخلية.
 *
 * لماذا؟ `js/config.js` هو المصدر الوحيد للأسعار، ويُقرأ كما هو في المتصفح.
 * لكنه يحمل أيضًا تقديرات التكلفة وملاحظات تكامل داخلية لا تحتاجها الزبونة.
 * المصدر يبقى كاملًا للمالك والخادم والاختبارات؛ نسخة النشر وحدها تُنظَّف.
 *
 * التشغيل: node scripts/strip-internal-config.mjs dist/site/js/config.js
 * يفشل مغلقًا: أي شك في البنية يوقف البناء بدل نشر ملف ناقص أو خاطئ.
 */
import { readFile, writeFile } from 'node:fs/promises';
import vm from 'node:vm';

const target = process.argv[2];
if (!target) {
  console.error('✗ مرّر مسار ملف الإعدادات في مجلد النشر');
  process.exit(1);
}

const source = await readFile(new URL('../js/config.js', import.meta.url), 'utf8');
const sandbox = { window: {} };
vm.runInNewContext(source, sandbox);
const config = sandbox.window.RAWAA_CONFIG;
if (!config || !Array.isArray(config.products) || config.products.length < 1) {
  console.error('✗ تعذّر قراءة الإعدادات — أُوقف البناء');
  process.exit(1);
}

// الحقول الداخلية المعروفة. أي حقل جديد يُضاف هنا صراحةً، لا بالتخمين.
const INTERNAL_TOP_LEVEL = ['costing'];
const INTERNAL_METHOD_FIELDS = ['apiNote'];

const publicConfig = JSON.parse(JSON.stringify(config));
const removed = [];
for (const key of INTERNAL_TOP_LEVEL) {
  if (key in publicConfig) { delete publicConfig[key]; removed.push(key); }
}
for (const method of publicConfig.payment?.methods ?? []) {
  for (const key of INTERNAL_METHOD_FIELDS) {
    if (key in method) { delete method[key]; removed.push(`payment.methods[].${key}`); }
  }
}

// ضمان أن التنظيف لم يمسّ أي رقم أو خيار تعتمد عليه الواجهة.
const priceful = cfg => JSON.stringify({
  products: cfg.products,
  delivery: cfg.delivery,
  customization: cfg.customization,
  offers: cfg.offers,
  contact: cfg.contact,
  methods: (cfg.payment?.methods ?? []).map(m => ({
    id: m.id, label: m.label, discountPercent: m.discountPercent,
    freeDeliveryIn: m.freeDeliveryIn, available: m.available
  }))
});
if (priceful(config) !== priceful(publicConfig)) {
  console.error('✗ التنظيف غيّر بيانات التسعير — أُوقف البناء');
  process.exit(1);
}

const body = JSON.stringify(publicConfig, null, 2);
const output = `/* RAWAA | رواء — إعدادات عامة للنشر. المصدر الكامل: js/config.js في المستودع. */
(function () {
  'use strict';
  function deepFreeze(value) {
    Object.getOwnPropertyNames(value).forEach(function (key) {
      var prop = value[key];
      if (prop && typeof prop === 'object' && !Object.isFrozen(prop)) deepFreeze(prop);
    });
    return Object.freeze(value);
  }
  window.RAWAA_CONFIG = deepFreeze(${body});
})();
`;

// تحقق أخير: الملف المكتوب يُنتج الإعدادات العامة نفسها فعلًا.
const verify = { window: {} };
vm.runInNewContext(output, verify);
if (JSON.stringify(verify.window.RAWAA_CONFIG) !== JSON.stringify(publicConfig)) {
  console.error('✗ الملف المنشور لا يطابق الإعدادات المتوقعة — أُوقف البناء');
  process.exit(1);
}

await writeFile(target, output, 'utf8');
console.log(`  إعدادات عامة: أُزيل ${removed.length} حقلًا داخليًا (${removed.join(', ') || 'لا شيء'})`);
