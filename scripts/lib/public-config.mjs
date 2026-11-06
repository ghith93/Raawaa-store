/**
 * اتفاقية الإعدادات المنشورة — دالة واحدة يشاركها البناء والفحص.
 *
 * لماذا ملف مشترك؟ لأن العطل الذي أطفأ المراقبة ٧ مرات متتالية (٤–٦ نوفمبر ٢٠٢٦)
 * لم يكن خطأً في البناء ولا في المراقب، بل في **العقد الضمني** بينهما:
 * البناء ينشر `js/config.js` بصياغة JSON، والمراقب يقرأه بتعبيرات نمطية تفترض
 * صياغة المصدر. لم يكن هناك مكان واحد يعرّف «كيف تبدو نسخة النشر»، فانحرف الطرفان.
 *
 * القاعدة الآن: كل من يبني نسخة النشر أو يفحصها يستورد من هنا.
 * أي تغيير في شكل الملف المنشور يجب أن يمرّ بهذا الملف وتغطيه اختباراته.
 */
import vm from 'node:vm';

/** الحقول الداخلية التي لا تُنشر. أي حقل جديد يُضاف هنا صراحةً، لا بالتخمين. */
const INTERNAL_TOP_LEVEL = ['costing'];
const INTERNAL_METHOD_FIELDS = ['apiNote'];

/** يقرأ `js/config.js` المصدر وينتج كائن الإعدادات الكامل. يفشل مغلقًا. */
export function readSourceConfig(source) {
  const sandbox = { window: {} };
  vm.runInNewContext(source, sandbox);
  const config = sandbox.window && sandbox.window.RAWAA_CONFIG;
  if (!config || !Array.isArray(config.products) || config.products.length < 1) {
    throw new Error('تعذّر قراءة الإعدادات من المصدر');
  }
  return config;
}

/** يزيل الحقول الداخلية من كائن الإعدادات دون المساس بأي قيمة تسعير. */
export function stripInternal(config) {
  const publicConfig = JSON.parse(JSON.stringify(config));
  const removed = [];
  for (const key of INTERNAL_TOP_LEVEL) {
    if (key in publicConfig) {
      delete publicConfig[key];
      removed.push(key);
    }
  }
  for (const method of publicConfig.payment?.methods ?? []) {
    for (const key of INTERNAL_METHOD_FIELDS) {
      if (key in method) {
        delete method[key];
        removed.push(`payment.methods[].${key}`);
      }
    }
  }
  return { publicConfig, removed };
}

/** بصمة كل ما تعتمد عليه الواجهة — تُستخدم لإثبات أن التنظيف لم يمسّ التسعير. */
export function priceful(config) {
  return JSON.stringify({
    products: config.products,
    delivery: config.delivery,
    customization: config.customization,
    offers: config.offers,
    contact: config.contact,
    methods: (config.payment?.methods ?? []).map((m) => ({
      id: m.id,
      label: m.label,
      discountPercent: m.discountPercent,
      freeDeliveryIn: m.freeDeliveryIn,
      available: m.available
    }))
  });
}

/**
 * ينتج نص `config.js` المنشور.
 *
 * ملاحظة معمارية مقصودة: نُنشر الكائن كـJSON داخل `deepFreeze` لأن ذلك يمنع أي
 * تعليق أو تعبير من التسرب إلى الإنتاج، ويجعل المحتوى قابلًا للتحقق حرفيًا.
 * الصياغة نفسها ليست عقدًا للمستهلكين: من يقرأ الملف المنشور يستخدم
 * `readPublishedConfig` أدناه أو يقيّمه في `vm`، لا تعبيرات نمطية.
 */
export function renderPublishedConfig(source) {
  const config = readSourceConfig(source);
  const { publicConfig, removed } = stripInternal(config);

  if (priceful(config) !== priceful(publicConfig)) {
    throw new Error('التنظيف غيّر بيانات التسعير — أُوقف البناء');
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
    throw new Error('الملف المنشور لا يطابق الإعدادات المتوقعة — أُوقف البناء');
  }

  return { output, publicConfig, removed };
}

/**
 * يقرأ ملف إعدادات منشورًا (بصياغة البناء) ويعيد كائن الإعدادات.
 *
 * يعيد نسخة منزوعة من سياق `vm`: الكائن المُقيَّم ينتمي إلى realm آخر، فمقارنته
 * العميقة بكائن المصدر تفشل زورًا («same structure but not reference-equal»).
 * النسخة أيضًا تقطع أي getter أو proxy قد يُحقن في الملف البعيد.
 */
export function readPublishedConfig(text) {
  const sandbox = { window: {} };
  try {
    vm.runInNewContext(text, sandbox);
  } catch (error) {
    throw new Error(`تعذّر قراءة الإعدادات المنشورة: ${error.message}`);
  }
  const config = sandbox.window && sandbox.window.RAWAA_CONFIG;
  if (!config || !Array.isArray(config.products) || config.products.length < 1) {
    throw new Error('تعذّر قراءة الإعدادات المنشورة: لا كائن إعدادات');
  }
  return JSON.parse(JSON.stringify(config));
}
