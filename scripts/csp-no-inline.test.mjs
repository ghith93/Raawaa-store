/*
 * حارس CSP — «لا 'unsafe-inline' في الإنتاج».
 *
 * الفكرة: ترويسة `style-src 'unsafe-inline'` تُبطل حماية style-src على الموقع كله
 * لأجل نمط سطري واحد. و`script-src 'unsafe-inline'` أخطر: تفتح الباب لكل XSS.
 * لكن إزالتها من الترويسة وحدها لا تكفي — إن بقي نمط أو سكربت سطري في صفحة
 * فسيتعطّل التنسيق أو تُكسر الوظائف بصمت.
 *
 * فهذا الاختبار يفحص الطرفين معًا، ويحمي الاتجاهين:
 *   • الترويسة لا تسمح بـ'unsafe-inline' في script-src أو style-src.
 *   • لا صفحة منشورة تحتوي <style> ولا <script> بلا src ولا سمة style= .
 *   • لا معالج حدث سطري (onclick=...) في أي صفحة منشورة.
 *   • الكود لا يكتب أنماطًا سطرية عبر el.style.x = ... (وهو ما يُرفض تحت style-src 'self').
 *
 * ولا يكتفي بالنفي: يثبت أن ملفات CSS/JS المستخرجة موجودة ومربوطة فعلًا، حتى
 * لا يمرّ الاختبار لأن صفحة فقدت تنسيقها بالكامل.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(resolve(ROOT, path), 'utf8');

/** الصفحات التي تُنشر فعلًا (نفس قائمة scripts/build-deploy.sh). */
const SHIPPED = ['index.html', 'serum.html', 'campaign.html', 'hama.html',
                 'privacy.html', 'check.html', 'setup.html', '404.html'];

/* ── ١) الترويسة ─────────────────────────────────────────────────────────── */

function cspDirective(header, name) {
  const match = new RegExp(`${name}\\s+([^;\\n]+)`).exec(header);
  return match ? match[1].trim() : null;
}

test('ترويسة CSP العامة لا تسمح بـ unsafe-inline', () => {
  const headers = read('_headers');
  for (const directive of ['script-src', 'style-src']) {
    const value = cspDirective(headers, directive);
    assert.ok(value, `${directive} مفقودة من _headers`);
    assert.doesNotMatch(value, /unsafe-inline|unsafe-eval/,
      `${directive} تسمح بـ${value} — تُبطل الحماية على الموقع كله`);
  }
});

test('لا ترويسة أخرى في _headers تعيد unsafe-inline', () => {
  // سياسات المسارات الفرعية (owner, elYRA, config) لا يجوز أن تتراجع.
  assert.doesNotMatch(read('_headers'), /unsafe-inline/, '_headers ما زال يسمح بأنماط/سكربتات سطرية');
});

/* ── ٢) الصفحات المنشورة ─────────────────────────────────────────────────── */

test('لا صفحة منشورة تحتوي <style> مضمّنًا', () => {
  const offenders = SHIPPED.filter(page => /<style[\s>]/i.test(read(page)));
  assert.deepEqual(offenders, [], `صفحات بأنماط مضمّنة: ${offenders.join(', ')}`);
});

test('لا صفحة منشورة تحتوي سكربتًا مضمّنًا بلا src', () => {
  const offenders = [];
  for (const page of SHIPPED) {
    // JSON-LD مسموح: لا يُنفَّذ، ولا يخضع لـscript-src.
    const scripts = [...read(page).matchAll(/<script(?![^>]*\bsrc=)([^>]*)>/gi)]
      .filter(m => !/application\/ld\+json/i.test(m[1]));
    if (scripts.length) offenders.push(`${page} (${scripts.length})`);
  }
  assert.deepEqual(offenders, [], `سكربتات مضمّنة: ${offenders.join(', ')}`);
});

