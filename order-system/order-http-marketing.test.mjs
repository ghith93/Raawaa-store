import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createOrderHandler } from './order-http.mjs';

const sandbox = { window: {} };
vm.runInNewContext(await readFile(new URL('../js/config.js', import.meta.url), 'utf8'), sandbox);
const config = sandbox.window.RAWAA_CONFIG;
const origin = 'https://store.example';
const key = 'e231547a-1e5e-4c4d-af55-f06686a30341';
const order = { name: 'تجربة', phone: '0991234567', address: 'حماة', items: [{ id: 'serum-30', qty: 1 }], zone: 'hama', method: 'cod' };
const payload = { order, idempotencyKey: key, challengeToken: 'synthetic-token', consent: true };
const request = body => new Request('https://edge.example/orders', {
  method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body)
});
function dependencies(overrides = {}) {
  return {
    origin, config,
    repository: { async insertPending() { return { result: 'created', reference: 'RAWAA-TEST123' }; } },
    notificationRunner: { async kick() {} },
    verifyChallenge: async () => true,
    rateLimit: async () => true,
    ...overrides
  };
}

test('valid explicit marketing choice is passed to order service with a tri-state result', async () => {
  const calls = [];
  const handler = createOrderHandler(dependencies({
    async recordMarketingOptIn(input) { calls.push(input); return { recorded: true }; }
  }));
  const response = await handler(request({ ...payload, marketingConsent: true }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    reference: 'RAWAA-TEST123', status: 'pending_review', marketingOptInStatus: 'recorded'
  });
  assert.deepEqual(calls, [{ phone: '0991234567' }]);
});

test('malformed marketing choice is rejected before challenge or persistence', async () => {
  let checks = 0;
  const handler = createOrderHandler(dependencies({
    verifyChallenge: async () => { checks++; return true; }
  }));
  const response = await handler(request({ ...payload, marketingConsent: 'yes' }));
  assert.equal(response.status, 400);
  assert.equal(checks, 0);
});

test('unavailable opt-in persistence does not block order processing but reports no subscription', async () => {
  const handler = createOrderHandler(dependencies());
  const response = await handler(request({ ...payload, marketingConsent: true }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    reference: 'RAWAA-TEST123', status: 'pending_review', marketingOptInStatus: 'not_recorded'
  });
});
