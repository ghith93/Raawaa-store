#!/usr/bin/env node
/**
 * RAWAA — ميزانية الوزن الثابتة (بلا شبكة وبلا Chromium).
 *
 * لماذا؟
 * `perf-budget.mjs` يشغّل Lighthouse على الموقع الحيّ داخل Chromium — وهو أدق، لكنه
 * يحتاج شبكة ومتصفحًا، فلا يعمل في بيئة معزولة ولا في CI خفيف. والأسوأ: بلا هذه
 * البوابة لا يلاحظ أحد أن «تحسينًا» صغيرًا أضاف ٢٠ كيلوبايت إلى أول زيارة.
 *
 * ما يقيسه (بالبايت بعد الضغط gzip، لأن هذا ما تدفعه الزبونة على شبكة بطيئة):
 *  1. HTML لكل صفحة على حِدة.
 *  2. CSS وJS المطلوبان فعليًا في أول شاشة.
 *  3. الخطوط المعلنة في CSS (تُحمَّل حسب المحارف المستخدمة).
 *  4. صورة أول شاشة للمقاس 480w (ما تختاره الزائنة على هاتف 390px).
 *  5. أكبر ملف صورة يشير إليه HTML (خطر بطء حقيقي).
 *
 * الاستخدام: node scripts/perf-static.mjs [--json]
 * الخروج بغير الصفر عند تجاوز أي ميزانية.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = process.cwd();
const JSON_OUT = process.argv.includes('--json');
const read = (p) => fs.readFileSync(path.join(ROOT, p));
const kb = (n) => (n / 1024).toFixed(1);
const gz = (p) => zlib.gzipSync(read(p), { level: 9 }).length;
const size = (p) => fs.statSync(path.join(ROOT, p)).size;

/** الميزانيات — مبنية على مقاسات فعلية، لا على تقدير. */
const BUDGET = {
  html: 22 * 1024,        // صفحة واحدة
  css: 32 * 1024,         // كل CSS مطلوب
  js: 48 * 1024,          // كل JS مطلوب
  fonts: 75 * 1024,       // الخطوط المعلنة (woff2 مضغوط أصلًا)
  firstView: 175 * 1024,  // ما تُنزّله الزائنة قبل أن ترى المنتج والسعر
  image: 130 * 1024       // أي صورة يشير إليها HTML
};

const PAGES = {
  'index.html': {
    css: ['css/styles.css'],
    js: ['js/config.js', 'js/marketing.js', 'js/cart.js', 'js/pwa-install.js'],
    hero: ['assets/img/products/trio-v6-480.avif']
  },
  'serum.html': {
    css: ['css/styles.css', 'css/serum.css'],
    js: ['js/config.js', 'js/marketing.js', 'js/cart.js', 'js/serum-views.js', 'js/pwa-install.js'],
    hero: ['assets/img/products/size-50-v6-480.avif']
  },
  'campaign.html': {
    css: ['css/styles.css', 'css/campaign.css'],
    js: ['js/config.js', 'js/marketing.js', 'js/campaign.js'],
    hero: ['assets/img/products/trio-v6-480.avif']
  }
};

const fonts = [...new Set(
  ['css/styles.css', 'css/serum.css', 'css/campaign.css']
    .map((f) => read(f).toString('utf8')).join('\n')
    .match(/fonts\/[A-Za-z0-9._-]+\.woff2/g) || []
)].map((f) => `assets/${f}`);

const fontBytes = fonts.reduce((sum, f) => sum + size(f), 0);

/** أكبر صورة يشير إليها HTML فعليًا */
const htmlImages = new Set();
for (const page of Object.keys(PAGES)) {
  const html = read(page).toString('utf8');
  for (const m of html.matchAll(/(?:src|srcset|imagesrcset)="([^"]+)"/g)) {
    for (const part of m[1].split(',')) {
      const p = part.trim().split(/\s+/)[0];
      if (p.startsWith('assets/')) htmlImages.add(p);
    }
  }
}
const images = [...htmlImages].map((p) => ({ p, bytes: size(p) })).sort((a, b) => b.bytes - a.bytes);

const failures = [];
const rows = [];
let totals = { html: 0, css: 0, js: 0, first: 0 };

for (const [page, cfg] of Object.entries(PAGES)) {
  const html = gz(page);
  const css = cfg.css.reduce((s, f) => s + gz(f), 0);
  const js = cfg.js.reduce((s, f) => s + gz(f), 0);
  const hero = cfg.hero.reduce((s, f) => s + size(f), 0);
  const first = html + css + js + fontBytes + hero;

  rows.push({ page, html, css, js, fonts: fontBytes, hero, first });

  if (html > BUDGET.html) failures.push(`${page}: HTML ${kb(html)}KB > ${kb(BUDGET.html)}KB`);
  if (css > BUDGET.css) failures.push(`${page}: CSS ${kb(css)}KB > ${kb(BUDGET.css)}KB`);
  if (js > BUDGET.js) failures.push(`${page}: JS ${kb(js)}KB > ${kb(BUDGET.js)}KB`);
  if (first > BUDGET.firstView) failures.push(`${page}: أول شاشة ${kb(first)}KB > ${kb(BUDGET.firstView)}KB`);
  totals.html = Math.max(totals.html, html);
  totals.css = Math.max(totals.css, css);
  totals.js = Math.max(totals.js, js);
  totals.first = Math.max(totals.first, first);
}

if (fontBytes > BUDGET.fonts) failures.push(`الخطوط ${kb(fontBytes)}KB > ${kb(BUDGET.fonts)}KB`);
for (const img of images) {
  if (img.bytes > BUDGET.image) failures.push(`صورة ثقيلة: ${img.p} ${kb(img.bytes)}KB > ${kb(BUDGET.image)}KB`);
}

if (JSON_OUT) {
  console.log(JSON.stringify({ rows, fonts: fontBytes, images: images.slice(0, 5), budget: BUDGET, failures }, null, 2));
} else {
  console.log('\n▸ الوزن الفعلي لأول زيارة (بعد gzip)\n');
  console.log('  الصفحة        HTML     CSS      JS   الخطوط  صورة أول شاشة   المجموع');
  for (const r of rows) {
    console.log(`  ${r.page.padEnd(12)} ${(kb(r.html) + 'K').padStart(6)} ${(kb(r.css) + 'K').padStart(7)} ${(kb(r.js) + 'K').padStart(6)} ${(kb(r.fonts) + 'K').padStart(7)} ${(kb(r.hero) + 'K').padStart(13)} ${(kb(r.first) + 'K').padStart(10)}`);
  }
  console.log(`\n  أكبر ٣ صور يشير إليها HTML:`);
  for (const img of images.slice(0, 3)) console.log(`    ${kb(img.bytes).padStart(7)}K  ${img.p}`);
  console.log('─'.repeat(72));
  if (failures.length) {
    console.log('تجاوز الميزانية:');
    failures.forEach((f) => console.log('  ✗ ' + f));
    process.exit(1);
  }
  console.log(`الميزانية محترمة · أثقل أول شاشة ${kb(totals.first)}K من ${kb(BUDGET.firstView)}K · الخطوط ${kb(fontBytes)}K من ${kb(BUDGET.fonts)}K`);
}
