import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// سياسة تثبيت الإجراءات: كل uses خارجي يجب أن يكون مثبّتًا على SHA كامل (40 خانة)
// مع تعليق يحمل الإصدار المقروء. الوسم المتحرك مثل @v5 يمكن أن يتغيّر تحته الكود.
const workflowsDirectory = fileURLToPath(new URL('../.github/workflows/', import.meta.url));
const files = readdirSync(workflowsDirectory).filter(name => /\.ya?ml$/i.test(name));

function usesLines(source) {
  return source.split(/\r?\n/)
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => /^\s*-?\s*uses:\s*\S+/.test(line));
}

test('every external action is pinned to a full commit SHA with a readable version comment', () => {
  const violations = [];
  let checked = 0;

  for (const filename of files) {
    const source = readFileSync(path.join(workflowsDirectory, filename), 'utf8');
    for (const { line, number } of usesLines(source)) {
      const reference = /uses:\s*([^\s#]+)/.exec(line)?.[1];
      if (!reference || reference.startsWith('./') || reference.startsWith('docker://')) continue;
      checked += 1;
      if (!/^[^@]+@[0-9a-f]{40}$/.test(reference)) {
        violations.push(`${filename}:${number} ${reference} is not SHA-pinned`);
      } else if (!/@[0-9a-f]{40}\s+#\s*\S+/.test(line)) {
        violations.push(`${filename}:${number} ${reference} lacks a version comment`);
      }
    }
  }

  assert.ok(checked > 0, 'expected external actions to exist');
  assert.deepEqual(violations, []);
});

test('the browser test runner is version-pinned wherever CI installs it', () => {
  const violations = [];
  for (const filename of files) {
    const source = readFileSync(path.join(workflowsDirectory, filename), 'utf8');
    for (const line of source.split(/\r?\n/)) {
      if (!/pip install/.test(line)) continue;
      if (/\bplaywright\b/.test(line) && !/playwright==\d+\.\d+\.\d+/.test(line)) {
        violations.push(`${filename}: ${line.trim()}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});
