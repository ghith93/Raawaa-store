import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { submitOrder } from './order-service.mjs';

const sandbox = { window: {} };
vm.runInNewContext(await readFile(new URL('../js/config.js', import.meta.url), 'utf8'), sandbox);
const config = sandbox.window.RAWAA_CONFIG;
const input = { name: 'اختبار', phone: '0991234567', address: 'حماة', items: [{ id: 'serum-50', qty: 1 }], zone: 'hama', method: 'cod' };
const idempotencyKey = 'e231547a-1e5e-4c4d-af55-f06686a30341';
const notificationRunner = { async kick() {} };

test('records explicit marketing opt-in only for a newly created order', async () => {
  const calls = [];
  const args = {
    input, idempotencyKey, config, notificationRunner, marketingConsent: true,
    repository: { async insertPending() { return { result: 'created', reference: 'RAWAA-TEST123' }; } },
    async recordMarketingOptIn(value) { calls.push(value); return { recorded: true }; }
  };
  assert.deepEqual(await submitOrder(args), {
    ok: true, reference: 'RAWAA-TEST123', status: 'pending_review', marketingOptInStatus: 'recorded'
  });
  assert.deepEqual(calls, [{ phone: '0991234567' }]);
});

test('unchecked consent never calls the preference recorder', async () => {
  let calls = 0;
  const result = await submitOrder({
    input, idempotencyKey, config, notificationRunner,
    repository: { async insertPending() { return { result: 'created', reference: 'RAWAA-TEST123' }; } },
    async recordMarketingOptIn() { calls++; return { recorded: true }; }
  });
  assert.deepEqual(result, { ok: true, reference: 'RAWAA-TEST123', status: 'pending_review' });
  assert.equal(calls, 0);
});

test('failed consent persistence does not undo the order and remains explicitly unrecorded', async () => {
  const result = await submitOrder({
    input, idempotencyKey, config, notificationRunner, marketingConsent: true,
    repository: { async insertPending() { return { result: 'created', reference: 'RAWAA-TEST123' }; } },
    async recordMarketingOptIn() { throw new Error('private failure'); }
  });
  assert.deepEqual(result, {
    ok: true, reference: 'RAWAA-TEST123', status: 'pending_review', marketingOptInStatus: 'not_recorded'
  });
});

test('idempotent retries never append a fresh opt-in or resurrect withdrawn consent', async () => {
  let calls = 0;
  const result = await submitOrder({
    input, idempotencyKey, config, notificationRunner, marketingConsent: true,
    repository: { async insertPending() { return { result: 'existing', reference: 'RAWAA-TEST123' }; } },
    async recordMarketingOptIn() { calls++; return { recorded: true }; }
  });
  assert.deepEqual(result, {
    ok: true, reference: 'RAWAA-TEST123', status: 'pending_review', marketingOptInStatus: 'unknown'
  });
  assert.equal(calls, 0);
});
