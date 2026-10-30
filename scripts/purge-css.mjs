/**
 * RAWAA — إزالة قواعد CSS غير المستخدمة (تقريب آمن، بلا مكتبات خارجية).
 *
 * المشكلة المقاسة: styles.css يحتوي قواعد لأقسام حُذفت عبر أشهر من إعادة البناء
 * (شبكة بطاقات المنتجات القديمة، المعرض، بطاقات المواصفات، جدول التركيبة القديم).
 * كل قاعدة ميتة تُرسَل إلى كل زائنة على شبكة بطيئة، وتزيد كلفة الصيانة.
 *
 * الأمان أولًا:
 *  - المصادر تُقرأ من **كل** صفحات الموقع وملفات JS/MJS، لا من صفحة واحدة.
 *  - لا نُزيل أي قاعدة داخل @media/@supports/@keyframes (تُبنى ديناميكيًا).
 *  - لا نُزيل قاعدة تحوي :hover/:focus/:target/:not/::before… (حالات تفاعلية).
 *  - لا نُزيل قاعدة تحوي محددًا بسمة [..] أو معرّفًا #.. (تُبنى من JS).
 *  - أي اسم فصل يظهر حرفيًا في أي مصدر = مستعمل.
 *
 * الاستخدام:
 *   node scripts/purge-css.mjs           # تقرير فقط، يكتب css/styles.purged.css للمراجعة
 *   node scripts/purge-css.mjs --apply   # يستبدل css/styles.css بعد المراجعة
 *   node scripts/purge-css.mjs --check   # يفشل (exit 1) إذا كان الحذف يتجاوز 5% بلا تطبيق
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const APPLY = process.argv.includes('--apply');
const CHECK = process.argv.includes('--check');
const cssPath = path.join(ROOT, 'css/styles.css');
const css = fs.readFileSync(cssPath, 'utf8');

/** كل المصادر التي قد تذكر اسم فصل — أي إغفال هنا يعني حذف تنسيق حيّ. */
const SOURCE_FILES = [
  'index.html', 'serum.html', 'privacy.html', '404.html', 'check.html', 'setup.html',
  'owner/index.html', 'owner/app.mjs', 'owner/owner-client.mjs',
  'js/cart.js', 'js/config.js', 'js/marketing.js', 'js/serum-views.js'
];

