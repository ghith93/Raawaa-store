#!/usr/bin/env node
/**
 * RAWAA | رواء — فحص آلي للموقع.
 * يتحقق من: وجود الملفات، صحة بناء JavaScript، تطابق الأسعار ورقم واتساب،
 * العناصر التي يعتمد عليها كود السلة، الروابط الداخلية والملفات المشار إليها،
 * وسلامة نصوص HTML الأساسية.
 *
 * الاستخدام: node scripts/check-site.mjs
 * كود الخروج 1 عند وجود أي فشل.
 */

import { readFile, access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const results = [];
let currentGroup = 'عام';

function group(name) {
  currentGroup = name;
}

function record(status, label, detail = '') {
  results.push({ group: currentGroup, status, label, detail });
}

function pass(label, detail) { record('PASS', label, detail); }
function fail(label, detail) { record('FAIL', label, detail); }
function info(label, detail) { record('INFO', label, detail); }

async function exists(rel) {
  try {
    await access(path.join(ROOT, rel), constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function sizeOf(rel) {
  const s = await stat(path.join(ROOT, rel));
  return s.size;
}

async function read(rel) {
  return readFile(path.join(ROOT, rel), 'utf8');
}

/* ------------------------- 1) الملفات المطلوبة ------------------------- */
async function checkRequiredFiles() {
  group('الملفات المطلوبة');
  const required = [
    'index.html',
    'privacy.html',
    'robots.txt',
    'js/config.js',
    'js/cart.js',
    'css/styles.css',
    'assets/favicon.svg',
    'docs/launch-and-growth-plan.md',
    'scripts/check-site.mjs',
    '.github/workflows/site-checks.yml'
  ];
  for (const file of required) {
    if (await exists(file)) pass(`موجود: ${file}`);
    else fail(`مفقود: ${file}`);
  }

  for (const f of ['sitemap.xml', 'assets/img/products/manifest.json']) {
    if (await exists(f)) pass(`موجود: ${f}`);
    else fail(`مفقود: ${f}`);
  }

  // تراخيص الخطوط (شرط SIL OFL)
  for (const f of ['OFL-Amiri.txt', 'OFL-Almarai.txt', 'OFL-CormorantGaramond.txt']) {
    const p = `assets/fonts/licenses/${f}`;
    if (await exists(p)) pass(`ترخيص خط: ${f}`);
    else fail(`ترخيص خط مفقود: ${f}`);
  }

  // لا أسرار ولا ملفات اعتماد
  const secretPatterns = [
    [/ghp_[A-Za-z0-9]{20,}/, 'GitHub token'],
    [/github_pat_[A-Za-z0-9_]{20,}/, 'GitHub PAT'],
    [/AKIA[0-9A-Z]{16}/, 'AWS key'],
    [/BEGIN (?:RSA|OPENSSH|PGP) PRIVATE KEY/, 'private key'],
    [/sk-[A-Za-z0-9]{20,}/, 'API secret']
  ];
  const scan = ['index.html', 'privacy.html', 'js/config.js', 'js/cart.js', 'scripts/check-site.mjs'];
  let leak = null;
  for (const f of scan) {
    if (!(await exists(f))) continue;
    const text = await read(f);
    for (const [re, label] of secretPatterns) {
      if (re.test(text)) leak = `${label} في ${f}`;
    }
  }
  if (leak) fail(`سر محتمل في المشروع: ${leak}`);
  else pass('لا مفاتيح أو أسرار داخل الملفات المفحوصة');
}

/* ------------------------- 2) تهيئة الإعدادات ------------------------- */
async function loadConfig() {
  const source = await read('js/config.js');
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  new vm.Script(source, { filename: 'js/config.js' }).runInContext(sandbox);
  if (!sandbox.window.RAWAA_CONFIG) throw new Error('RAWAA_CONFIG غير معرّف');
  return { config: sandbox.window.RAWAA_CONFIG, source };
}

function checkConfig(config, source) {
  group('الإعدادات والأسعار');

  const expected = [
    { id: 'serum-30', sizeMl: 30, price: 6 },
    { id: 'serum-50', sizeMl: 50, price: 10 },
    { id: 'serum-100', sizeMl: 100, price: 12 }
  ];

  if (config.products.length === 3) pass('عدد الأحجام = 3');
  else fail(`عدد الأحجام = ${config.products.length} (المتوقع 3)`);

  for (const exp of expected) {
    const found = config.products.find((p) => p.id === exp.id);
    if (!found) { fail(`الحجم ${exp.id} غير موجود`); continue; }
    if (found.sizeMl !== exp.sizeMl) fail(`${exp.id}: ${found.sizeMl} مل بدل ${exp.sizeMl}`);
    else if (found.price !== exp.price) fail(`${exp.id}: السعر ${found.price} بدل ${exp.price}`);
    else pass(`${exp.id}: ${found.sizeMl} مل = $${found.price}`);
  }

  // رقم واتساب
  if (/^\d{10,15}$/.test(config.contact.whatsappNumber)) pass(`رقم واتساب بصيغة دولية صحيحة: ${config.contact.whatsappNumber}`);
  else fail(`رقم واتساب غير صالح: ${config.contact.whatsappNumber}`);

  if (config.contact.whatsappNumber === '963997310856') pass('رقم واتساب مطابق للرقم المعتمد 0997310856');
  else fail(`رقم واتساب مختلف عن المعتمد: ${config.contact.whatsappNumber}`);

  if (config.contact.whatsappNumber.startsWith('963')) pass('الرقم يبدأ بمقدمة سوريا 963');
  else fail('الرقم لا يبدأ بمقدمة سوريا');

  if (config.currency.code === 'USD' && config.currency.symbol === '$') pass('العملة USD والرمز $');
  else fail('إعداد العملة غير مطابق للمطلوب');

  // منع تكرار الأسعار خارج config.js
  const priceLiterals = [...source.matchAll(/price:\s*(\d+)/g)].map((m) => m[1]);
  if (priceLiterals.length === 3) pass('الأسعار معرّفة في config.js فقط (3 قيم)');
  else fail(`عدد تعريفات price في config.js = ${priceLiterals.length}`);

  // تجميد الإعدادات
  if (Object.isFrozen(config) && Object.isFrozen(config.products[0])) pass('الإعدادات مجمّدة (Object.freeze)');
  else fail('الإعدادات غير مجمّدة');
}

/** يزيل SVG ووسوم النمط حتى لا تُقرأ أرقام المسارات وclamp كأنها أسعار. */
function stripNonCopy(text) {
  return text
    .replace(/<svg[\s\S]*?<\/svg>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\bd="[^"]*"/g, ' ');
}

async function checkNoScatteredPrices() {
  group('الإعدادات والأسعار');
  const files = ['index.html', 'privacy.html', 'js/cart.js', 'css/styles.css'];

  /**
   * الصفحة صار فيها شرح مرئي لطرق الدفع، ومن حقّه ذكر رقم السعر لعرض مثال.
   * القاعدة ليست «ممنوع كتابة رقم»، بل «كل رقم سعر مكتوب يجب أن يطابق config.js».
   * أي رقم لا وجود له في الإعدادات = فشل.
   */
  const allowedNumbers = new Set();
  const cfgSrc = await read('js/config.js');
  for (const m of cfgSrc.matchAll(/price:\s*(\d+(?:\.\d+)?)/g)) allowedNumbers.add(m[1]);
  for (const m of cfgSrc.matchAll(/(?:discountPercent|deliveryFee):\s*(\d+(?:\.\d+)?)/g)) {
    allowedNumbers.add(m[1]);
  }

  const pricePatterns = [/\$\s*(\d+(?:\.\d+)?)\b/, /\b(\d+(?:\.\d+)?)\s*\$/, /\b(\d+(?:\.\d+)?)\s*(?:دولار|USD)/i];
  const offenders = [];
  const seen = [];

  for (const file of files) {
    if (!(await exists(file))) continue;
    const text = stripNonCopy(await read(file));
    for (const re of pricePatterns) {
      for (const m of text.matchAll(new RegExp(re.source, 'g'))) {
        const value = m[1];
        seen.push(`${file}: ${m[0].trim()}`);
        if (!allowedNumbers.has(value)) offenders.push(`${file}: «${m[0].trim()}»`);
      }
    }
  }

  if (offenders.length === 0) {
    pass(`كل رقم سعر مكتوب في الصفحة موجود في config.js (${seen.length} إشارة، مسموح: ${[...allowedNumbers].join('/')})`);
  } else {
    fail(`أرقام سعر لا يوجد لها أصل في config.js → ${offenders.join(' · ')}`);
  }
}

/* ------------------------- 3) صحة JavaScript ------------------------- */
async function checkJsSyntax() {
  group('صحة JavaScript');
  for (const file of ['js/config.js', 'js/cart.js']) {
    try {
      new vm.Script(await read(file), { filename: file });
      pass(`بناء سليم: ${file}`);
    } catch (error) {
      fail(`خطأ بناء في ${file}`, error.message);
    }
  }
}

/* ------------------------- 4) عناصر HTML التي تعتمد عليها السلة ------------------------- */
async function checkHtmlHooks() {
  group('عناصر HTML للسلة');
  const html = await read('index.html');

  const hooks = [
    ['data-product-grid', 'شبكة المنتجات'],
    ['data-cart-count', 'شارة عدد العناصر'],
    ['data-cart-open', 'أزرار فتح السلة'],
    ['data-cart-close', 'زر إغلاق السلة'],
    ['data-cart-items', 'قائمة عناصر السلة'],
    ['data-cart-empty', 'رسالة السلة الفارغة'],
    ['data-cart-foot', 'تذييل السلة'],
    ['data-cart-total', 'المجموع المرجعي'],
    ['data-cart-checkout', 'زر واتساب'],
    ['data-cart-fallback', 'بديل تعذّر فتح واتساب'],
    ['data-cart-fallback-link', 'رابط بديل'],
    ['data-cart-copy-number', 'زر نسخ الرقم'],
    ['data-toast-region', 'منطقة الإشعارات'],
    ['data-nav-toggle', 'زر قائمة الهاتف'],
    ['id="cart-dialog"', 'عنصر الحوار'],
    ['id="mobile-nav"', 'قائمة الهاتف']
  ];

  for (const [hook, label] of hooks) {
    if (html.includes(hook)) pass(`${label} (${hook})`);
    else fail(`مفقود في index.html: ${hook} — ${label}`);
  }

  // العناصر المطلوبة في ملف cart.js يجب أن تكون موجودة في HTML
  const cart = await read('js/cart.js');
  const queried = [...cart.matchAll(/querySelector(?:All)?\('([^']+)'\)/g)].map((m) => m[1]);
  const ids = [...cart.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1]);
  for (const id of ids) {
    if (html.includes(`id="${id}"`)) pass(`عنصر مطلوب بالمعرّف: #${id}`);
    else fail(`cart.js يطلب #${id} وهو غير موجود`);
  }
  info('محددات CSS المستخدمة في cart.js', `${queried.length} محددًا — تُختبر عمليًا في اختبار المتصفح`);
}

/* ------------------------- 5) سلامة الروابط والملفات المشار إليها ------------------------- */
async function checkLinks() {
  group('الروابط والأصول');
  for (const page of ['index.html', 'privacy.html']) {
    const html = await read(page);
    const isPrivacy = page === 'privacy.html';

    const localRefs = new Set();
    for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      const ref = m[1];
      if (/^(https?:|mailto:|tel:|data:|#)/.test(ref)) continue;
      localRefs.add(ref.split('#')[0]);
    }
    for (const m of html.matchAll(/srcset="([^"]+)"/g)) {
      localRefs.add(m[1].split(' ')[0]);
    }

    for (const ref of localRefs) {
      if (!ref) continue;
      const base = path.dirname(page);
      const rel = path.normalize(path.join(base, ref));
      if (await exists(rel)) pass(`${page} → ${ref}`);
      else fail(`${page} → ${ref} (ملف مفقود)`);
    }

    // روابط الأقسام الداخلية
    const anchors = new Set([...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]));
    for (const anchor of anchors) {
      const escaped = anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`id="${escaped}"`).test(html)) pass(`${page} → #${anchor}`);
      else fail(`${page}: رابط داخلي بلا هدف #${anchor}`);
    }

    // روابط واتساب في الصفحة يجب أن تطابق الرقم المعتمد
    for (const m of html.matchAll(/https:\/\/wa\.me\/(\d+)/g)) {
      if (m[1] === '963997310856') pass(`${page}: رابط واتساب مطابق (${m[1]})`);
      else fail(`${page}: رابط واتساب مختلف (${m[1]})`);
    }

    // لا عناوين/أزرار شكلية
    const btnAnchors = [...html.matchAll(/<a[^>]*class="[^"]*btn[^"]*"[^>]*>/g)].map((m) => m[0]);
    for (const tag of btnAnchors) {
      if (/href=/.test(tag)) pass(`${page}: زر رابط فعّال`);
      else fail(`${page}: عنصر بستايل الزر بلا href: ${tag.slice(0, 60)}`);
    }

    // كل <button> يجب أن يكون type="button" داخل الصفحة (خارج النماذج)
    const buttons = [...html.matchAll(/<button\b[^>]*>/g)].map((m) => m[0]);
    const missingType = buttons.filter((b) => !/type="button"/.test(b));
    if (missingType.length === 0) pass(`${page}: جميع الأزرار بـ type="button" (${buttons.length})`);
    else fail(`${page}: ${missingType.length} زر بلا type="button"`);

    // alt للصور
    const imgs = [...html.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
    const missingAlt = imgs.filter((i) => !/\balt=/.test(i));
    if (missingAlt.length === 0) pass(`${page}: جميع الصور بحقل alt (${imgs.length})`);
    else fail(`${page}: ${missingAlt.length} صورة بلا alt`);

    // عرض/ارتفاع لتقليل انزياح التخطيط (عدا صور السلة المبنية ديناميكيًا)
    const noDims = imgs.filter((i) => !(/width=/.test(i) && /height=/.test(i)));
    if (noDims.length === 0) pass(`${page}: جميع الصور بأبعاد صريحة`);
    else fail(`${page}: ${noDims.length} صورة بلا width/height`);

    if (/loading="lazy"/.test(html)) pass(`${page}: تحميل كسول مستخدم`);
    else info(`${page}: لا يوجد loading="lazy"`, 'مقبول إن لم توجد صور دون الطية');

    if (!isPrivacy) {
      if (/fetchpriority="high"/.test(html)) pass('صورة Hero بأولوية تحميل عالية');
      else fail('صورة Hero بلا fetchpriority="high"');
    }

    if (!/<html lang="ar" dir="rtl">/.test(html)) fail(`${page}: غياب lang="ar" dir="rtl"`);
    else pass(`${page}: اللغة والاتجاه صحيحان`);

    if (/<h1\b/.test(html)) pass(`${page}: يوجد h1`);
    else fail(`${page}: لا يوجد h1`);

    const desc = html.match(/<meta name="description" content="([^"]+)"/);
    if (desc && desc[1].length >= 70 && desc[1].length <= 300) pass(`${page}: وصف تعريفي بطول مناسب (${desc[1].length})`);
    else fail(`${page}: وصف تعريفي مفقود أو غير مناسب`);
  }
}

/* ------------------------- 6) المحتوى والادعاءات ------------------------- */
async function checkContentClaims() {
  group('المحتوى والادعاءات');
  const index = await read('index.html');
  const privacy = await read('privacy.html');
  const config = await read('js/config.js');
  const all = index + privacy + config;

  /** الادعاء يُعدّ مخالفًا فقط إذا لم يسبقه نفي (لا / ولا / دون / بدون / غير). */
  const NEGATIONS = ['لا', 'ولا', 'دون', 'بدون', 'غير', 'بلا', 'لم'];
  function hasAssertedClaim(text, claimPattern) {
    const re = new RegExp(claimPattern, 'g');
    let match;
    while ((match = re.exec(text)) !== null) {
      const before = text.slice(Math.max(0, match.index - 14), match.index);
      const negated = NEGATIONS.some((n) => new RegExp(`${n}\\s+[^.]{0,6}$`).test(before));
      if (!negated) return text.slice(match.index, match.index + 40);
    }
    return null;
  }

  const forbidden = [
    [String.raw`يعالج\s+تساقط`, 'ادعاء علاجي'],
    [String.raw`نتائج\s+مضمونة`, 'ادعاء نتيجة مضمونة'],
    [String.raw`نتائج?\s+مؤكدة`, 'ادعاء نتيجة مؤكدة'],
    [String.raw`قبل\s+و\s*بعد`, 'صور قبل وبعد'],
    [String.raw`تقييمات?\s+العملاء`, 'شهادات عملاء'],
    [String.raw`شهادة\s+(?:جودة|اعتماد)`, 'شهادة غير موثقة']
  ];

  for (const [pattern, label] of forbidden) {
    const hit = hasAssertedClaim(all, pattern);
    if (hit) fail(`ادعاء غير مصرَّح به: ${label} → «${hit.trim()}»`);
    else pass(`لا ادعاء غير مصرَّح به: ${label} (مع احتساب صيغ النفي)`);
  }

  // كل نسبة مئوية معروضة يجب أن تطابق نسبة معرّفة في config.js (خصم أو رسوم)
  const cfgText = await read('js/config.js');
  const allowedPercents = new Set();
  for (const m of cfgText.matchAll(/discountPercent:\s*(\d+)/g)) allowedPercents.add(m[1]);

  const badPercents = [];
  let percentCount = 0;
  for (const m of all.matchAll(/([\d٠-٩]+)\s*(?:٪|%)/g)) {
    percentCount += 1;
    if (!allowedPercents.has(m[1])) badPercents.push(m[0].trim());
  }
  if (badPercents.length === 0) {
    pass(`كل نسبة مئوية معروضة معرّفة في config.js (${percentCount} إشارة، مسموح: ${[...allowedPercents].join('/') || '—'})`);
  } else {
    fail(`نسب مئوية غير موثقة: ${badPercents.join(' · ')}`);
  }

  const requiredDisclaimers = [
    ['مرجعي', 'الإشارة إلى أن الأسعار مرجعية'],
    [/ليست صورة لمنتج مُصنَّع|ليس صورة منتج مُصنَّع|تصور تصميمي/, 'تنبيه أن الصور تصورات تصميمية'],
    ['لا يعني أن الطلب سُجِّل', 'تنبيه أن واتساب لا يسجّل الطلب'],
    [/لا يمرّ أي مبلغ عبره|بدون دفع إلكتروني/, 'الإشارة إلى أن الدفع لا يمرّ عبر الموقع']
  ];
  for (const [needle, label] of requiredDisclaimers) {
    const ok = needle instanceof RegExp ? needle.test(index) : index.includes(needle);
    if (ok) pass(label);
    else fail(`تنبيه مفقود: ${label} (${needle})`);
  }

  // الموارد الخارجية
  const externalRefs = [...all.matchAll(/https?:\/\/[^"')\s]+/g)].map((m) => m[0]);
  const nonWhatsApp = externalRefs.filter((u) => !u.includes('wa.me') && !u.includes('github.com') && !u.includes('w3.org'));
  if (nonWhatsApp.length === 0) pass('لا موارد خارجية غير واتساب');
  else info('موارد خارجية', nonWhatsApp.join(', '));

  // فحص الاستخدام الفعلي لا مجرد ذكر الكلمة في نص السياسة أو التعليقات
  const storageUse = [
    [/localStorage\s*\./, 'localStorage'],
    [/sessionStorage\s*\./, 'sessionStorage'],
    [/document\s*\.\s*cookie\s*=/, 'كوكيز (كتابة)'],
    [/indexedDB\s*\./, 'IndexedDB'],
    [/navigator\s*\.\s*sendBeacon/, 'sendBeacon'],
    [/\bfetch\s*\(/, 'طلب شبكة fetch'],
    [/XMLHttpRequest/, 'XMLHttpRequest'],
    [/<script[^>]+src="https?:/, 'سكربت خارجي']
  ];
  for (const [re, label] of storageUse) {
    const target = re.source.includes('<script') ? index + privacy : all;
    if (re.test(target)) fail(`استخدام فعلي لـ ${label} يناقض سياسة الخصوصية`);
    else pass(`لا استخدام لـ ${label}`);
  }
}

/* ------------------------- 7) منطق السلة (محاكاة) ------------------------- */
async function checkCartLogic() {
  group('منطق السلة');

  // إعادة بناء منطق الحساب من الإعدادات والتحقق منه
  const { config } = await loadConfig();
  const toCents = (v) => Math.round(v * 100);
  const price = (id) => config.products.find((p) => p.id === id).price;

  const cases = [
    { cart: { 'serum-30': 1 }, expected: 6 },
    { cart: { 'serum-50': 2 }, expected: 20 },
    { cart: { 'serum-100': 3 }, expected: 36 },
    { cart: { 'serum-30': 2, 'serum-50': 1 }, expected: 22 },
    { cart: { 'serum-30': 1, 'serum-50': 1, 'serum-100': 1 }, expected: 28 }
  ];

  for (const c of cases) {
    const cents = Object.entries(c.cart).reduce((sum, [id, qty]) => sum + toCents(price(id)) * qty, 0);
    const amount = cents / 100;
    const desc = Object.entries(c.cart).map(([id, q]) => `${id}×${q}`).join(' + ');
    if (amount === c.expected) pass(`المجموع المرجعي: ${desc} = $${amount}`);
    else fail(`المجموع المرجعي: ${desc} = $${amount} بدل $${c.expected}`);
  }

  // حدود الكمية
  if (config.cart.maxQuantityPerItem === 10) pass('الحد الأقصى للكمية = 10');
  else fail('الحد الأقصى للكمية غير مضبوط');

  // رسالة واتساب: التحقق من البنية والترميز
  const cartSource = await read('js/cart.js');
  const requiredParts = ['greeting', 'intro', 'confirmationPoints', 'المجموع المرجعي', 'encodeURIComponent', 'wa.me'];
  for (const part of requiredParts) {
    if (cartSource.includes(part)) pass(`رسالة واتساب تتضمن: ${part}`);
    else fail(`رسالة واتساب تفتقد: ${part}`);
  }

  // ترميز عربي سليم
  const sample = `مرحبًا رواء،\nأرغب بالاستفسار\n• 30 مل × 1 — $6`;
  const encoded = encodeURIComponent(sample);
  if (!/[\s\u0600-\u06FF]/.test(encoded) && decodeURIComponent(encoded) === sample) {
    pass('ترميز URI للنص العربي سليم وقابل للفك');
  } else {
    fail('ترميز URI للنص العربي غير سليم');
  }

  // معالجة تعذّر فتح النافذة
  if (/window\.open/.test(cartSource) && /showFallback/.test(cartSource)) pass('معالجة تعذّر فتح النافذة موجودة');
  else fail('لا معالجة لتعذّر فتح نافذة واتساب');

  // إدارة التركيز
  if (/showModal/.test(cartSource) && /lastFocused/.test(cartSource) && /afterClose/.test(cartSource)) {
    pass('إدارة التركيز داخل النافذة وإعادته بعد الإغلاق');
  } else {
    fail('إدارة التركيز غير مكتملة');
  }
}

/* ------------------------- 8) الأداء والأصول ------------------------- */
async function checkAssets() {
  group('الأصول والصور');
  const images = [
    'assets/img/hero-720.webp', 'assets/img/hero-720.jpg',
    'assets/img/serum-30-720.webp', 'assets/img/serum-30-720.jpg',
    'assets/img/serum-50-720.webp', 'assets/img/serum-50-720.jpg',
    'assets/img/serum-100-720.webp', 'assets/img/serum-100-720.jpg',
    'assets/img/texture-1200.webp', 'assets/img/texture-1200.jpg'
  ];
  let total = 0;
  for (const img of images) {
    if (!(await exists(img))) { fail(`صورة مفقودة: ${img}`); continue; }
    const bytes = await sizeOf(img);
    total += bytes;
    const kb = Math.round(bytes / 1024);
    if (bytes > 200 * 1024) fail(`${img} كبيرة الحجم (${kb}KB > 200KB)`);
    else pass(`${img} — ${kb}KB`);
  }
  info('إجمالي وزن الصور الأساسية', `${Math.round(total / 1024)}KB`);

  const fonts = [
    'assets/fonts/almarai-400.subset.woff2',
    'assets/fonts/almarai-700.subset.woff2',
    'assets/fonts/amiri-400.subset.woff2',
    'assets/fonts/cormorant-500-latin.subset.woff2',
    'assets/fonts/almarai-400-latin.subset.woff2',
    'assets/fonts/almarai-700-latin.subset.woff2',
    'assets/fonts/amiri-400-latin.subset.woff2'
  ];
  let fontBytes = 0;
  for (const font of fonts) {
    if (await exists(font)) {
      const b = await sizeOf(font);
      fontBytes += b;
      if (b > 60 * 1024) fail(`${font} ثقيل (${Math.round(b / 1024)}KB > 60KB)`);
      else pass(`خط مُقلَّص: ${font.split('/').pop()} — ${Math.round(b / 1024)}KB`);
    } else fail(`خط مفقود: ${font}`);
  }
  if (fontBytes < 90 * 1024) pass(`إجمالي وزن الخطوط ${Math.round(fontBytes / 1024)}KB (حد 90KB)`);
  else fail(`إجمالي وزن الخطوط ${Math.round(fontBytes / 1024)}KB يتجاوز 90KB`);

  // أي إشارة لملفات خطوط غير مقلّصة في CSS/HTML؟
  const cssText = await read('css/styles.css');
  const htmlText = await read('index.html');
  const nonSubset = [...(cssText + htmlText).matchAll(/fonts\/([a-z0-9-]+)\.woff2/g)]
    .map((m) => m[1])
    .filter((n) => !n.includes('subset'));
  if (nonSubset.length === 0) pass('كل الخطوط المستخدمة نسخ مُقلَّصة');
  else fail(`خطوط غير مقلّصة مستخدمة: ${[...new Set(nonSubset)].join(', ')}`);

  const css = await read('css/styles.css');
  if (/@font-face/.test(css)) pass('تعريفات @font-face موجودة في CSS');
  else fail('لا تعريفات @font-face');
  if (/prefers-reduced-motion/.test(css)) pass('احترام تقليل الحركة');
  else fail('لا احترام لـ prefers-reduced-motion');
  if (/fonts\.googleapis|fonts\.gstatic/.test(css + (await read('index.html')))) {
    fail('اعتماد على خطوط خارجية (Google Fonts)');
  } else {
    pass('لا اعتماد على خطوط خارجية');
  }

  const html = await read('index.html');
  const inlineStyles = [...html.matchAll(/style="([^"]*)"/g)].map((m) => m[1]);
  info('أنماط سطرية في الصفحة', `${inlineStyles.length} حالة (مقصودة لضبط بسيط)`);
}

/* ------------------------- 9) حزمة الهوية والصور ------------------------- */
async function checkBrandAssets() {
  group('حزمة الهوية والصور');

  const logos = [
    'assets/brand/logo-primary.svg',
    'assets/brand/logo-stacked.svg',
    'assets/brand/logo-mark.svg',
    'assets/brand/logo-mono-ink.svg',
    'assets/brand/logo-mono-ivory.svg',
    'assets/brand/brand-board.svg',
    'assets/brand/logo-primary.png',
    'assets/brand/logo-mark.png'
  ];
  for (const f of logos) {
    if (await exists(f)) pass(`موجود: ${f}`);
    else fail(`مفقود: ${f}`);
  }

  for (const ml of [30, 50, 100]) {
    if (await exists(`assets/brand/bottle-${ml}ml.svg`)) pass(`عبوة متجهة ${ml} مل`);
    else fail(`مفقودة: عبوة ${ml} مل`);
    for (const side of ['front', 'back']) {
      const f = `assets/img/design/label-${ml}ml-${side}.svg`;
      if (await exists(f)) pass(`ملصق ${ml} مل — ${side}`);
      else fail(`مفقود: ${f}`);
    }
  }

  // الشعار في الصفحة والـ favicon
  const index = await read('index.html');
  if (/logo-mark|favicon\.svg/.test(index)) pass('أيقونة الموقع معرّفة');
  else fail('أيقونة الموقع غير معرّفة');

  // صور الاستخدام الاجتماعي
  const social = ['assets/img/design-raw/social-square.png', 'assets/img/design-raw/social-vertical.png'];
  for (const f of social) {
    if (await exists(f)) pass(`صورة سوشيال: ${f.split('/').pop()}`);
    else fail(`مفقودة: ${f}`);
  }

  // دقة صور المشاركة الاجتماعية
  const og = index.match(/<meta property="og:image" content="([^"]+)"/);
  if (og && (await exists(og[1]))) pass(`og:image موجود وصالح: ${og[1]}`);
  else fail('og:image مفقود أو غير موجود على القرص');
}

/* ------------------------- 10) صور الاستجابة (AVIF/WebP) ------------------------- */
async function checkResponsiveImages() {
  group('الصور المتجاوبة');
  const manifestPath = 'assets/img/products/manifest.json';
  if (!(await exists(manifestPath))) { fail('manifest الصور مفقود'); return; }

  const manifest = JSON.parse(await read(manifestPath));
  let files = 0;
  let missing = [];
  let avif = 0;

  for (const [base, entry] of Object.entries(manifest)) {
    if (!entry.sizes || entry.sizes.length < 2) fail(`${base}: أقل من مقاسين`);
    for (const size of entry.sizes) {
      for (const fmt of ['avif', 'webp']) {
        const f = `assets/img/products/${size[fmt]}`;
        files += 1;
        if (!(await exists(f))) missing.push(f);
        if (fmt === 'avif') avif += 1;
      }
    }
    if (!(await exists(`assets/img/products/${entry.fallback}`))) {
      missing.push(entry.fallback);
    }
  }

  if (missing.length === 0) pass(`كل ملفات الصور موجودة (${files} ملف AVIF/WebP)`);
  else fail(`ملفات ناقصة: ${missing.slice(0, 4).join(', ')}`);

  if (avif > 0) pass(`صيغة AVIF متوفرة (${avif} ملف)`);
  else fail('لا ملفات AVIF');

  const index = await read('index.html');
  if (/type="image\/avif"/.test(index)) pass('HTML يستخدم <source type="image/avif">');
  else fail('HTML لا يستخدم AVIF');
  if (/srcset="[^"]+\d+w/.test(index)) pass('srcset بعروض متعددة');
  else fail('لا srcset');

  // حجم الصور المحسّنة
  let heavy = [];
  for (const [base, entry] of Object.entries(manifest)) {
    const largest = entry.sizes[entry.sizes.length - 1];
    const bytes = largest.bytes.webp;
    if (bytes > 250 * 1024) heavy.push(`${base} (${Math.round(bytes / 1024)}KB)`);
  }
  if (heavy.length === 0) pass('لا صورة WebP تتجاوز 250KB');
  else fail(`صور ثقيلة: ${heavy.join(', ')}`);
}

/* ------------------------- 11) سير عمل GitHub Actions ------------------------- */
async function checkWorkflow() {
  group('سير عمل GitHub Actions');
  const wf = await read('.github/workflows/site-checks.yml');
  const needed = [
    ['actions/checkout', 'التحقق من المستودع'],
    ['actions/setup-node', 'تهيئة Node'],
    ['node --check js/config.js', 'فحص بناء config.js'],
    ['node --check js/cart.js', 'فحص بناء cart.js'],
    ['node scripts/check-site.mjs', 'تشغيل الفحص الآلي']
  ];
  for (const [needle, label] of needed) {
    if (wf.includes(needle)) pass(label);
    else fail(`سير العمل يفتقد: ${label}`);
  }

  if (/on:\s*[\s\S]{0,120}push:/.test(wf) && /pull_request:/.test(wf)) pass('يعمل على push و pull_request');
  else fail('سير العمل لا يعمل على push و pull_request');

  if (/permissions:\s*[\s\S]{0,80}contents:\s*read/.test(wf)) pass('أذونات محدودة (contents: read)');
  else fail('لا تحديد للأذونات');

  // وظائف إضافية للجودة
  const extraJobs = [
    ['accessibility', 'وظيفة تدقيق الإتاحة'],
    ['a11y-audit.py', 'تشغيل تدقيق axe-core'],
    ['browser-test.py', 'تشغيل اختبار المتصفح']
  ];
  for (const [needle, label] of extraJobs) {
    if (wf.includes(needle)) pass(label);
    else fail(`سير العمل يفتقد: ${label}`);
  }

  if (/upload-artifact/.test(wf)) pass('رفع تقرير الإتاحة كأثر (artifact)');
  else info('لا رفع للأثر', 'اختياري');
}

/* ------------------------- التقرير ------------------------- */
function report() {
  const groups = [...new Set(results.map((r) => r.group))];
  let failures = 0;
  let passes = 0;

  for (const g of groups) {
    const rows = results.filter((r) => r.group === g);
    console.log(`\n▸ ${g}`);
    for (const row of rows) {
      const mark = row.status === 'PASS' ? '  ✓' : row.status === 'FAIL' ? '  ✗' : '  ·';
      console.log(`${mark} ${row.label}${row.detail ? ` — ${row.detail}` : ''}`);
      if (row.status === 'FAIL') failures += 1;
      if (row.status === 'PASS') passes += 1;
    }
  }

  console.log('\n' + '─'.repeat(56));
  console.log(`نجح: ${passes} · فشل: ${failures} · معلومات: ${results.length - passes - failures}`);
  console.log(failures === 0 ? 'النتيجة: نجحت جميع الفحوصات.' : 'النتيجة: توجد فحوصات فاشلة.');
  process.exitCode = failures === 0 ? 0 : 1;
}

/**
 * 13) اتساق المستندات التسويقية مع الإعدادات.
 * أي رقم في الخطة التسويقية يجب أن يكون مشتقًا من config.js — وإلا فشل الفحص.
 */
async function checkMarketingConsistency() {
  group('اتساق المحتوى التسويقي');

  const docPath = 'docs/marketing-content-plan.md';
  if (!(await exists(docPath))) {
    fail('مستند الخطة التسويقية مفقود');
    return;
  }
  const doc = await read(docPath);
  const { config } = await loadConfig();

  // كل سعر منتج يجب أن يظهر في المستند
  for (const product of config.products) {
    const needle = `$${product.price}`;
    if (doc.includes(needle)) pass(`سعر ${product.sizeLabel} ($${product.price}) مطابق في الخطة التسويقية`);
    else fail(`الخطة التسويقية لا تذكر سعر ${product.sizeLabel} الحالي ($${product.price})`);
  }

  // النسب والرسوم
  for (const method of config.payment.methods) {
    if (method.discountPercent > 0) {
      const ok = doc.includes(`${method.discountPercent}%`);
      if (ok) pass(`نسبة ${method.label} (${method.discountPercent}%) مطابقة`);
      else fail(`الخطة التسويقية لا تذكر نسبة ${method.label} الحالية (${method.discountPercent}%)`);
    }
    if (method.deliveryFee > 0) {
      const ok = doc.includes(`$${method.deliveryFee}`);
      if (ok) pass(`رسوم ${method.label} ($${method.deliveryFee}) مطابقة`);
      else fail(`الخطة التسويقية لا تذكر رسوم ${method.label} الحالية ($${method.deliveryFee})`);
    }
  }

  // منع الادعاءات الخطرة داخل المستند نفسه.
  // العبارة الواردة داخل قائمة «ممنوع» أو مسبوقة بـ ❌/«لا نقول» ليست ادعاءً بل نهيًا عنه.
  const banned = [/نتائج\s+مضمونة/, /يعالج/, /قبل\s+و\s*بعد/, /أفضل\s+من/, /الأكثر\s+مبيع/];
  const negated = (text, match) => {
    const start = Math.max(0, match.index - 160);
    const window = text.slice(start, match.index + 80);
    return /❌|ممنوع|لا نقول|لا ننشر|لا نكتب|لا نعلن|لا نستخدم|بلا\s+ادعاء/.test(window);
  };
  const hits = [];
  for (const re of banned) {
    for (const m of doc.matchAll(new RegExp(re.source, 'g'))) {
      if (!negated(doc, m)) { hits.push(`${re} → «${m[0]}»`); break; }
    }
  }
  if (hits.length === 0) pass('الخطة التسويقية خالية من الادعاءات المحظورة');
  else fail(`ادعاء محظور داخل الخطة التسويقية: ${hits.join(' · ')}`);

  // يجب أن تنص على أن الصور تصورات تصميمية
  if (/تصور\s+تصميمي|تصورات\s+تصميمية/.test(doc)) pass('الخطة تُذكّر بأن الصور تصورات تصميمية');
  else fail('الخطة لا تُذكّر بأن الصور تصورات تصميمية');
}

try {
  const { config } = await loadConfig();
  await checkRequiredFiles();
  checkConfig(config, await read('js/config.js'));
  await checkNoScatteredPrices();
  await checkJsSyntax();
  await checkHtmlHooks();
  await checkLinks();
  await checkContentClaims();
  await checkCartLogic();
  await checkAssets();
  await checkBrandAssets();
  await checkResponsiveImages();
  await checkWorkflow();
  await checkMarketingConsistency();
} catch (error) {
  fail('خطأ غير متوقع في أداة الفحص', error.message);
}

report();
