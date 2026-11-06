import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm, chmod } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';

// البند 67: كانت الدفعة تُبلغ HTTP 200 حتى لو فشل كل تسليم، والمُشغّل يقرأ رمز
// HTTP فقط، فيبقى الفشل صامتًا. هذا الاختبار يشغّل كتلة run الحقيقية من YAML
// (بما فيها heredoc وإزاحته) مقابل استجابات مُلفّقة، بلا شبكة ولا سرّ حقيقي.
const workflow = parse(await readFile(new URL('../.github/workflows/outbox-scheduler.yml', import.meta.url), 'utf8'));
const step = workflow.jobs['run-batch'].steps.find(s => typeof s.run === 'string' && s.run.includes('outbox-resp'));
assert.ok(step, 'scheduler step must exist');

const cases = [
  { name: 'كل التسليم ناجح', body: { ok: true, sent: 3, failed: 0, unknown: 0, recovered: 0 }, code: 200, exit: 0 },
  { name: 'كل التسليم فاشل يُفشل التشغيل', body: { ok: true, sent: 0, failed: 3, unknown: 0, recovered: 0 }, code: 200, exit: 1 },
  { name: 'تسليم غير مؤكد يُفشل التشغيل', body: { ok: true, sent: 0, failed: 0, unknown: 3, recovered: 0 }, code: 200, exit: 1 },
  // الدالة المنشورة حاليًا تسبق العدّادات: تحذير لا فشل، حتى لا ينكسر staging قبل إعادة النشر.
  { name: 'دالة قديمة بلا عدّادات تحذّر فقط', body: { ok: true }, code: 200, exit: 0 },
  { name: 'خطأ HTTP يُفشل التشغيل', body: { error: 'unavailable' }, code: 503, exit: 1 },
  { name: 'عدّادات hostile تُعامل صفرًا', body: { ok: true, sent: -1, failed: 'x', unknown: true, recovered: 1.5 }, code: 200, exit: 0 },
];

test('scheduler workflow surfaces delivery failure instead of trusting HTTP 200 alone', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rawaa-sched-'));
  try {
    const bin = join(dir, 'bin');
    await execFileSync('mkdir', ['-p', bin]);
    await writeFile(join(dir, 'step.sh'), step.run);
    // بديل curl يكتب الاستجابة الملفّقة ويطبع رمز HTTP؛ لا شبكة إطلاقًا.
    await writeFile(join(bin, 'curl'), `#!/bin/bash
out=""
for ((i=1;i<=$#;i++)); do
  if [ "\${!i}" = "-o" ]; then j=$((i+1)); out="\${!j}"; fi
done
cp "${join(dir, 'body.json')}" "$out"
printf '%s' "$(cat "${join(dir, 'code.txt')}")"
`);
    await chmod(join(bin, 'curl'), 0o755);

    for (const c of cases) {
      await writeFile(join(dir, 'body.json'), JSON.stringify(c.body));
      await writeFile(join(dir, 'code.txt'), String(c.code));
      let exit = 0, output = '';
      try {
        output = execFileSync('bash', [join(dir, 'step.sh')], {
          // المسار المؤقت أولًا ليُستخدم بديل curl بدل الحقيقي.
          env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, RAWAA_OUTBOX_SCHEDULER_SECRET: 'dummy-not-a-real-secret' },
          encoding: 'utf8', stdio: 'pipe',
        });
      } catch (error) {
        exit = error.status ?? 1;
        output = `${error.stdout || ''}${error.stderr || ''}`;
      }
      assert.equal(exit, c.exit, `${c.name}: expected exit ${c.exit}, got ${exit}\n${output}`);
      if (c.exit === 1 && c.code === 200) assert.match(output, /::error::/, `${c.name}: must annotate an error`);
      // لا سرّ ولا معرّف شات في السجل مهما كانت الاستجابة.
      assert.ok(!output.includes('dummy-not-a-real-secret'), 'scheduler must never print the secret');
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('missing scheduler secret still skips quietly without calling the function', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rawaa-sched-skip-'));
  try {
    await writeFile(join(dir, 'step.sh'), step.run);
    const output = execFileSync('bash', [join(dir, 'step.sh')], {
      env: { ...process.env, RAWAA_OUTBOX_SCHEDULER_SECRET: '' }, encoding: 'utf8', stdio: 'pipe',
    });
    assert.match(output, /تخطٍّ/);
    assert.ok(!output.includes('HTTP'), 'must not call the function without a secret');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
