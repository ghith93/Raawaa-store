import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUDGETS,
  MAX_CONFIRMATION_RUNS,
  MIN_CATEGORY,
  evaluateReports,
  median,
  needsConfirmation
} from './perf-budget-core.mjs';

function makeReport(overrides = {}) {
  const audits = Object.fromEntries(Object.entries(BUDGETS).map(([id, numericValue]) => [id, { title: id, numericValue }]));
  audits['total-byte-weight'] = { numericValue: 900 * 1024 };
  const categories = Object.fromEntries(Object.entries(MIN_CATEGORY).map(([id, min]) => [id, { score: min / 100 }]));
  return {
    audits: { ...audits, ...overrides.audits },
    categories: { ...categories, ...overrides.categories }
  };
}

test('median handles odd/even samples without mutating input and rejects empty/non-finite data', () => {
  const values = [5, 1, 3];
  assert.equal(median(values), 3);
  assert.deepEqual(values, [5, 1, 3]);
  assert.equal(median([1, 4]), 2.5);
  assert.equal(median([]), null);
  assert.equal(median([1, Number.NaN]), null);
});

test('budget limits and equality boundaries remain unchanged', () => {
  const evaluation = evaluateReports([makeReport(), makeReport(), makeReport()]);
  assert.equal(evaluation.pass, true);
  assert.equal(evaluation.failures.length, 0);
  assert.equal(MAX_CONFIRMATION_RUNS, 5);
});

test('a failing three-run median requests two confirmation readings but never changes limits', () => {
  const bad = makeReport({ audits: { 'first-contentful-paint': { title: 'FCP', numericValue: 1900 } } });
  const evaluation = evaluateReports([bad, bad, makeReport()]);
  assert.equal(evaluation.pass, false);
  assert.deepEqual(evaluation.failures.map(check => check.id), ['audit:first-contentful-paint']);
  assert.equal(evaluation.failures[0].limit, 1800);
  assert.equal(needsConfirmation(evaluation, 3), true);
  assert.equal(needsConfirmation(evaluation, 5), false);
  assert.equal(needsConfirmation(evaluateReports([makeReport()]), 1), false);
});

test('two isolated slow readings are cleared by a passing five-run median; three sustained readings still fail', () => {
  const bad = makeReport({ audits: { 'largest-contentful-paint': { title: 'LCP', numericValue: 2600 } } });
  const good = makeReport();
  const transient = evaluateReports([bad, bad, good, good, good]);
  const sustained = evaluateReports([bad, bad, bad, good, good]);
  assert.equal(transient.pass, true);
  assert.equal(transient.checks.find(check => check.id === 'audit:largest-contentful-paint').value, 2500);
  assert.equal(sustained.pass, false);
  assert.equal(sustained.failures[0].id, 'audit:largest-contentful-paint');
});

test('missing or non-finite metrics and category scores fail closed', () => {
  const incomplete = makeReport({
    audits: { 'speed-index': { title: 'Speed Index', numericValue: Number.NaN } },
    categories: { seo: { score: null } }
  });
  const evaluation = evaluateReports([makeReport(), incomplete, makeReport()]);
  assert.equal(evaluation.pass, false);
  assert.deepEqual(new Set(evaluation.failures.map(check => check.id)), new Set(['category:seo', 'audit:speed-index']));
  assert.equal(evaluation.failures.every(check => check.value === null), true);
  const missingReading = evaluation.failures.find(check => check.id === 'audit:speed-index');
  assert.deepEqual(missingReading.readings, [3400, null, 3400]);
});
