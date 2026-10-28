#!/usr/bin/env node
/**
 * RAWAA — بوابة ميزانية الأداء.
 * تشغّل Lighthouse على الموقع الحي وتفشل إن تجاوز أي مقياس حده.
 * كل الحدود معلنة هنا، لا مخفية.
 */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const BASE = process.env.BASE || 'https://raawaa-store.pages.dev/';
const BUDGETS = {
  'first-contentful-paint': 1800,
  'largest-contentful-paint': 2500,
  'total-blocking-time': 200,
  'cumulative-layout-shift': 0.1,
  'speed-index': 3400
};
const MIN_CATEGORY = { performance: 90, accessibility: 95, 'best-practices': 95, seo: 95 };

function run(args) {
  return new Promise((res, rej) => {
    const p = spawn(process.execPath, ['node_modules/lighthouse/cli/index.js', ...args],
      { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', d => out += d);
    p.stderr.on('data', d => err += d);
    p.on('close', c => c === 0 ? res(out) : rej(new Error(err.slice(-500) || `exit ${c}`)));
  });
}

const outPath = '/tmp/lh-report.json';
await run([BASE, '--output=json', `--output-path=${outPath}`,
  '--chrome-flags=--headless --no-sandbox --disable-dev-shm-usage',
  '--only-categories=performance,accessibility,best-practices,seo', '--quiet']);

const r = JSON.parse(readFileSync(outPath, 'utf8'));
let fails = 0;
const line = (ok, label, value, limit) => {
  if (!ok) fails++;
  console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(28)} ${String(value).padEnd(10)} (الحد ${limit})`);
};

console.log(`\n═══ ميزانية الأداء · ${BASE} ═══\n`);
for (const [k, min] of Object.entries(MIN_CATEGORY)) {
  const v = Math.round((r.categories[k]?.score ?? 0) * 100);
  line(v >= min, `درجة ${k}`, v, `≥ ${min}`);
}
console.log('');
for (const [k, max] of Object.entries(BUDGETS)) {
  const a = r.audits[k];
  const v = Math.round(a.numericValue ?? 0);
  line(v <= max, a.title.slice(0, 28), `${v}ms`, `≤ ${max}ms`);
}
const bytes = r.audits['total-byte-weight']?.numericValue ?? 0;
line(bytes <= 900 * 1024, 'إجمالي الحجم', `${(bytes / 1024 / 1024).toFixed(2)}MB`, '≤ 0.88MB');

writeFileSync('/home/user/BENCHMARKS-lighthouse.json',
  JSON.stringify({ base: BASE, date: new Date().toISOString(), report: r.audits, categories: r.categories }, null, 1));

console.log();
if (fails) { console.log(`النتيجة: ${fails} مقياس تجاوز حده`); process.exit(1); }
console.log('النتيجة: كل المقاييس داخل الميزانية ✓');
