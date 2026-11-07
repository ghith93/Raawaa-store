#!/usr/bin/env node
/**
 * يفحص **نسخة البناء** لا المصدر: هل كل صفحة مخزّنة في عامل الخدمة تجد أصولها
 * في المجلد المنشور؟
 *
 * لماذا فحص منفصل؟ الحارس في service-worker-offline.test.mjs يقرأ المصدر
 * ويكفي لكشف الانحراف. لكن العطل الذي وقع (7 نوفمبر 2026) لم يكن في المصدر
 * وحده: `build-deploy.sh` ينسخ قائمة ملفات محددة، فملف جديد يعمل محليًا قد لا
 * يُنسخ أصلًا. فحص المخرَج هو ما يثبت أن الزائرة ستستلم ما وُعدت به.
 *
 * بلا اعتماديات. يُشغّل بعد البناء:
 *   bash scripts/build-deploy.sh && node scripts/sw-build-coverage.mjs
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = resolve(ROOT, 'dist/site');

if (!existsSync(SITE)) {
  console.error('✗ dist/site غير موجود — شغّل scripts/build-deploy.sh أولًا.');
  process.exit(1);
}

const sw = readFileSync(resolve(SITE, 'sw.js'), 'utf8');
const block = sw.match(/const CORE = \[([\s\S]*?)\];/)?.[1];
if (!block) {
  console.error('✗ لم أستطع قراءة CORE من نسخة البناء.');
  process.exit(1);
}
const core = [...block.matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]);

/* الصفحات التي تُخدَم بلا إنترنت → ملفها الفعلي. */
const PAGES = { '': 'index.html', serum: 'serum.html', campaign: 'campaign.html',
  hama: 'hama.html', privacy: 'privacy.html', '404.html': '404.html' };

const problems = [];

for (const [route, file] of Object.entries(PAGES)) {
  if (!core.includes(route)) {
    problems.push(`صفحة مذكورة في هذا الفحص وغير مخزّنة: ${route || '/'}`);
    continue;
  }
  if (!existsSync(resolve(SITE, file))) {
    problems.push(`صفحة مخزّنة مفقودة من البناء: ${file}`);
    continue;
  }
  const html = readFileSync(resolve(SITE, file), 'utf8');
  const refs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)]
    .map((m) => m[1].split('?')[0])
    .filter((ref) => /\.(?:css|js)$/.test(ref) && !/^(?:https?:|\/\/)/.test(ref));
  for (const ref of new Set(refs)) {
    const path = ref.replace(/^\//, '');
    if (!core.includes(path)) {
      problems.push(`${file} تطلب ${ref} وهي ليست في CORE — ستفقد تنسيقها أو وظيفتها بلا إنترنت`);
    }
    if (!existsSync(resolve(SITE, path))) {
      problems.push(`${file} تطلب ${ref} وهي غير منشورة أصلًا (404 على الموقع الحيّ)`);
    }
  }
}

for (const entry of core) {
  if (!entry || !entry.includes('.')) continue; // مسارات الصفحات تمر عبر _redirects
  const file = resolve(SITE, entry);
  if (!existsSync(file)) problems.push(`CORE يشير إلى ${entry} وهي غير موجودة في البناء`);
  else if (statSync(file).size === 0) problems.push(`CORE يشير إلى ${entry} وهي فارغة`);
}

if (problems.length) {
  console.error(`✗ ${problems.length} عطل في تغطية ذاكرة العمل:\n` + problems.map((p) => `  • ${p}`).join('\n'));
  process.exit(1);
}
console.log(`✓ تغطية ذاكرة العمل: ${Object.keys(PAGES).length} صفحات · ${core.length} أصلًا · كلها منشورة ومربوطة`);
