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
import { constants, existsSync } from 'node:fs';
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
    'assets/img/products/trio-v5-1080.jpg',
    'assets/img/products/trio-v5-1080.webp',
    'assets/img/products/trio-v5-1080.avif',
    'assets/img/products/size-50-v5-720.jpg',
    'assets/img/products/size-50-v5-720.webp',
    'assets/img/products/size-50-v5-720.avif'
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
  for (const f of ['OFL-IBMPlexSansArabic.txt', 'OFL-CormorantGaramond.txt']) {
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
    { id: 'serum-30', sizeMl: 30, price: 10 },
    { id: 'serum-50', sizeMl: 50, price: 12 },
    { id: 'serum-100', sizeMl: 100, price: 15 }
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
  // رسوم مناطق التوصيل مصدرها delivery.zones أيضاً
  for (const m of cfgSrc.matchAll(/fee:\s*(\d+(?:\.\d+)?)/g)) {
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
    // تغيّر 2026-10-28: استُبدلت شبكة الثلاث بطاقات ببطاقة منتج واحدة
    // بمبدّل أحجام. الفحص يتحقق الآن من **مبدّل الأحجام** وزر الإضافة الحيّ.
    ['data-size-options', 'مبدّل أحجام المنتج'],
    ['data-price-live', 'السعر الحيّ'],
    ['data-add-current', 'زر الإضافة المرتبط بالحجم المختار'],
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
    /**
     * ⚠ درس مُكلِّف (2026-10-28): كان الفحص يأخذ **أول رابط فقط** من كل srcset.
     * فمرّ محليًا srcset يشير إلى ملفات محذوفة، وفشل النشر في CI.
     * الآن: كل مرشّح في srcset يُفحص، وكذلك كل صورة في js/config.js.
     */
    for (const m of html.matchAll(/srcset="([^"]+)"/g)) {
      for (const candidate of m[1].split(',')) {
        const url = candidate.trim().split(/\s+/)[0];
        if (url) localRefs.add(url);
      }
    }
    for (const m of html.matchAll(/imagesrcset="([^"]+)"/g)) {
      for (const candidate of m[1].split(',')) {
        const url = candidate.trim().split(/\s+/)[0];
        if (url) localRefs.add(url);
      }
    }

    for (const ref of localRefs) {
      if (!ref) continue;
      const base = path.dirname(page);
      const rel = path.normalize(path.join(base, ref));
      if (await exists(rel)) pass(`${page} → ${ref}`);
      else fail(`${page} → ${ref} (ملف مفقود)`);
    }

    // صور js/config.js — المصدر الذي يُبنى منه كل شيء في الواجهة
    if (page === 'index.html') {
      const cfg = await read('js/config.js');
      const cfgRefs = new Set();
      for (const m of cfg.matchAll(/'([\w.\-]+\.(?:avif|webp|jpg|png))'/g)) {
        cfgRefs.add('assets/img/products/' + m[1]);
      }
      for (const ref of cfgRefs) {
        if (await exists(path.normalize(ref))) pass(`config.js → ${ref.split('/').pop()}`);
        else fail(`config.js → ${ref} (ملف مفقود)`);
      }
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
  /**
   * نُزيل تعليقات الشيفرة قبل فحص الادعاءات.
   * سبب الإصلاح (2026-10-28): تعليق يشرح «لا نستعمل مختبَر سريريًا» كان يُقرأ
   * كادعاء، فيفشل الفحص بسبب نصّ لم تره زائنة قط. التعليقات ليست محتوى.
   */
  const stripComments = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  const all = index + privacy + stripComments(config);

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
    [String.raw`شهادة\s+(?:جودة|اعتماد)`, 'شهادة غير موثقة'],
    // حواجز أُضيفت مع ادّعاء «إعداد صيادلة» (2026-10-28):
    // الفارق بين «تركيبة صيدلانية» و«منتج طبي» هو الفارق بين متجر ومخالفة.
    [String.raw`مختبَر\s+سريريًا|اختبار\s+سريري`, 'ادعاء اختبار سريري'],
    [String.raw`إشراف\s+طبي|إشراف\s+طبيب`, 'ادعاء إشراف طبي'],
    [String.raw`معتمد\s+طبيًا|اعتماد\s+طبي|مرخّص\s+صحيًا`, 'ادعاء اعتماد صحي'],
    [String.raw`آمن\s+تمامًا|بلا\s+أي\s+أعراض`, 'ادعاء سلامة مطلق']
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

  /**
   * نفحص النسب **الظاهرة للزائرة** فقط: نُزيل الوسوم وترميز الروابط.
   * سبب الإصلاح (2026-10-28): رابط واتساب بترميز `%D9%85…` كان يُقرأ كنسب
   * مثل "85%" و"9%"، فيفشل الفحص بسبب محتوى لم تره زائنة قط.
   */
  const visible = all
    .replace(/<[^>]*>/g, ' ')
    .replace(/%[0-9A-Fa-f]{2}/g, ' ')
    .replace(/&#?[a-zA-Z0-9]+;/g, ' ');

  const badPercents = [];
  let percentCount = 0;
  for (const m of visible.matchAll(/([\d٠-٩]+)\s*(?:٪|%)/g)) {
    percentCount += 1;
    if (!allowedPercents.has(m[1])) badPercents.push(m[0].trim());
  }
  if (badPercents.length === 0) {
    pass(`كل نسبة مئوية معروضة معرّفة في config.js (${percentCount} إشارة، مسموح: ${[...allowedPercents].join('/') || '—'})`);
  } else {
    fail(`نسب مئوية غير موثقة: ${badPercents.join(' · ')}`);
  }

  // أصل الثقة الأساسي: إعداد صيادلة ومختصين. إن اختفى من الصفحة، فذلك قرار لا سهو.
  if (/صيادل/.test(index) && /مختص/.test(index)) {
    pass('أصل الثقة منشور: إعداد صيادلة ومختصين');
  } else {
    fail('اختفى ادّعاء إعداد الصيادلة والمختصين من الصفحة — إن كان مقصودًا فأزله من الفحص أيضًا');
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
    { cart: { 'serum-30': 1 }, expected: 10 },
    { cart: { 'serum-50': 2 }, expected: 24 },
    { cart: { 'serum-100': 3 }, expected: 45 },
    { cart: { 'serum-30': 2, 'serum-50': 1 }, expected: 32 },
    { cart: { 'serum-30': 1, 'serum-50': 1, 'serum-100': 1 }, expected: 37 }
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
  /**
   * ⚠ درس متكرّر (2026-10-28): كانت قائمة الصور **مكتوبة يدويًا** هنا. في كل
   * إعادة تصميم تبقى القائمة تشير إلى صور محذوفة، فيفشل الفحص بعد أن نجح
   * الموقع. الحل الجذري: لا قائمة. نقرأ الصور من مصدرها الحقيقي —
   * index.html و js/config.js — ونفحص كل ما هو مذكور فعلًا.
   */
  const htmlSrc = await read('index.html');
  const cfgSrc = await read('js/config.js');
  const images = [...new Set([
    ...[...htmlSrc.matchAll(/assets\/img\/products\/([\w\-.]+\.(?:avif|webp|jpg|png))/g)].map((m) => 'assets/img/products/' + m[1]),
    ...[...cfgSrc.matchAll(/'([\w\-.]+\.(?:avif|webp|jpg|png))'/g)]
      .map((m) => 'assets/img/products/' + m[1])
      .filter((x) => !x.includes('undefined'))
  ])].sort();
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
    'assets/fonts/plexar-400.subset.woff2',
    'assets/fonts/plexar-500.subset.woff2',
    'assets/fonts/plexar-700.subset.woff2',
    'assets/fonts/cormorant-500-latin.subset.woff2',
    'assets/fonts/plexar-latin.subset.woff2',
    'assets/fonts/plexar-bold-latin.subset.woff2'
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
  if (fontBytes < 100 * 1024) pass(`إجمالي وزن الخطوط ${Math.round(fontBytes / 1024)}KB (حد 100KB)`);
  else fail(`إجمالي وزن الخطوط ${Math.round(fontBytes / 1024)}KB يتجاوز 100KB`);

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

/* ------------------------- 8ب) الأمان ورؤوس الحماية ------------------------- */
async function checkSecurity() {
  group('الأمان');

  const index = await read('index.html');
  const privacy = await read('privacy.html');

  // 1) CSP موجود في الصفحتين
  for (const [name, html] of [['index.html', index], ['privacy.html', privacy]]) {
    const m = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/);
    if (!m) { fail(`${name}: سياسة CSP مفقودة`); continue; }
    const csp = m[1];
    const need = ["default-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'"];
    const missing = need.filter((n) => !csp.includes(n));
    if (missing.length) fail(`${name}: CSP ناقص → ${missing.join(', ')}`);
    else pass(`${name}: CSP مكتمل (${csp.split(';').length} توجيهًا)`);
  }

  // 2) frame-ancestors لا يعمل داخل meta — يجب ألا يكون موجودًا هناك
  for (const [name, html] of [['index.html', index], ['privacy.html', privacy]]) {
    const m = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/);
    if (m && m[1].includes('frame-ancestors')) {
      fail(`${name}: frame-ancestors داخل meta — يُتجاهل ويطلق تحذيرًا في وحدة التحكم`);
    } else {
      pass(`${name}: لا توجيهات مُتجاهلة داخل meta`);
    }
  }

  // 3) _headers موجود ويحتوي رؤوسًا حقيقية
  const headers = await read('_headers');
  if (!headers) {
    fail('_headers مفقود — رؤوس الأمان لن تُطبَّق عند النقل إلى Cloudflare');
  } else {
    for (const h of ['X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy',
                     'Permissions-Policy', 'Strict-Transport-Security', 'Content-Security-Policy']) {
      if (headers.includes(h)) pass(`_headers: ${h}`);
      else fail(`_headers: ${h} مفقود`);
    }
    if (headers.includes("frame-ancestors 'none'")) pass('frame-ancestors في مكانه الصحيح (رأس HTTP)');
    else fail('frame-ancestors مفقود من _headers');
  }

  // 4) لا مداخل خطرة في الشيفرة
  for (const f of ['js/config.js', 'js/cart.js']) {
    const code = await read(f);
    if (/\beval\s*\(|new\s+Function\s*\(|document\.write\s*\(/.test(code)) {
      fail(`${f}: يحتوي eval/Function/document.write`);
    } else {
      pass(`${f}: خالٍ من التنفيذ الديناميكي`);
    }
  }

  // 5) كل الروابط الخارجية تحمل rel="noopener"
  const external = [...index.matchAll(/<a[^>]+href="https?:\/\/[^"]+"[^>]*>/g)].map((m) => m[0]);
  const unsafe = external.filter((t) => t.includes('target="_blank"') && !t.includes('noopener'));
  if (unsafe.length) fail(`${unsafe.length} رابط خارجي بلا noopener`);
  else pass(`كل الروابط الخارجية آمنة (${external.length} رابطًا)`);
}

/* ------------------------- 9) حزمة الهوية والصور ------------------------- */
async function checkBrandAssets() {
  group('حزمة الهوية والصور');

  const logos = [
    'assets/brand/logo-primary-v2.svg',
    'assets/brand/logo-mark-v2.svg',
    'assets/brand/logo-primary-v2.svg',
    'assets/brand/logo-mark-v2.svg',
    'assets/favicon.svg'
  ];
  for (const f of logos) {
    if (await exists(f)) pass(`موجود: ${f}`);
    else fail(`مفقود: ${f}`);
  }

  // لكل حجم: مشهد مولّد بثلاث صيغ — وهذا ما تعرضه الصفحة فعليًا
  for (const ml of [30, 50, 100]) {
    const base = `assets/img/products/size-${ml}`;
    for (const f of [`${base}-v5-720.avif`, `${base}-v5-720.webp`, `${base}-v5-720.jpg`]) {
      if (await exists(f)) pass(`مشهد ${ml} مل — ${f.split('.').pop()}`);
      else fail(`مفقود: ${f}`);
    }
  }

  // الشعار في الصفحة والـ favicon
  const index = await read('index.html');
  if (/logo-mark|favicon\.svg/.test(index)) pass('أيقونة الموقع معرّفة');
  else fail('أيقونة الموقع غير معرّفة');

  // صور الاستخدام الاجتماعي
  // صور السوشيال: تُستخدم خارج الموقع (فيسبوك/إنستغرام) فلا تظهر في HTML — نطابق أحدث إصدار متاح
  const latest = (base) => {
    for (const v of ['v5', 'v4', 'v3']) {
      const f = `assets/img/products/${base}-${v}-1080.avif`;
      if (existsSync(path.join(ROOT, f))) return f;
    }
    return `assets/img/products/${base}-v4-1080.avif`;
  };
  const social = [latest('social-square'), latest('social-vertical')];
  for (const f of social) {
    if (await exists(f)) pass(`صورة سوشيال: ${f.split('/').pop()}`);
    else fail(`مفقودة: ${f}`);
  }

  // دقة صور المشاركة الاجتماعية
  const og = index.match(/<meta property="og:image" content="([^"]+)"/);
  if (!og) {
    fail('og:image مفقود');
  } else {
    // الصورة قد تكون رابطًا مطلقًا على النطاق المنشور أو مسارًا نسبيًا محليًا
    const raw = og[1];
    // أصل الموقع المنشور — بدّله عند الانتقال إلى نطاق خاص
    const SITE_BASE = 'https://raawaa-store.pages.dev/';
    let localPath;
    if (raw.startsWith(SITE_BASE)) localPath = raw.slice(SITE_BASE.length);
    else if (raw.startsWith('http')) localPath = raw.replace(/^https?:\/\/[^/]+\//, '');
    else localPath = raw.replace(/^\.\//, '');
    if (raw.startsWith('http')) {
      if (await exists(localPath)) pass(`og:image مطلق ويشير إلى ملف موجود: ${raw}`);
      else fail(`og:image مطلق لكن الملف غير موجود محليًا: ${raw}`);
    } else if (await exists(localPath)) {
      pass(`og:image موجود وصالح: ${raw}`);
    } else {
      fail('og:image مفقود أو غير موجود على القرص');
    }
  }
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
        if (!size[fmt]) continue;              // مقاس بلا هذه الصيغة — تخطَّه
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
    const file = largest.webp || largest.avif || largest.jpg;
    if (!file || !(await exists(`assets/img/products/${file}`))) continue;
    const bytes = await sizeOf(`assets/img/products/${file}`);
    if (bytes > 300 * 1024) heavy.push(`${base} (${Math.round(bytes / 1024)}KB)`);
  }
  if (heavy.length === 0) pass('لا صورة تتجاوز 300KB');
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

/**
 * 14) PWA: مانيفست + عامل خدمة + أيقونات.
 * أيقونات iOS و Android هي ما يجعل الموقع «تطبيقًا» على شاشة الآيفون.
 */
async function checkPwa() {
  group('تطبيق الويب التثبيتي (PWA)');

  for (const f of ['manifest.webmanifest', 'sw.js']) {
    if (await exists(f)) pass(`${f} موجود`);
    else fail(`${f} مفقود`);
  }

  const icons = [
    'assets/icons/icon-192.png',
    'assets/icons/icon-512.png',
    'assets/icons/icon-maskable-512.png',
    'assets/icons/apple-touch-icon.png',
    'assets/icons/favicon-64.png'
  ];
  for (const f of icons) {
    if (await exists(f)) pass(`أيقونة: ${f.split('/').pop()}`);
    else fail(`أيقونة مفقودة: ${f}`);
  }

  if (await exists('manifest.webmanifest')) {
    let mani = null;
    try {
      mani = JSON.parse(await read('manifest.webmanifest'));
    } catch (error) {
      fail('المانيفست ليس JSON صالحًا');
    }
    if (mani) {
      if (mani.dir === 'rtl') pass('المانيفست يعلن اتجاه rtl');
      else fail('المانيفست لا يعلن rtl');
      if (mani.lang && String(mani.lang).startsWith('ar')) pass(`لغة المانيفست: ${mani.lang}`);
      else fail('لغة المانيفست ليست عربية');
      if (mani.display === 'standalone') pass('وضع العرض standalone');
      else fail('وضع العرض ليس standalone');
      const purposes = new Set((mani.icons || []).map((i) => i.purpose || 'any'));
      if (purposes.has('any') && purposes.has('maskable')) pass('المانيفست يحتوي any + maskable');
      else fail('المانيفست لا يحتوي الأيقونات المطلوبة');

      // كل أيقونة معلنة يجب أن تكون موجودة فعليًا
      for (const icon of mani.icons || []) {
        if (await exists(icon.src)) pass(`أيقونة المانيفست موجودة: ${icon.src.split('/').pop()}`);
        else fail(`أيقونة المانيفست مفقودة على القرص: ${icon.src}`);
      }
    }
  }

  const index = await read('index.html');
  const declared = [
    ['rel="manifest"', 'ربط المانيفست'],
    ['apple-touch-icon', 'أيقونة آيفون'],
    ['apple-mobile-web-app-capable', 'دعم التثبيت على iOS'],
    ['serviceWorker.register', 'تسجيل عامل الخدمة']
  ];
  for (const [needle, label] of declared) {
    if (index.includes(needle)) pass(label);
    else fail(`مفقود في index.html: ${label}`);
  }

  // عامل الخدمة يجب ألا يخزّن نطاقات خارجية (لا تتبّع، لا تسريب)
  if (await exists('sw.js')) {
    const sw = await read('sw.js');
    if (/origin\s*!==\s*self\.location\.origin/.test(sw)) pass('عامل الخدمة يتجاهل النطاقات الخارجية');
    else fail('عامل الخدمة لا يقيّد الطلبات بالنطاق نفسه');
    if (!/analytics|gtag|fbq|hotjar/i.test(sw)) pass('عامل الخدمة بلا أي تتبّع');
    else fail('عامل الخدمة يحتوي أثر تتبّع');
  }
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
  await checkSecurity();
  await checkBrandAssets();
  await checkResponsiveImages();
  await checkWorkflow();
  await checkMarketingConsistency();
  await checkPwa();
} catch (error) {
  fail('خطأ غير متوقع في أداة الفحص', error.message);
}

report();
