import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findUnsafeRunnerTarget } from './workflow-runner-policy.mjs';

const bad = (source, reason, line) => assert.deepEqual(findUnsafeRunnerTarget(source), { line, reason });

test('allows only the exact approved GitHub-hosted runner scalar', () => {
  assert.equal(findUnsafeRunnerTarget('jobs:\n  check:\n    runs-on: ubuntu-24.04\n    steps: []\n'), null);
  assert.equal(findUnsafeRunnerTarget('jobs:\n  check:\n    runs-on: "ubuntu-24.04"\n'), null);
  assert.equal(findUnsafeRunnerTarget("jobs:\n  check:\n    runs-on: 'ubuntu-24.04' # pinned image\n"), null);
});

test('rejects other labels, arrays, and dynamic expressions', () => {
  bad('jobs:\n  check:\n    runs-on: ubuntu-latest\n', 'unapproved runner target', 3);
  bad('jobs:\n  check:\n    runs-on: custom-linux-runner\n', 'unapproved runner target', 3);
  bad('jobs:\n  check:\n    runs-on: [ubuntu-24.04]\n', 'runner target is not a fixed scalar', 3);
  bad('jobs:\n  check:\n    runs-on: ${{ inputs.runner }}\n', 'dynamic runner expression', 3);
});

test('rejects self-hosted labels in block, flow, and quoted-key YAML', () => {
  bad('jobs:\n  check:\n    runs-on: [self-hosted, Linux, ARM64]\n', 'self-hosted label', 3);
  bad('jobs:\n  check:\n    runs-on:\n      - self-hosted\n      - Linux\n', 'self-hosted label', 3);
  bad('jobs: { check: { runs-on: [self-hosted, Linux, ARM64], steps: [] } }\n', 'self-hosted label', 1);
  bad('jobs: { check: { "runs-on": self-hosted, steps: [] } }\n', 'self-hosted label', 1);
});

test('rejects runner groups, aliases, and reusable workflows that cannot be audited here', () => {
  bad('jobs:\n  check:\n    runs-on: { group: private-runners, labels: linux }\n', 'runner group', 3);
  bad('jobs:\n  check:\n    runs-on:\n      group: private-runners\n      labels: linux\n', 'runner group', 3);
  bad('runner: &approved ubuntu-24.04\njobs:\n  check:\n    runs-on: *approved\n', 'runner target is not a fixed scalar', 4);
  bad('jobs:\n  call:\n    uses: org/repo/.github/workflows/build.yml@main\n', 'job call delegates to an unaudited reusable workflow', 3);
});

test('ignores comments and shell text that mention runner syntax', () => {
  const workflow = [
    '# runs-on: [self-hosted, Linux]',
    'jobs:',
    '  check:',
    '    runs-on: ubuntu-24.04 # self-hosted is intentionally not used',
    '    steps:',
    "      - run: 'echo \"runs-on: [self-hosted]\"'"
  ].join('\n');
  assert.equal(findUnsafeRunnerTarget(workflow), null);
});

test('fails closed on malformed YAML, absent jobs, and implicit runner targets', () => {
  bad('jobs: [\n', 'invalid YAML', 2);
  bad('name: no jobs\n', 'missing or invalid jobs mapping', 1);
  bad('jobs:\n  check:\n    steps: []\n', 'job check has no explicit runner target', 3);
});

test('rejects a non-string workflow source instead of silently passing', () => {
  assert.throws(() => findUnsafeRunnerTarget(null), { name: 'TypeError' });
});
