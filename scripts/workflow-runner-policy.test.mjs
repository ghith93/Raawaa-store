import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findUnsafeRunnerTarget } from './workflow-runner-policy.mjs';

test('allows the repository-approved GitHub-hosted runner label', () => {
  assert.equal(findUnsafeRunnerTarget('jobs:\n  check:\n    runs-on: ubuntu-24.04\n    steps: []\n'), null);
  assert.equal(findUnsafeRunnerTarget('jobs:\n  check:\n    runs-on: "ubuntu-24.04"\n'), null);
});

test('rejects every runner target outside the exact hosted-runner allowlist', () => {
  assert.deepEqual(findUnsafeRunnerTarget('jobs:\n  check:\n    runs-on: ubuntu-latest\n'), {
    line: 3,
    reason: 'unapproved runner target'
  });
  assert.deepEqual(findUnsafeRunnerTarget('jobs:\n  check:\n    runs-on: custom-linux-runner\n'), {
    line: 3,
    reason: 'unapproved runner target'
  });
  assert.deepEqual(findUnsafeRunnerTarget('jobs:\n  check:\n    runs-on: [ubuntu-24.04]\n'), {
    line: 3,
    reason: 'unapproved runner target'
  });
});

test('rejects inline and block-list self-hosted labels', () => {
  assert.deepEqual(findUnsafeRunnerTarget('jobs:\n  check:\n    runs-on: [self-hosted, Linux, ARM64]\n'), {
    line: 3,
    reason: 'self-hosted label'
  });
  assert.deepEqual(findUnsafeRunnerTarget('jobs:\n  check:\n    runs-on:\n      - self-hosted\n      - Linux\n'), {
    line: 3,
    reason: 'self-hosted label'
  });
});

test('rejects runner groups and dynamic runner expressions', () => {
  assert.deepEqual(findUnsafeRunnerTarget('jobs:\n  check:\n    runs-on: { group: private-runners, labels: linux }\n'), {
    line: 3,
    reason: 'runner group'
  });
  assert.deepEqual(findUnsafeRunnerTarget('jobs:\n  check:\n    runs-on:\n      group: private-runners\n      labels: linux\n'), {
    line: 3,
    reason: 'runner group'
  });
  assert.deepEqual(findUnsafeRunnerTarget('jobs:\n  check:\n    runs-on: ${{ inputs.runner }}\n'), {
    line: 3,
    reason: 'dynamic runner expression'
  });
});

test('ignores self-hosted mentions in comments and unrelated workflow fields', () => {
  const workflow = [
    '# runs-on: [self-hosted, Linux]',
    'jobs:',
    '  check:',
    '    runs-on: ubuntu-24.04 # self-hosted is intentionally not used',
    '    env:',
    '      NOTE: self-hosted appears only in this value'
  ].join('\n');
  assert.equal(findUnsafeRunnerTarget(workflow), null);
});

test('rejects a non-string workflow source instead of silently passing', () => {
  assert.throws(() => findUnsafeRunnerTarget(null), { name: 'TypeError' });
});
