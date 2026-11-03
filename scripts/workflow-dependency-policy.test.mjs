import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const workflowsDirectory = fileURLToPath(new URL('../.github/workflows/', import.meta.url));

function workflowJobs(source) {
  const lines = source.split(/\r?\n/);
  const jobsHeader = lines.findIndex((line) => /^jobs:\s*(?:#.*)?$/.test(line));
  if (jobsHeader < 0) return [];

  const jobs = [];
  let current = null;
  for (let index = jobsHeader + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() && !/^\s/.test(line)) break;

    const jobHeader = line.match(/^ {2}([A-Za-z0-9_-]+):\s*(?:#.*)?$/);
    if (jobHeader) {
      if (current) jobs.push(current);
      current = { id: jobHeader[1], lines: [line] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) jobs.push(current);
  return jobs;
}

function dependencyViolation(filename, job) {
  const checkIndex = job.lines.findIndex((line) => /\bnode\s+scripts\/check-site\.mjs\b/.test(line));
  if (checkIndex < 0) return null;

  const installIndex = job.lines.findIndex((line) => /^\s*run:\s*npm\s+ci(?:\s|$)/.test(line));
  if (installIndex < 0) return `${filename} job ${job.id} invokes check-site without npm ci`;
  if (installIndex >= checkIndex) return `${filename} job ${job.id} must run npm ci before check-site`;
  return null;
}

test('fails closed when npm ci is missing, late, or installed in a different job', () => {
  const scenarios = [
    `jobs:\n  check:\n    steps:\n      - run: node scripts/check-site.mjs\n`,
    `jobs:\n  check:\n    steps:\n      - run: node scripts/check-site.mjs\n      - run: npm ci --ignore-scripts\n`,
    `jobs:\n  install:\n    steps:\n      - run: npm ci --ignore-scripts\n  check:\n    steps:\n      - run: node scripts/check-site.mjs\n`
  ];

  for (const source of scenarios) {
    const checkJob = workflowJobs(source).find((job) => job.id === 'check');
    assert.ok(checkJob, 'fixture must contain the check job');
    assert.match(dependencyViolation('fixture.yml', checkJob), /npm ci/);
  }
});

test('every workflow job that runs check-site installs the locked npm dependencies first', () => {
  const files = readdirSync(workflowsDirectory).filter((name) => /\.ya?ml$/i.test(name));
  const callers = [];

  for (const filename of files) {
    const source = readFileSync(path.join(workflowsDirectory, filename), 'utf8');
    for (const job of workflowJobs(source)) {
      if (!job.lines.some((line) => /\bnode\s+scripts\/check-site\.mjs\b/.test(line))) continue;
      callers.push(`${filename}:${job.id}`);
      assert.equal(dependencyViolation(filename, job), null);
    }
  }

  assert.ok(callers.length > 0, 'expected at least one workflow to exercise check-site');
});