const sources = SOURCE_FILES
  .map((f) => {
    try { return fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch { return ''; }
  })
  .join('\n');

/**
 * أسماء الفصول المستعملة: نقبل أي ظهور حرفي لاسم الفصل ككلمة مستقلة داخل
 * مصدر، لا فقط داخل class="..." — لأن JS يبني الفصول بطرق متعددة.
 */
const usedTokens = new Set();
for (const m of sources.matchAll(/(?:class|className)\s*=\s*["']([^"']+)["']/g)) {
  m[1].split(/\s+/).forEach((t) => t && usedTokens.add(t));
}
for (const m of sources.matchAll(/classList\.(?:add|remove|toggle|contains)\(\s*['"]([^'"]+)['"]/g)) usedTokens.add(m[1]);
for (const m of sources.matchAll(/querySelector(?:All)?\(\s*['"]([^'"]+)['"]/g)) {
  for (const t of m[1].matchAll(/\.([a-zA-Z][\w-]*)/g)) usedTokens.add(t[1]);
}
// أي نص بين علامتي اقتباس يُقسَّم إلى كلمات: يغطي 'a b' و' a b' والأسماء المركّبة
// في JS مثل: card.className = 'pay-card' + (best ? ' pay-card-featured' : '')؛
for (const m of sources.matchAll(/['"`]([^'"`\n]{1,120})['"`]/g)) {
  m[1].split(/\s+/).forEach((t) => t && usedTokens.add(t));
}

const usedIds = new Set([...sources.matchAll(/id=["']([^"']+)["']/g)].map((m) => m[1]));
const usedTags = new Set([...sources.matchAll(/<([a-z][a-z0-9]*)[\s>]/g)].map((m) => m[1]));

/** محددات آمنة للبقاء */
function selectorIsUsed(sel) {
  const s = sel.trim();
  if (!s || s.startsWith('@') || s.startsWith('from') || s.startsWith('to') || /^\d/.test(s)) return true;
  if (s === '*' || s.startsWith('*') || s === ':root') return true;
  // حالات تفاعلية أو عناصر مولّدة: تُبقى دائمًا
  if (/::|:(hover|focus|focus-visible|focus-within|active|visited|disabled|checked|placeholder|selection|target|not\(|is\(|where\(|has\(|first|last|nth|only|empty|root|lang\(|dir\()/.test(s)) return true;
  if (/\[[^\]]*\]/.test(s)) return true; // محددات السمات تُبنى من JS
  const cleaned = s.replace(/::?(hover|focus|focus-visible|focus-within|active|visited|disabled|checked|placeholder|selection|before|after)[\w-()]*/g, '');
  const lastSimple = cleaned.split(/[\s>+~]+/).filter(Boolean).pop() || cleaned;
  const cls = [...lastSimple.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]);
  const id = [...lastSimple.matchAll(/#([a-zA-Z][\w-]*)/g)].map((m) => m[1]);
  if (id.length) return id.some((x) => usedIds.has(x)) || true; // المعرّفات: نُبقيها احتياطًا
  if (cls.length) {
    // يكفي أن يكون أحد الفصول مستعملًا، لكن إن كان الفصل الأخير (المؤثر) ميتًا
    // والقاعدة لا تحمل أي فصل حيّ آخر، فالقاعدة ميتة.
    return cls.some((x) => usedTokens.has(x));
  }
  const tag = (lastSimple.match(/^([a-z][a-z0-9]*)/) || [])[1];
  if (tag) return usedTags.has(tag) || ['html', 'body', 'root'].includes(tag);
  return true;
}

function splitBlocks(text) {
  const blocks = [];
  let depth = 0, start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) { blocks.push(text.slice(start, i + 1)); start = i + 1; }
    }
  }
  if (start < text.length) blocks.push(text.slice(start));
  return blocks;
}

const out = [];
const dropped = [];
/** يزيل تعليقات CSS من بداية البلوك لاكتشاف @media/@supports التي يسبقها تعليق */
function stripLeadingComments(text) {
  let s = text.trimStart();
  while (s.startsWith('/*')) {
    const end = s.indexOf('*/');
    if (end < 0) break;
    s = s.slice(end + 2).trimStart();
  }
  return s;
}

for (const block of splitBlocks(css)) {
  const head = stripLeadingComments(block);
  // @media/@supports/@font-face/@keyframes قد يسبقها تعليق: تُبقى كما هي.
  if (head.startsWith('@') || head === '') { out.push(block); continue; }
  const brace = block.indexOf('{');
  if (brace < 0) { out.push(block); continue; }
  const rawSelectors = block.slice(0, brace);
  // احذف التعليقات من نص المحدِّدات قبل تحليلها
  const selectors = rawSelectors.replace(/\/\*[\s\S]*?\*\//g, '').split(',').map((x) => x.trim()).filter(Boolean);
  if (selectors.some(selectorIsUsed)) out.push(block);
  else dropped.push(selectors.join(', '));
}

const result = out.join('');
const saved = css.length - result.length;
const pct = ((saved / css.length) * 100).toFixed(1);
const reportPath = path.join(ROOT, 'css/styles.purged.css');

if (APPLY) {
  fs.writeFileSync(cssPath, result, 'utf8');
  try { fs.unlinkSync(reportPath); } catch { /* لم يكن موجودًا */ }
  console.log(`طُبِّق: قواعد مُزالة ${dropped.length} · توفير ${(saved / 1024).toFixed(1)} KB (${pct}%)`);
} else {
  fs.writeFileSync(reportPath, result, 'utf8');
  console.log(`قواعد مُزالة: ${dropped.length} · توفير ${(saved / 1024).toFixed(1)} KB (${pct}%)`);
  console.log('الملف للمراجعة: css/styles.purged.css — ثم نفّذ --apply للاستبدال.');
}

if (dropped.length) {
  console.log('القواعد المرشّحة للحذف:');
  dropped.forEach((d) => console.log('  - ' + d));
}

// --check: يمنع تراكم CSS ميت جديد. لا يغيّر شيئًا، يفشل فقط عند تجاوز الحد.
if (CHECK) {
  const LIMIT = 8; // النسبة المئوية المسموحة من CSS الميت قبل الفشل
  if (Number(pct) > LIMIT) {
    console.error(`✗ CSS ميت ${pct}% يتجاوز الحد ${LIMIT}% — نفّذ: node scripts/purge-css.mjs --apply بعد المراجعة`);
    process.exit(1);
  }
  console.log(`✓ CSS الميت ${pct}% داخل الحد (${LIMIT}%)`);
}
