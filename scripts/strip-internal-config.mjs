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
 *
 * ⚠ العقد بين هذا السكربت وفحص الموقع الحيّ يعيش في scripts/lib/public-config.mjs.
 * لا تُكرّر منطق التنظيف هنا: عدّله هناك ليقرأه الطرفان.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { renderPublishedConfig } from './lib/public-config.mjs';

const target = process.argv[2];
if (!target) {
  console.error('✗ مرّر مسار ملف الإعدادات في مجلد النشر');
  process.exit(1);
}

const source = await readFile(new URL('../js/config.js', import.meta.url), 'utf8');

let rendered;
try {
  rendered = renderPublishedConfig(source);
} catch (error) {
  console.error(`✗ ${error.message}`);
  process.exit(1);
}

await writeFile(target, rendered.output, 'utf8');
console.log(
  `  إعدادات عامة: أُزيل ${rendered.removed.length} حقلًا داخليًا (${rendered.removed.join(', ') || 'لا شيء'})`
);
