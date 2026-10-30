#!/usr/bin/env node
/**
 * RAWAA — تدقيق المراجع والأصول (بوابة محلية، بلا شبكة وبلا متصفح).
 *
 * لماذا هذا الملف؟
 * بوابات المشروع الحالية تحتاج شبكة (asset-audit) أو Chromium (browser-test،
 * perf-budget)، لذلك لا تعمل في أي بيئة بلا إنترنت أو بلا متصفح — وهي بالضبط
 * البيئة التي يُطلب فيها التحقق السريع أحيانًا. النتيجة: أعطال مثل «مرجع صورة
 * محذوفة» و«صفحة 404 بلا تنسيق» تمرّ بلا كشف.
 *
 * ما يفحصه (كل بند ناتج عن عطل حقيقي أو خطر حقيقي):
 *  1. كل مسار محلي مذكور في HTML/CSS/JS/المانيفست موجود فعلًا على القرص.
 *  2. كل ملف خط مذكور في @font-face موجود، وكل خط موجود مذكور في CSS (لا خطوط ميتة).
 *  3. قائمة CORE في عامل الخدمة: كل مسار موجود (ومسارات الصفحات تُستثنى).
 *  4. صفحة 404 تستخدم مسارات مطلقة (تعمل من أي عمق) — العطل الذي أصلحناه.
 *  5. كل <img> له alt و width و height (منع الاهتزاز البصري).
 *  6. لا معرّفات مكرّرة داخل الصفحة.
 *  7. أسعار JSON-LD = أسعار js/config.js (بلا تكرار يدوي).
 *  8. كل رابط في sitemap.xml يقابل صفحة موجودة.
 *
 * الاستخدام: node scripts/ref-audit.mjs [--quiet]
 * الخروج بغير الصفر عند أي فشل — صالح لـ CI.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const QUIET = process.argv.includes('--quiet');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

let pass = 0;
const failures = [];
const notes = [];

function ok(msg) { pass++; if (!QUIET) console.log(`  ✓ ${msg}`); }
function fail(msg, detail) { failures.push(detail ? `${msg} — ${detail}` : msg); console.log(`  ✗ ${msg}${detail ? ` — ${detail}` : ''}`); }
function note(msg) { notes.push(msg); if (!QUIET) console.log(`  · ${msg}`); }

const PAGES = ['index.html', 'serum.html', 'privacy.html', '404.html', 'check.html', 'setup.html'];
const SCRIPTS = ['js/config.js', 'js/cart.js', 'js/marketing.js', 'js/serum-views.js'];
const STYLES = ['css/styles.css', 'css/serum.css'];
const EXTERNAL = /^(?:[a-z]+:|\/\/|#|data:|mailto:|tel:)/i;

/** مسارات تُخدم عبر توجيه وليست ملفات على القرص */
const ROUTES = new Set(['/', '/serum', '/privacy', '/404', '/owner', '/owner/']);

