/**
 * اتفاقية الإعدادات المنشورة — دالة واحدة يشاركها البناء والفحص.
 *
 * لماذا ملف مشترك؟ لأن المراقبة الحيّة فشلت ١١ مرة متتالية (٤–٧ نوفمبر ٢٠٢٦) لا
 * لأن الموقع تعطّل. السبب عقد ضمني بين طرفين:
 *   • `scripts/build-deploy.sh` ينشر `js/config.js` كـJSON مُجمّع داخل `deepFreeze`.
 *   • `scripts/order-config-monitor.mjs` كان يقرأه بتعبيرات نمطية تفترض صياغة
 *     المصدر (`whatsappNumber: '...'` بعلامات اقتباس مفردة وبلا علامات مزدوجة).
 * فكان المراقب يقرأ ملفًا موجودًا وسليمًا ثم يعلن «0 matches» ويفشل. الإنذار
 * الكاذب المزمن أخطر من غياب الإنذار: يعلّم المالك تجاهل التنبيهات الحقيقية.
 *
 * القاعدة الآن: كل من يبني نسخة النشر أو يفحصها يستورد من هنا.
 * أي تغيير في شكل الملف المنشور يجب أن يمرّ بهذا الملف وتغطيه اختباراته.
 */
import vm from 'node:vm';

/** الحقول الداخلية التي لا تُنشر. أي حقل جديد يُضاف هنا صراحةً، لا بالتخمين. */
export const INTERNAL_TOP_LEVEL = ['costing'];
export const INTERNAL_METHOD_FIELDS = ['apiNote'];

/** سقف حجم الملف المنشور: الإعدادات نحو ٦–٨ KB؛ أي شيء أكبر بكثير ليس إعداداتنا. */
export const MAX_PUBLISHED_BYTES = 512 * 1024;

/** يقرأ `js/config.js` المصدر وينتج كائن الإعدادات الكامل. يفشل مغلقًا. */
export function readSourceConfig(source) {
  const sandbox = { window: {} };
  try {
    vm.runInNewContext(source, sandbox);
  } catch (error) {
    throw new Error(`تعذّر تقييم مصدر الإعدادات: ${error.message}`);
  }
  const config = sandbox.window && sandbox.window.RAWAA_CONFIG;
  if (!config || !Array.isArray(config.products) || config.products.length < 1) {
    throw new Error('تعذّر قراءة الإعدادات من المصدر: لا كائن إعدادات');
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
 * هل هذا نص نسخة نشر (JSON مُجمّع) أم نص المصدر الملتزم؟
 *
 * التشخيص صريح لا استنتاجي بالتجربة والخطأ: نص المصدر يستخدم مفاتيح غير مقتبسة
 * وتعليقات، ونسخة النشر مفاتيحها مقتبسة داخل كائن JSON. أي نص لا يطابق أيا من
 * الشكلين يُرفض بدل تخمينه.
 */
export function detectConfigFormat(text) {
  if (typeof text !== 'string' || text.trim() === '') throw new Error('نص الإعدادات فارغ');
  // ملاحظة مهمة: المصدر أيضًا يستخدم deepFreeze، لكنه يغلّف **متغيرًا**
  // (`deepFreeze(config)`) بينما نسخة البناء تغلّف **كائن JSON حرفيًا**
  // (`deepFreeze({`). الاعتماد على deepFreeze وحده كان سيصنّف المصدر منشورًا.
  const looksPublished =
    /RAWAA_CONFIG\s*=\s*deepFreeze\(\{/.test(text) ||
    (/"products"\s*:/.test(text) && /"whatsappNumber"\s*:/.test(text));
  const looksSource =
    /\bproducts:\s*\[/.test(text) &&
    /\bwhatsappNumber:\s*'/.test(text) &&
    !/"products"\s*:/.test(text);

  if (looksPublished && !looksSource) return 'published';
  if (looksSource && !looksPublished) return 'source';
  if (looksPublished && looksSource) throw new Error('شكل الإعدادات ملتبس: يحمل سمات المصدر والمنشور معًا');
  throw new Error('شكل الإعدادات غير معروف: لا مصدر ولا نسخة نشر');
}

/**
 * يقرأ ملف إعدادات منشورًا (بصياغة البناء) ويعيد كائن الإعدادات.
 *
 * يعيد نسخة منزوعة من سياق `vm`: الكائن المُقيَّم ينتمي إلى realm آخر، فمقارنته
 * العميقة بكائن المصدر تفشل زورًا. النسخة أيضًا تقطع أي getter أو proxy قد
 * يُحقن في الملف البعيد، ولا تمنح الملف أي وصول إلى الشبكة أو `process`.
 */
export function readPublishedConfig(text) {
  if (typeof text !== 'string') throw new Error('تعذّر قراءة الإعدادات المنشورة: النص ليس نصًا');
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > MAX_PUBLISHED_BYTES) {
    throw new Error(`تعذّر قراءة الإعدادات المنشورة: حجم ${bytes} يتجاوز السقف`);
  }
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
