#!/usr/bin/env node
/**
 * ميزانية أداء معلنة: تبدأ بثلاث قراءات متتابعة وتستخدم الوسيط كما قبل.
 * إذا تجاوز الوسيط حدًا، تجمع حتى قراءتين إضافيتين ثم تحسم بوسيط الخمس؛
 * لا تتغير الحدود، ويظل أي مقياس مفقود فشلًا.
 */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  BUDGETS,
  MAX_CONFIRMATION_RUNS,
  evaluateReports,
  formatCheckValue,
  needsConfirmation
} from './perf-budget-core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.BASE || 'https://raawaa-store.pages.dev/';
const INITIAL_RUNS = Number(process.env.PERF_RUNS || 3);
if (!Number.isInteger(INITIAL_RUNS) || INITIAL_RUNS < 1 || INITIAL_RUNS > MAX_CONFIRMATION_RUNS) {
  throw new Error(`PERF_RUNS must be an integer from 1 to ${MAX_CONFIRMATION_RUNS}`);
}

function run(args) {
  return new Promise((resolve, reject) => {
    const cli = path.join(ROOT, 'node_modules/lighthouse/cli/index.js');
    const proc = spawn(process.execPath, [cli, ...args], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    proc.stderr.on('data', data => { err += data; });
    proc.stdout.resume();
    proc.on('error', reject);
    proc.on('close', code => code === 0 ? resolve() : reject(new Error(err.slice(-1000) || `Lighthouse exit ${code}`)));
  });
}

function logReading(report, index) {
  const categories = ['performance', 'accessibility', 'best-practices', 'seo']
    .map(key => `${key}=${Number.isFinite(report.categories?.[key]?.score)
      ? (report.categories[key].score * 100).toFixed(0)
      : 'missing'}`)
    .join(' ');
  const audits = Object.keys(BUDGETS)
    .map(key => `${key}=${Number.isFinite(report.audits?.[key]?.numericValue)
      ? key === 'cumulative-layout-shift'
        ? report.audits[key].numericValue.toFixed(3)
        : `${Math.round(report.audits[key].numericValue)}ms`
      : 'missing'}`)
    .join(' ');
  const bytes = report.audits?.['total-byte-weight']?.numericValue;
  console.log(`  القراءة ${index}: ${categories} · ${audits} · bytes=${Number.isFinite(bytes) ? Math.round(bytes) : 'missing'}`);
}

function writeReport(reportPath, reports, evaluation, errors, confirmed) {
  const result = {
    base: BASE,
    date: new Date().toISOString(),
    initialRuns: INITIAL_RUNS,
    maxRuns: MAX_CONFIRMATION_RUNS,
    actualRuns: reports.length,
    confirmationRunsUsed: Math.max(0, reports.length - INITIAL_RUNS),
    confirmed,
    decision: evaluation?.pass && errors.length === 0 ? 'pass' : 'fail',
    errors,
    failedChecks: evaluation?.failures.map(({ id, label, value, limit, direction, unit, readings }) => ({
      id, label, value, limit, direction, unit, readings
    })) || [],
    checks: evaluation?.checks || [],
    runs: reports.map(report => ({ audits: report.audits, categories: report.categories }))
  };
  const temporaryPath = `${reportPath}.tmp-${process.pid}`;
  writeFileSync(temporaryPath, JSON.stringify(result, null, 1));
  renameSync(temporaryPath, reportPath);
}

const reportPath = path.resolve(ROOT, process.env.PERF_REPORT || 'BENCHMARKS-lighthouse-latest.json');
console.log(`\n═══ ميزانية الأداء · ${BASE} · ${INITIAL_RUNS} قراءة مبدئية (حد أقصى ${MAX_CONFIRMATION_RUNS}) ═══\n`);
const reports = [];
const errors = [];
let index = 0;
let evaluation = null;
let confirmed = false;

async function collectOne() {
  const outPath = `/tmp/rawaa-lh-${process.pid}-${index}.json`;
  index++;
  try {
    await run([BASE, '--output=json', `--output-path=${outPath}`,
      '--chrome-flags=--headless --no-sandbox --disable-dev-shm-usage',
      '--only-categories=performance,accessibility,best-practices,seo', '--quiet']);
    const report = JSON.parse(readFileSync(outPath, 'utf8'));
    if (!report || typeof report !== 'object' || !report.audits || !report.categories) {
      throw new Error('Lighthouse returned a malformed report');
    }
    reports.push(report);
    logReading(report, reports.length);
  } catch (error) {
    errors.push(`reading ${index}: ${error.message}`);
    console.error(`  ✗ تعذّر إكمال القراءة ${index}: ${error.message}`);
  } finally {
    try { unlinkSync(outPath); } catch { /* لم يُكتب التقرير */ }
  }
}

for (let attempt = 0; attempt < INITIAL_RUNS; attempt++) {
  await collectOne();
  if (errors.length) break;
}
evaluation = evaluateReports(reports);

if (errors.length === 0 && needsConfirmation(evaluation, reports.length)) {
  confirmed = true;
  console.log(`\n⚠️ الوسيط المبدئي تجاوز حدًا؛ تُجمع قراءات تأكيد حتى ${MAX_CONFIRMATION_RUNS} دون تغيير الميزانية.\n`);
  while (reports.length < MAX_CONFIRMATION_RUNS) {
    await collectOne();
    if (errors.length) break;
  }
  evaluation = evaluateReports(reports);
}

console.log(`\nالوسيط النهائي (${reports.length} قراءة${confirmed ? '؛ تأكيد' : ''}):`);
for (const check of evaluation.checks) {
  const threshold = check.direction === 'min' ? `≥ ${check.limit}${check.unit}` : `≤ ${check.limit}${check.unit}`;
  console.log(`  ${check.pass ? '✓' : '✗'} ${check.label.padEnd(31)} ${formatCheckValue(check).padEnd(12)} (${threshold})`);
}

writeReport(reportPath, reports, evaluation, errors, confirmed);
console.log(`\nالتقرير: ${reportPath}`);
if (errors.length) {
  console.error(`النتيجة: تعذرت قراءة Lighthouse (${errors.length} خطأ)؛ حُفظ التقرير الجزئي.`);
  process.exit(1);
}
if (!evaluation.pass) {
  console.error(`النتيجة: ${evaluation.failures.length} مقياس تجاوز حده أو غاب بعد التأكيد.`);
  process.exit(1);
}
console.log(`النتيجة: كل المقاييس داخل الميزانية${confirmed ? ` بعد ${reports.length - INITIAL_RUNS} قراءات تأكيد إضافية` : ''} ✓`);
