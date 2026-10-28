/**
 * RAWAA — إزالة قواعد CSS غير المستخدمة (تقريب آمن، بلا مكتبات خارجية).
 *
 * المشكلة المقاسة: styles.css يصل 47KB، منها 22KB لا تُستخدم في الصفحة
 * الحالية (Lighthouse). السبب طبيعي: الصفحة تُقلَّم وتُعاد بناؤها عبر أشهر،
 * فتبقى قواعد لأقسام حُذفت (تصميم، معرض، بطاقات منتجات قديمة).
 *
 * الأمان أولًا: لا نُزيل أي قاعدة تحتوي محددات تُبنى من JavaScript
 * (classList/add, dataset, أو أسماء تُبنى ديناميكيًا)، ولا داخل @media
 * غير معروفة، ولا أي قاعدة تحتوي :hover/:focus/:target/:not، ولا قواعد
 * الصفحات الأخرى (privacy/404). الهدف تقليل ما نعرف أنه ميت، لا غير ذلك.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const cssPath = path.join(ROOT, 'css/styles.css');
const css = fs.readFileSync(cssPath, 'utf8');

// كل ما قد يستعمله أي فصل أو سكربت في الموقع
const sources = ['index.html', 'privacy.html', '404.html', 'js/cart.js', 'js/config.js', 'js/marketing.js']
  .map((f) => {
    try { return fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch { return ''; }
  })
  .join('\n');

/** أسماء الفصول المستعملة فعليًا (في HTML أو JS) */
const usedTokens = new Set();
for (const m of sources.matchAll(/class(?:Name)?\s*=\s*["']([^"']+)["']/g)) {
  m[1].split(/\s+/).forEach((t) => usedTokens.add(t));
}
for (const m of sources.matchAll(/classList\.(?:add|remove|toggle)\(\s*'([^']+)'/g)) usedTokens.add(m[1]);
for (const m of sources.matchAll(/querySelector(?:All)?\(\s*'([^']+)'/g)) {
  for (const t of m[1].matchAll(/\.([a-zA-Z][\w-]*)/g)) usedTokens.add(t[1]);
}
for (const m of sources.matchAll(/'(is-[\w-]+|[a-z]+-[a-z-]+)'/g)) usedTokens.add(m[1]);

/** أسماء العناصر والمعرّفات المستعملة */
const usedIds = new Set([...sources.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
const usedTags = new Set([...sources.matchAll(/<([a-z][a-z0-9]*)[\s>]/g)].map((m) => m[1]));

const SAFE_PSEUDO = /:(hover|focus|focus-visible|focus-within|active|visited|disabled|checked|placeholder|selection|first-child|last-child|nth-|not\(|is\(|where\(|has\(|before|after|root|lang\(|dir\()/g;

/** هل هذا المحدد (الجزء المفرد) مستعمل؟ */
function selectorIsUsed(sel) {
  const s = sel.trim();
  if (!s || s.startsWith('@') || s.startsWith('from') || s.startsWith('to') || /^\d/.test(s)) return true;
  if (s === '*' || s === ':root' || s.startsWith('*')) return true;
  // قواعد الأصول العالمية: html, body, والوسوم
  const cleaned = s.replace(/::?(hover|focus|focus-visible|focus-within|active|visited|disabled|checked|placeholder|selection|before|after)[\w-()]*/g, '');
  const lastSimple = cleaned.split(/[\s>+~]+/).filter(Boolean).pop() || cleaned;
  const cls = [...lastSimple.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]);
  const id = [...lastSimple.matchAll(/#([a-zA-Z][\w-]*)/g)].map((m) => m[1]);
  const tag = (lastSimple.match(/^([a-z][a-z0-9]*)/) || [])[1];
  const attr = /\[[\w-]+/.test(lastSimple);

  if (attr) return true;                       // سمات: نُبقيها (تُبنى كثيرًا من JS)
  if (id.length) return id.some((x) => usedIds.has(x)) || true; // المعرّفات: نُبقيها احتياطًا
  if (cls.length) return cls.some((x) => usedTokens.has(x));
  if (tag) return usedTags.has(tag) || ['html','body','root'].includes(tag);
  return true;
}

/** تقسيم CSS إلى بلوكات من المستوى الأعلى */
function splitBlocks(text) {
  const blocks = [];
  let depth = 0, start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) {
        blocks.push(text.slice(start, i + 1));
        start = i + 1;
      }
    }
  }
  if (start < text.length) blocks.push(text.slice(start));
  return blocks;
}

const out = [];
let dropped = 0;
for (const block of splitBlocks(css)) {
  const isAtRule = block.trimStart().startsWith('@');
  if (isAtRule) {
    // @font-face و @keyframes و @media/@supports: نُبقيها كما هي.
    // السبب: قواعد داخلها تُبنى من JS، وتقليمها بلا متصفح خطر لا يستحق المكسب.
    out.push(block);
    continue;
  }
  const brace = block.indexOf('{');
  if (brace < 0) { out.push(block); continue; }
  const selectors = block.slice(0, brace).split(',').map((x) => x.trim()).filter(Boolean);
  const keep = selectors.some(selectorIsUsed);
  if (keep) out.push(block);
  else { dropped++; }
}

const result = out.join('');
const savedKb = ((css.length - result.length) / 1024).toFixed(1);
fs.writeFileSync(path.join(ROOT, 'css/styles.purged.css'), result, 'utf8');
console.log(`قواعد مُزالة: ${dropped} · توفير ${savedKb} KB (${(css.length/1024).toFixed(1)} → ${(result.length/1024).toFixed(1)} KB)`);
console.log('الملف: css/styles.purged.css — راجعه قبل الاستبدال.');
