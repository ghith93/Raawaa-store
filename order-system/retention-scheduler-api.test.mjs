import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRetentionSchedulerHandler } from './retention-scheduler-api.mjs';

const secret = 'A'.repeat(43);
const request = ({ method = 'POST', authorization = `Bearer ${secret}`, url = 'https://edge.example/retention', body } = {}) =>
  new Request(url, { method, headers: authorization ? { authorization } : {}, ...(body === undefined ? {} : { body }) });

test('runs the bounded cleanup only after authenticating a bodyless POST', async () => {
  let calls = 0;
  const handle = createRetentionSchedulerHandler({ secret, runCleanup: async () => { calls++; } });
  const response = await handle(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.equal(calls, 1);
});

test('rejects unauthorized, non-POST, query-string, and caller-controlled requests without cleanup', async () => {
  let calls = 0;
  const handle = createRetentionSchedulerHandler({ secret, runCleanup: async () => { calls++; } });
  assert.equal((await handle(request({ authorization: 'Bearer wrong' }))).status, 401);
  assert.equal((await handle(request({ authorization: '' }))).status, 401);
  assert.equal((await handle(request({ method: 'GET' }))).status, 405);
  assert.equal((await handle(request({ url: 'https://edge.example/retention?limit=1' }))).status, 400);
  assert.equal((await handle(request({ body: 'customer-data' }))).status, 400);
  assert.equal(calls, 0);
});

test('fails closed when unconfigured or when database cleanup fails', async () => {
  const unavailable = createRetentionSchedulerHandler({ secret: '', runCleanup: async () => {} });
  assert.equal((await unavailable(request())).status, 503);
  const failing = createRetentionSchedulerHandler({ secret, runCleanup: async () => { throw new Error('private db error'); } });
  const response = await failing(request());
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'unavailable' });
});