console.log('\n▸ مراجع الملفات');
{
  const sources = [...PAGES, ...SCRIPTS, ...STYLES, 'sw.js', 'manifest.webmanifest', 'owner/index.html', 'owner/app.mjs'];
  const missing = [];
  for (const file of sources) {
    if (!exists(file)) { fail(`ملف مصدر مفقود: ${file}`); continue; }
    const src = read(file);
    const refs = new Set();
    // مراجع مباشرة لملفات داخل المشروع
    for (const m of src.matchAll(/['"(]\s*((?:\.{0,2}\/)?(?:assets|css|js|owner)\/[A-Za-z0-9._\/-]+\.(?:avif|webp|jpg|jpeg|png|svg|ico|woff2|css|js|mjs|json|html))/g)) {
      refs.add(m[1]);
    }
    // مراجع CSS النسبية من داخل مجلد css
    for (const m of src.matchAll(/url\(['"]?((?:\.\.\/)+[A-Za-z0-9._\/-]+\.(?:woff2|png|svg|jpg|webp|avif))['"]?\)/g)) {
      refs.add(m[1]);
    }
    for (const raw of refs) {
      if (EXTERNAL.test(raw)) continue;
      const rel = raw.startsWith('../') ? path.posix.join(path.posix.dirname(file), raw)
        : raw.startsWith('./') ? raw.slice(2) : raw;
      if (!exists(rel)) missing.push(`${file} → ${raw}`);
    }
  }
  if (missing.length) { missing.forEach((m) => fail(`مرجع مكسور: ${m}`)); }
  else ok(`كل المراجع المحلية في ${sources.length} ملفًا موجودة`);
}

console.log('\n▸ الخطوط');
{
  const css = STYLES.map(read).join('\n');
  const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]);
  const declared = new Set();
  for (const face of faces) {
    const url = (face.match(/url\(['"]?([^'")]+)['"]?\)/) || [])[1];
    if (!url) { fail('@font-face بلا ملف'); continue; }
    declared.add(path.posix.basename(url));
    if (!exists(path.posix.join('css', url))) fail(`ملف خط مفقود: ${url}`);
  }
  const onDisk = fs.readdirSync(path.join(ROOT, 'assets/fonts')).filter((f) => f.endsWith('.woff2'));
  const orphans = onDisk.filter((f) => !declared.has(f));
  // خط لا تطلبه CSS لا يُحمَّل أبدًا، لكنه يُنشر ويُخزَّن مسبقًا في عامل الخدمة.
  if (orphans.length) orphans.forEach((f) => fail(`خط منشور لا تستعمله CSS: ${f}`));
  else ok(`${declared.size} خطًا معلنًا ومستخدمًا، بلا ملفات يتيمة`);
}

console.log('\n▸ عامل الخدمة');
{
  const sw = read('sw.js');
  const core = (sw.match(/const CORE = \[([\s\S]*?)\];/) || [])[1] || '';
  const entries = [...core.matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]);
  if (!entries.length) fail('قائمة CORE غير قابلة للقراءة');
  // '' هي الجذر، و'serum' مسار يُقدَّم من serum.html عبر توجيه Cloudflare
  // (html_handling: auto-trailing-slash) — ليست ملفًا على القرص، فلا تُعد مفقودة.
  const routeEntries = new Set(['', 'serum', 'privacy']);
  const broken = entries.filter((e) => e && !routeEntries.has(e) && !exists(e));
  if (broken.length) broken.forEach((b) => fail(`CORE يشير إلى ملف مفقود: ${b}`));
  else ok(`${entries.length} أصلًا في CORE كلها موجودة`);
  if (/v\d{6,}/.test(sw)) ok('CACHE_VERSION بصيغة إصدار');
  else fail('CACHE_VERSION ليس بصيغة إصدار صالحة');
}

console.log('\n▸ صفحات مساعدة');
{
  const nf = read('404.html');
  const rel = [...nf.matchAll(/(?:href|src)="((?!\/|#|https?:)[^"]+)"/g)].map((m) => m[1]);
  if (rel.length) rel.forEach((r) => fail(`404.html يستخدم مسارًا نسبيًا (ينكسر في المسارات العميقة): ${r}`));
  else ok('404.html بمسارات مطلقة فقط');

  for (const page of ['check.html', 'setup.html']) {
    if (!/name="robots"[^>]*noindex/.test(read(page))) fail(`${page} بلا noindex`);
    else ok(`${page} غير مفهرس`);
  }
}

console.log('\n▸ نزاهة الترميز');
{
  const config = read('js/config.js');
  const prices = [...config.matchAll(/\bprice:\s*(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
  const low = Math.min(...prices), high = Math.max(...prices);
  for (const page of ['index.html', 'serum.html']) {
    const html = read(page);
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    if (!blocks.length) { fail(`${page}: لا JSON-LD`); continue; }
    for (const block of blocks) {
      let data;
      try { data = JSON.parse(block[1]); } catch (e) { fail(`${page}: JSON-LD غير صالح`, e.message); continue; }
      const nodes = data['@graph'] || [data];
      const product = nodes.find((n) => n['@type'] === 'Product');
      if (!product) { fail(`${page}: لا كائن Product`); continue; }
      const offer = product.offers || {};
      const offerPrices = (offer.offers || []).map((o) => Number(o.price)).sort((a, b) => a - b);
      const same = offerPrices.length === prices.length
        && offerPrices.every((p, i) => Math.abs(p - [...prices].sort((a, b) => a - b)[i]) < 0.001);
      if (!same) fail(`${page}: أسعار العروض لا تطابق config.js`, offerPrices.join(','));
      else ok(`${page}: أسعار JSON-LD مطابقة (${offerPrices.join(' / ')})`);
      if (Number(offer.lowPrice) !== low || Number(offer.highPrice) !== high) {
        fail(`${page}: حدود AggregateOffer لا تطابق config.js`);
      } else ok(`${page}: حدود الأسعار مطابقة (${low}–${high})`);
    }

    const imgs = [...html.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
    const badImg = imgs.filter((t) => !/\balt=/.test(t) || !/\bwidth=/.test(t) || !/\bheight=/.test(t));
    if (badImg.length) badImg.forEach((t) => fail(`${page}: <img> بلا alt/width/height`, t.slice(0, 70)));
    else ok(`${page}: ${imgs.length} صورة بأبعاد وalt`);

    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (dup.length) [...new Set(dup)].forEach((d) => fail(`${page}: معرّف مكرّر: ${d}`));
    else ok(`${page}: ${ids.length} معرّفًا بلا تكرار`);
  }
}

console.log('\n▸ إتاحة وSEO أساسيان (بلا متصفح)');
{
  for (const page of PAGES) {
    const html = read(page);
    const problems = [];

    if (!/<html[^>]+lang="ar"/.test(html)) problems.push('لا lang="ar"');
    if (!/<html[^>]+dir="rtl"/.test(html)) problems.push('لا dir="rtl"');

    const h1s = [...html.matchAll(/<h1\b/g)].length;
    if (h1s !== 1) problems.push(`عدد <h1> = ${h1s} (المطلوب 1)`);

    const noindex = /name="robots"[^>]*noindex/.test(html);
    const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
    if (!title.trim()) problems.push('لا <title>');
    else if (title.length > 70) problems.push(`<title> طويل (${title.length} حرفًا)`);
    // صفحات noindex (404 وتشخيص وإعداد) لا تحتاج وصف بحث ولا بطاقة مشاركة.
    if (!noindex && page !== '404.html' && !/<meta name="description" content="[^"]{40,}"/.test(html)) {
      problems.push('لا وصف meta كافٍ');
    }

    // أزرار وروابط بلا نص ظاهر ولا اسم وصولي
    const buttons = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
    for (const [, attrs, inner] of buttons) {
      const text = inner.replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, '').trim();
      if (!text && !/aria-label=/.test(attrs)) problems.push(`زر بلا نص ولا aria-label: ${('<' + attrs + '>').slice(0, 60)}`);
    }
    const links = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)];
    for (const [, attrs, inner] of links) {
      const text = inner.replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, '').trim();
      if (!text && !/aria-label=/.test(attrs)) problems.push(`رابط بلا نص ولا aria-label: ${('<' + attrs + '>').slice(0, 60)}`);
    }

    // الحقول: كل حقل يحتاج label أو aria-label
    const labelsFor = new Set([...html.matchAll(/<label[^>]+for="([^"]+)"/g)].map((m) => m[1]));
    for (const m of html.matchAll(/<input\b([^>]*)>/g)) {
      const attrs = m[1];
      if (/type="(hidden|submit|button)"/.test(attrs)) continue;
      const id = (attrs.match(/id="([^"]+)"/) || [])[1];
      if (!/aria-label=/.test(attrs) && !(id && labelsFor.has(id))) {
        problems.push(`حقل بلا تسمية: ${('<' + attrs + '>').slice(0, 60)}`);
      }
    }

    // ترتيب التنقّل بالمفاتيح: tabindex موجب يخرّب الترتيب الطبيعي
    if (/tabindex="[1-9]/.test(html)) problems.push('tabindex موجب');

    if (problems.length) problems.forEach((pr) => fail(`${page}: ${pr}`));
    else ok(`${page}: lang/dir + h1 واحد + أسماء أزرار وروابط وحقول + بلا tabindex موجب`);
  }
}

console.log('\n▸ ثوابت الأسعار والدفع (من js/config.js)');
{
  // نحمّل ملف الإعدادات كما يفعل المتصفح: window.RAWAA_CONFIG عبر vm.
  const vm = await import('node:vm');
  const sandbox = { window: {} };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read('js/config.js'), sandbox);
  const cfg = sandbox.window.RAWAA_CONFIG;

  if (!cfg) { fail('js/config.js لم يُنتج window.RAWAA_CONFIG'); }
  else {
    const products = [...cfg.products].sort((a, b) => a.sizeMl - b.sizeMl);

    // 1) السعر يزيد مع الحجم، وسعر الملليلتر يقل — هذه هي «أوفر كلما كبر الحجم»
    //    التي تقولها واجهة السلة؛ إن انكسرت صارت الجملة ادعاءً كاذبًا.
    const ascending = products.every((p, i) => i === 0 || p.price > products[i - 1].price);
    ascending ? ok('السعر يزيد مع الحجم (لا بيع بخسارة على الأكبر)')
      : fail('ترتيب الأسعار لا يزيد مع الحجم', products.map((p) => `${p.sizeMl}ml=${p.price}`).join(' / '));

    const perMl = products.map((p) => p.price / p.sizeMl);
    const cheaper = perMl.every((v, i) => i === 0 || v < perMl[i - 1]);
    cheaper ? ok(`سعر المل يقل مع الحجم (${perMl.map((v) => v.toFixed(3)).join(' > ')})`)
      : fail('سعر الملليلتر غير متناقص — عبارة «كل حجم أوفر» تصبح غير صحيحة');

    // 2) هامش موجب في أسوأ حالة: أعلى تكلفة + أكبر خصم.
    const maxCost = cfg.costing?.unitCostMax ?? 0;
    const maxDiscount = Math.max(0, ...(cfg.payment?.methods || []).map((m) => m.discountPercent || 0));
    const worst = products.map((p) => ({
      size: p.sizeMl,
      profit: +(p.price * (1 - maxDiscount / 100) - maxCost).toFixed(2)
    }));
    const losing = worst.filter((w) => w.profit <= 0);
    if (losing.length) fail('حجم لا يحقق ربحًا في أسوأ حالة', losing.map((w) => `${w.size}ml=${w.profit}$`).join(', '));
    else ok(`هامش موجب في أسوأ حالة (تكلفة ${maxCost}$ + خصم ${maxDiscount}%): ${worst.map((w) => `${w.size}ml=${w.profit}$`).join(' · ')}`);

    // 3) مناطق التوصيل: رسوم غير سالبة، والتوصيل المجاني يخصّ مناطق موجودة.
    const zones = cfg.delivery?.zones || [];
    const zoneIds = new Set(zones.map((z) => z.id));
    const badZones = zones.filter((z) => !(z.fee >= 0));
    badZones.length ? fail('منطقة توصيل برسوم سالبة') : ok(`${zones.length} منطقة توصيل برسوم سليمة`);
    if (!zoneIds.has(cfg.delivery?.defaultZone)) fail('منطقة التوصيل الافتراضية غير موجودة في القائمة');
    else ok('منطقة التوصيل الافتراضية موجودة');
    for (const m of cfg.payment?.methods || []) {
      for (const z of m.freeDeliveryIn || []) {
        if (!zoneIds.has(z)) fail(`طريقة ${m.id}: توصيل مجاني لمنطقة غير معرّفة (${z})`);
      }
    }
    const discountsOk = (cfg.payment?.methods || []).every((m) => (m.discountPercent || 0) >= 0 && (m.discountPercent || 0) <= 50);
    discountsOk ? ok('نسب الخصم داخل 0–50%') : fail('نسبة خصم خارج النطاق المعقول');

    // 4) رقم واتساب بصيغة دولية صالحة (بلا + أو مسافات)، والرابط يُبنى منه.
    const wa = cfg.contact?.whatsappNumber || '';
    if (!/^\d{11,15}$/.test(wa)) fail(`رقم واتساب غير صالح: "${wa}"`);
    else if (!wa.startsWith('963')) fail(`رقم واتساب لا يبدأ بمقدمة سوريا: ${wa}`);
    else ok(`رقم واتساب صالح الصيغة (${wa.length} رقمًا)`);
  }
}

console.log('\n▸ خريطة الموقع');
{
  const sitemap = read('sitemap.xml');
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  if (!locs.length) fail('sitemap.xml بلا روابط');
  const bad = [];
  for (const loc of locs) {
    const p = new URL(loc).pathname;
    if (ROUTES.has(p)) continue;
    const file = p.replace(/^\//, '');
    if (!exists(file) && !exists(`${file}.html`)) bad.push(loc);
  }
  if (bad.length) bad.forEach((b) => fail(`sitemap يشير إلى صفحة غير موجودة: ${b}`));
  else ok(`${locs.length} رابطًا في الخريطة كلها قابلة للتقديم`);
}

console.log('─'.repeat(56));
if (failures.length) {
  console.log(`فشل: ${failures.length} · نجح: ${pass}`);
  process.exit(1);
}
console.log(`نجح: ${pass} · فشل: 0 · ملاحظات: ${notes.length}`);
