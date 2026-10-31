import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = await readFile(new URL('../.github/workflows/retention-scheduler.yml', import.meta.url), 'utf8');

test('retention scheduler is fail-closed behind two explicit review variables', () => {
  assert.match(workflow, /vars\.RAWAA_RETENTION_ENABLED\s*==\s*'true'/);
  assert.match(workflow, /vars\.RAWAA_RETENTION_REVIEWED\s*==\s*'true'/);
  assert.match(workflow, /github\.event_name\s*==\s*'schedule'/);
  assert.match(workflow, /inputs\.confirm_reviewed_run\s*==\s*'run_after_review'/);
});

test('manual retention runs default to disabled and require an explicit confirmation choice', () => {
  assert.match(workflow, /confirm_reviewed_run:[\s\S]*required:\s*true[\s\S]*default:\s*'disabled'[\s\S]*- disabled[\s\S]*- run_after_review/);
});

test('missing scheduler secret is a safe no-op and the workflow never prints it or response bodies', () => {
  assert.match(workflow, /if \[ -z "\$RAWAA_RETENTION_SCHEDULER_SECRET" \]; then[\s\S]*exit 0/);
  assert.match(workflow, /-H "Authorization: Bearer \$RAWAA_RETENTION_SCHEDULER_SECRET"/);
  assert.doesNotMatch(workflow, /echo[^\n]*RAWAA_RETENTION_SCHEDULER_SECRET/);
  assert.doesNotMatch(workflow, /curl[^\n]*-i\b|curl[^\n]*--include/);
});
