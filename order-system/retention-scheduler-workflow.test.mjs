import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = await readFile(new URL('../.github/workflows/retention-scheduler.yml', import.meta.url), 'utf8');

test('retention cleanup is scheduled by owner decision but stays fail-closed behind both review variables', () => {
  assert.match(workflow, /workflow_dispatch:/);
  // وافق المالك على التنظيف الدوري، فالجدولة صارت مقصودة لا عرَضًا.
  assert.match(workflow, /^\s+schedule:\s*\n\s+- cron:/m);
  assert.match(workflow, /github\.event_name\s*==\s*'schedule'/);
  assert.match(workflow, /github\.event_name\s*==\s*'workflow_dispatch'/);
  // المفتاحان يحكمان كل مسار، لا المسار اليدوي وحده: إسقاط أي منهما يوقف הכל.
  const gate = /if:\s*\$\{\{([^\n]*)\}\}/.exec(workflow)?.[1] ?? '';
  const enabledAt = gate.indexOf("vars.RAWAA_RETENTION_ENABLED == 'true'");
  const reviewedAt = gate.indexOf("vars.RAWAA_RETENTION_REVIEWED == 'true'");
  const branchAt = gate.indexOf("github.event_name == 'schedule'");
  assert.ok(enabledAt >= 0 && reviewedAt >= 0, 'both kill switches must remain in the job gate');
  assert.ok(branchAt > enabledAt && branchAt > reviewedAt, 'the event branch must sit inside both switches, not bypass them');
  assert.match(gate, /inputs\.confirm_reviewed_run\s*==\s*'run_after_review'/);
});

test('manual retention runs default to disabled and require an explicit confirmation choice', () => {
  assert.match(workflow, /confirm_reviewed_run:[\s\S]*required:\s*true[\s\S]*default:\s*'disabled'[\s\S]*- disabled[\s\S]*- run_after_review/);
});

test('missing scheduler secret is a safe no-op and the workflow never prints it or response bodies', () => {
  assert.match(workflow, /if \[ -z "\$RAWAA_RETENTION_SCHEDULER_SECRET" \]; then[\s\S]*exit 0/);
  assert.match(workflow, /-H "Authorization: Bearer \$RAWAA_RETENTION_SCHEDULER_SECRET"/);
  // المقصود منع طباعة **قيمة** السرّ لا اسمه: ذكر الاسم في إشعار التخطّي آمن ومفيد.
  // الحارس السابق كان يمنع الاسم نفسه، فيعاقب رسالة توضيحية لا تسرّب شيئًا.
  assert.doesNotMatch(workflow, /echo[^\n]*\$\{?RAWAA_RETENTION_SCHEDULER_SECRET/);
  assert.doesNotMatch(workflow, /\|\s*(cat|tee)\b[^\n]*outbox-resp|curl[^\n]*-v\b/);
  assert.doesNotMatch(workflow, /curl[^\n]*-i\b|curl[^\n]*--include/);
});
