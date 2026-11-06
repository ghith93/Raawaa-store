#!/usr/bin/env node
/**
 * منظّم الوثائق — يمنع عودة تضخّم السجل إلى الحاضر.
 *
 * المشكلة التي يحلّها: كان في المشروع ٥٦ ملف Markdown و١١٨٩٤ سطرًا، وأربعة ملفات
 * «حالة» تتناقض (ثلاثة سلالم أسعار مختلفة في أدلة مختلفة). القارئ — والوكيل التالي —
 * لا يستطيع أن يعرف أي رقم هو الحاضر.
 *
 * القاعدة الآن: وثيقة بتاريخ في اسمها وتجاوزت `MAX_AGE_DAYS` تنتقل تلقائيًا إلى
 * `docs/archive/YYYY-MM/`. لا تُحذف، ولا تُفقد، لكنها تخرج من طريق من يقرأ الحالة.
 *
 * التشغيل:
 *   node scripts/docs-organize.mjs --check   ← يفشل إن كانت هناك وثيقة متأخرة (للبوابات)
 *   node scripts/docs-organize.mjs --apply   ← ينقلها فعلًا
 */
import { readdir, mkdir, rename, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_AGE_DAYS = Number(process.env.DOCS_MAX_AGE_DAYS || 30);
const DATE_IN_NAME = /(20\d{2})-(\d{2})-\d{2}/;

/** ملفات تبقى في الجذر أبدًا مهما كان تاريخها: نقاط دخول أو مراجع حيّة. */
const ALWAYS_KEEP = new Set([
  'AGENTS.md', 'README.md', 'PROJECT-ROADMAP-AR.md', 'DECISIONS.md',
  'IMPROVEMENT_BACKLOG.md', 'BENCHMARKS.md', 'TOOL_CATALOG.md', 'RUNBOOK.md',
  'OPEN-SOURCE-AUDIT.md', 'COPY-PASTE.md'
]);

/** يحوّل YYYY-MM-DD إلى تاريخ UTC؛ يعيد null إن لم يكن تاريخًا صالحًا. */
function parseDate(name) {
  const m = name.match(DATE_IN_NAME);
  if (!m) return null;
  const [, y, mo] = m;
  const d = name.match(DATE_IN_NAME)[0];
  const parsed = new Date(`${d}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function monthFolder(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function collect() {
  const files = [];
  for (const dir of ['.', 'docs']) {
    const entries = await readdir(path.join(ROOT, dir), { withFileTypes: true });
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith('.md')) continue;
      files.push(dir === '.' ? e.name : `docs/${e.name}`);
    }
  }
  return files;
}

/** يعيد الملفات المتأخرة التي يجب أرشفتها. */
export async function staleDocuments({ now = new Date(), maxAgeDays = MAX_AGE_DAYS } = {}) {
  const cutoff = new Date(now.getTime() - maxAgeDays * 86400000);
  const stale = [];
  for (const rel of await collect()) {
    const base = path.basename(rel);
    if (ALWAYS_KEEP.has(base)) continue;
    const date = parseDate(base);
    if (!date || date >= cutoff) continue;
    stale.push({ rel, target: `docs/archive/${monthFolder(date)}/${base}` });
  }
  return stale;
}

/** يعيد كتابة روابط Markdown المؤدية إلى الملفات المنقولة. */
async function rewriteLinks(moves) {
  const byName = new Map(moves.map((m) => [path.basename(m.rel), m.target]));
  const roots = ['.', 'docs', 'docs/archive'];
  let touched = 0;

  async function walk(dir) {
    const abs = path.join(ROOT, dir);
    let entries;
    try { entries = await readdir(abs, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist') continue;
        await walk(path.join(dir, e.name));
        continue;
      }
      if (!e.name.endsWith('.md')) continue;
      const file = path.join(dir, e.name);
      const text = await readFile(path.join(ROOT, file), 'utf8');
      let next = text;
      for (const [name, target] of byName) {
        if (`${dir}/${e.name}` === target) continue;
        const relFromHere = path.relative(dir, target).split(path.sep).join('/');
        for (const form of [name, `./${name}`, `docs/${name}`]) {
          next = next.split(`](${form})`).join(`](${relFromHere})`);
          next = next.split(`href="${form}"`).join(`href="${relFromHere}"`);
        }
      }
      if (next !== text) {
        await writeFile(path.join(ROOT, file), next, 'utf8');
        touched++;
      }
    }
  }
  for (const dir of roots) await walk(dir);
  return touched;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const check = process.argv.includes('--check');
  const stale = await staleDocuments();

  if (!stale.length) {
    console.log(`  الوثائق منظّمة: لا وثيقة مؤرخة أقدم من ${MAX_AGE_DAYS} يومًا في الجذر أو docs/.`);
    return 0;
  }

  if (check) {
    console.error(`✗ ${stale.length} وثيقة مؤرخة تجاوزت ${MAX_AGE_DAYS} يومًا وهي خارج الأرشيف:`);
    for (const s of stale) console.error(`    ${s.rel} → ${s.target}`);
    console.error('  شغّل: node scripts/docs-organize.mjs --apply');
    return 1;
  }

  for (const s of stale) {
    const from = path.join(ROOT, s.rel);
    const to = path.join(ROOT, s.target);
    await mkdir(path.dirname(to), { recursive: true });
    await rename(from, to);
    console.log(`  نُقل: ${s.rel} → ${s.target}`);
  }
  const touched = await rewriteLinks(stale);
  console.log(`  الوثائق: أُرشفت ${stale.length} وثيقة · أُصلحت الروابط في ${touched} ملفًا.`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
    .then((code) => { process.exitCode = code ?? 0; })
    .catch((error) => { console.error(error.message); process.exitCode = 1; });
}
