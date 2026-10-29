#!/usr/bin/env node
/**
 * ميزانية أداء معلنة. ثلاث قراءات متتالية والقرار على الوسيط لتقليل الضجيج؛
 * لا يتغيّر أي حد. كل قراءة معروضة، وغياب أي مقياس يُعد فشلًا.
 */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.BASE || 'https://raawaa-store.pages.dev/';
const RUNS = Number(process.env.PERF_RUNS || 3);
if (!Number.isInteger(RUNS) || RUNS < 1 || RUNS > 5) throw new Error('PERF_RUNS must be an integer from 1 to 5');
const BUDGETS = {
  'first-contentful-paint': 1800,
  'largest-contentful-paint': 2500,
  'total-blocking-time': 200,
  'cumulative-layout-shift': 0.1,
  'speed-index': 3400
};
const MIN_CATEGORY = { performance: 90, accessibility: 95, 'best-practices': 95, seo: 95 };
const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

function run(args) {
  return new Promise((resolve, reject) => {
    const cli = path.join(ROOT, 'node_modules/lighthouse/cli/index.js');
    const proc = spawn(process.execPath, [cli, ...args], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    proc.stderr.on('data', d => { err += d; });
    proc.stdout.resume();
    proc.on('error', reject);
    proc.on('close', c => c === 0 ? resolve() : reject(new Error(err.slice(-1000) || `Lighthouse exit ${c}`)));
  });
}

console.log(`\n═══ ميزانية الأداء · ${BASE} · ${RUNS} قراءة متتالية ═══\n`);
const reports = [];
for (let i = 0; i < RUNS; i++) {
  const outPath = `/tmp/rawaa-lh-${process.pid}-${i}.json`;
  try {
    await run([BASE, '--output=json', `--output-path=${outPath}`,
      '--chrome-flags=--headless --no-sandbox --disable-dev-shm-usage',
      '--only-categories=performance,accessibility,best-practices,seo', '--quiet']);
    const report = JSON.parse(readFileSync(outPath, 'utf8'));
    reports.push(report);
    const lcp = report.audits['largest-contentful-paint']?.numericValue;
    const score = report.categories.performance?.score;
    console.log(`  القراءة ${i + 1}: الأداء ${Number.isFinite(score) ? Math.round(score * 100) : 'مفقود'} · LCP ${Number.isFinite(lcp) ? Math.round(lcp) + 'ms' : 'مفقود'}`);
  } finally { try { unlinkSync(outPath); } catch { /* لم يُكتب التقرير */ } }
}
let fails = 0;
const line = (good, label, value, limit) => {
  if (!good) fails++;
  console.log(`  ${good ? '✓' : '✗'} ${label.padEnd(29)} ${String(value).padEnd(11)} (الحد ${limit})`);
};
const allFinite = values => values.every(v => typeof v === 'number' && Number.isFinite(v));
console.log('\nالوسيط:');
for (const [key, min] of Object.entries(MIN_CATEGORY)) {
  const values = reports.map(r => r.categories[key]?.score);
  const v = allFinite(values) ? median(values) * 100 : NaN;
  line(Number.isFinite(v) && v >= min, `درجة ${key}`, Number.isFinite(v) ? v.toFixed(1) : 'مفقود', `≥ ${min}`);
}
for (const [key, max] of Object.entries(BUDGETS)) {
  const values = reports.map(r => r.audits[key]?.numericValue);
  const v = allFinite(values) ? median(values) : NaN;
  const isCls = key === 'cumulative-layout-shift';
  const format = Number.isFinite(v) ? (isCls ? v.toFixed(3) : Math.round(v) + 'ms') : 'مفقود';
  const limit = isCls ? `≤ ${max}` : `≤ ${max}ms`;
  line(Number.isFinite(v) && v <= max, reports[0].audits[key]?.title || key, format, limit);
}
const sizes = reports.map(r => r.audits['total-byte-weight']?.numericValue);
const bytes = allFinite(sizes) ? median(sizes) : NaN;
line(Number.isFinite(bytes) && bytes <= 900 * 1024, 'إجمالي الحجم', Number.isFinite(bytes) ? (bytes / 1048576).toFixed(2) + 'MB' : 'مفقود', '≤ 0.88MB');

// المسار نسبي إلى المشروع وليس /home/user الذي لا يوجد في GitHub Actions.
const reportPath = path.resolve(ROOT, process.env.PERF_REPORT || 'BENCHMARKS-lighthouse-latest.json');
writeFileSync(reportPath, JSON.stringify({ base: BASE, date: new Date().toISOString(), runs: reports.map(r => ({ audits: r.audits, categories: r.categories })) }, null, 1));
console.log(`\nالتقرير: ${reportPath}`);
if (fails) { console.log(`النتيجة: ${fails} مقياس تجاوز حده أو غاب`); process.exit(1); }
console.log('النتيجة: كل المقاييس داخل الميزانية ✓');
