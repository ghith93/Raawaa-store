import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { submitOrder } from './order-service.mjs';
const sandbox = { window: {} };
vm.runInNewContext(await readFile(new URL('../js/config.js', import.meta.url), 'utf8'), sandbox);
const config = sandbox.window.RAWAA_CONFIG;
const input = { name: 'اختبار', phone: '0991234567', address: 'حماة', items: [{ id: 'serum-50', qty: 1 }], zone: 'hama', method: 'cod', totalCents: 1 };
const idempotencyKey = 'e231547a-1e5e-4c4d-af55-f06686a30341';

test('saves a recalculated order before requesting a notification', async () => {
  const events = [];
  const repository = { async insertPending({ order }) { events.push('saved'); assert.equal(order.totalCents, 2240); return { reference: 'RAWAA-TEST123', result: 'created' }; } };
  const notificationRunner = { async kick(ref) { events.push('notify:' + ref); } };
  assert.deepEqual(await submitOrder({ input, idempotencyKey, config, repository, notificationRunner }), { ok: true, reference: 'RAWAA-TEST123', status: 'pending_review' });
  assert.deepEqual(events, ['saved', 'notify:RAWAA-TEST123']);
});

test('does not report success or notify on invalid input or storage failure', async () => {
  let notified = false;
  const notificationRunner = { async kick() { notified = true; } };
  const repository = { async insertPending() { throw new Error('private database error'); } };
  assert.deepEqual(await submitOrder({ input, idempotencyKey, config, repository, notificationRunner }), { ok: false, code: 'NOT_SAVED' });
  assert.deepEqual(await submitOrder({ input, idempotencyKey: 'bad', config, repository, notificationRunner }), { ok: false, code: 'INVALID_REQUEST' });
  assert.deepEqual(await submitOrder({ input: { ...input, phone: 'bad' }, idempotencyKey, config, repository, notificationRunner }), { ok: false, code: 'INVALID_REQUEST' });
  assert.equal(notified, false);
});

test('notification failure does not undo a saved order; duplicate request does not trigger a second notification', async () => {
  let count = 0;
  const notificationRunner = { async kick() { count++; throw new Error('offline'); } };
  let existing = false;
  const repository = { async insertPending() { const result = existing ? 'existing' : 'created'; existing = true; return { result, reference: 'RAWAA-TEST123' }; } };
  const args = { input, idempotencyKey, config, repository, notificationRunner };
  assert.equal((await submitOrder(args)).ok, true);
  assert.equal((await submitOrder(args)).ok, true);
  assert.equal(count, 1);
});

test('rejects malformed repository results without leaking details', async () => {
  const repository = { async insertPending() { return { reference: 'bad', result: 'created' }; } };
  const result = await submitOrder({ input, idempotencyKey, config, repository, notificationRunner: { async kick() { throw new Error('must not run'); } } });
  assert.deepEqual(result, { ok: false, code: 'NOT_SAVED' });
});