test('لا سمة style= في أي صفحة منشورة', () => {
  const offenders = SHIPPED.filter(page => /\sstyle\s*=\s*["']/i.test(read(page)));
  assert.deepEqual(offenders, [], `سمات style سطرية: ${offenders.join(', ')}`);
});

test('لا معالج حدث سطري (onclick/onload/...) في أي صفحة منشورة', () => {
  const offenders = SHIPPED.filter(page =>
    /\son(?:click|load|error|change|input|submit|focus|blur|keydown|keyup|mouse\w+|touch\w+)\s*=/i.test(read(page)));
  assert.deepEqual(offenders, [], `معالجات أحداث سطرية: ${offenders.join(', ')}`);
});

/* ── ٣) الكود لا يكتب أنماطًا سطرية ─────────────────────────────────────── */

test('ملفات JS المنشورة لا تكتب el.style.x = ...', () => {
  const offenders = [];
  const files = ['js/cart.js', 'js/marketing.js', 'js/offers.js', 'js/pricing-policy.js',
                 'js/serum-views.js', 'js/pwa-install.js', 'js/campaign.js',
                 'js/index-inline.js', 'js/privacy-inline.js', 'js/serum-inline.js',
                 'js/setup-inline.js', 'js/check-inline.js'];
  for (const file of files) {
    if (!existsSync(resolve(ROOT, file))) continue;
    const code = read(file)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    if (/\.style\.(?!setProperty\s*\(\s*['"]--)/.test(code)) offenders.push(file);
  }
  assert.deepEqual(offenders, [],
    `هذه الملفات تكتب أنماطًا سطرية تُرفض تحت style-src 'self': ${offenders.join(', ')}`);
});

/* ── ٤) الفحص الإيجابي: الاستخراج مربوط فعلًا ───────────────────────────── */

test('كل stylesheet/script مستخرج مذكور في صفحته وموجود على القرص', () => {
  const expected = {
    'index.html': ['css/home-inline.css', 'css/utilities.css', 'js/index-inline.js'],
    'hama.html': ['css/hama.css', 'css/utilities.css'],
    'privacy.html': ['js/privacy-inline.js'],
    'serum.html': ['js/serum-inline.js'],
    'setup.html': ['css/setup.css', 'js/setup-inline.js'],
    'check.html': ['css/check.css', 'js/check-inline.js']
  };
  for (const [page, assets] of Object.entries(expected)) {
    const source = read(page);
    for (const asset of assets) {
      assert.ok(existsSync(resolve(ROOT, asset)), `${asset} مفقود من الشجرة`);
      assert.match(source, new RegExp(asset.replace(/[./]/g, '\\$&')),
        `${page} لا يحمّل ${asset} — الصفحة ستفقد تنسيقها أو وظيفتها`);
    }
  }
});

test('الخطوط ما زالت مُعلنة بعد إخراج @font-face من index.html', () => {
  // الفخ: نقل @font-face إلى css/ يغيّر مسارات الخطوط، وbuild-deploy يحذف كل
  // خط لا تجده في CSS. لو ضاعت، اختفى الخط من الموقع الحيّ بصمت.
  const homeCss = read('css/home-inline.css');
  const faces = [...homeCss.matchAll(/url\('(\.\.\/assets\/fonts\/[^']+)'\)/g)].map(m => m[1]);
  assert.ok(faces.length >= 3, `توقّعنا 3 خطوط على الأقل في home-inline.css، وجدنا ${faces.length}`);
  for (const face of faces) {
    const onDisk = resolve(ROOT, face.replace('../', ''));
    assert.ok(existsSync(onDisk), `${face} مُعلن في CSS لكنه غير موجود — الخط سيختفي`);
  }
});

// ── حارس لوحة الألوان ────────────────────────────────────────────────────────
//
// عطل حقيقي وقع: index.html كان يحمل <style> فيه :root (لوحة داكنة). عند
// استخراجه إلى css/home-inline.css ربطتُ الملف بـhama.html كي تحصل على الأدوات
// العامة — فورثت hama لوحة الصفحة الرئيسية الداكنة، وصار شعارها الأسود باهتًا
// على خلفية داكنة. تدقيق axe في CI هو ما التقطه.
//
// القاعدة: ملف يعرّف متغيّرات ألوان لا يُحمَّل في صفحة تعرّف لوحة أخرى.
const PALETTES = {
  'css/home-inline.css': ':root',
};

test('لا صفحة تخلط لوحتين ألوان', () => {
  const offenders = [];
  for (const page of SHIPPED) {
    const html = read(page);
    const sheets = [...html.matchAll(/<link[^>]+href="(css\/[^"]+\.css)"/g)].map(m => m[1]);
    const paletteSheets = sheets.filter(s => PALETTES[s]);
    // لوحة الصفحة نفسها: هل تعرّف :root في مكان آخر؟
    if (paletteSheets.length > 1) offenders.push(`${page}: ${paletteSheets.join(' + ')}`);
  }
  assert.deepEqual(offenders, [],
    `صفحة تحمّل أكثر من ملف يعرّف لوحة ألوان:\n${offenders.join('\n')}`);
});

test('الأدوات المشتركة لا تعرّف متغيّرات ألوان', () => {
  // نزيل التعليقات: الشرح نفسه يذكر :root لأن سبب وجود هذا الحارس هو ذلك العطل.
  const css = read('css/utilities.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.equal(/:root|^\s*--[a-z-]+:/m.test(css), false,
    'css/utilities.css يجب أن يستخدم المتغيّرات لا أن يعرّفها، وإلا فرض لوحة على الصفحة');
});

test('كل صنف أدوات مستخدم في الصفحات معرَّف في utilities.css', () => {
  const defined = new Set([...read('css/utilities.css').matchAll(/\.(u-[a-z0-9-]+)/g)].map(m => m[1]));
  const missing = [];
  for (const page of SHIPPED) {
    const html = read(page);
    const used = new Set([...html.matchAll(/class="([^"]+)"/g)]
      .flatMap(m => m[1].split(/\s+/)).filter(c => c.startsWith('u-')));
    for (const cls of used) if (!defined.has(cls)) missing.push(`${page}: .${cls}`);
  }
  assert.deepEqual(missing, [],
    `أصناف مستخدمة بلا تعريف (ستُهمَل بصمت):\n${missing.join('\n')}`);
});

test('لا @import في الأنماط: طلب متسلسل يحجب الرسم', () => {
  const offenders = [];
  for (const file of readdirSync(resolve(ROOT, 'css'))) {
    if (!file.endsWith('.css')) continue;
    if (/@import/.test(read(`css/${file}`).replace(/\/\*[\s\S]*?\*\//g, ''))) offenders.push(file);
  }
  assert.deepEqual(offenders, [],
    `@import يجعل المتصفح يكتشف الملف بعد تحميل الأول. اربط الملف مباشرة في الصفحة:\n${offenders.join(', ')}`);
});
