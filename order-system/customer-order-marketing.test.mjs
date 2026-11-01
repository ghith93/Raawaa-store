import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCustomerOrderClient } from './customer-order-client.mjs';

const storage = () => { let value = null; return { getItem: () => value, setItem: (_key, next) => { value = next; }, removeItem: () => { value = null; } }; };
const base = {
  endpoint: 'https://store.example/api/orders',
  allowedOrigin: 'https://store.example',
  storage: storage(),
  makeId: () => '11111111-1111-4111-8111-111111111111'
};

test('optional marketing choice is explicitly sent and never inferred from required processing consent', async () => {
  let sent;
  const client = createCustomerOrderClient({
    ...base,
    storage: storage(),
    fetchImpl: async (_url, init) => {
      sent = JSON.parse(init.body);
      return { status: 200, json: async () => ({ reference: 'RAWAA-TEST123', status: 'pending_review', marketingOptInStatus: 'recorded' }) };
    }
  });
  client.begin({ name: 'synthetic' });
  const result = await client.submit({ challengeToken: 'synthetic-challenge', consent: true, marketingConsent: true });
  assert.equal(sent.consent, true);
  assert.equal(sent.marketingConsent, true);
  assert.deepEqual(result, { status: 'saved', reference: 'RAWAA-TEST123', marketingOptInStatus: 'recorded' });
});

test('unchecked opt-in is sent as false and malformed choices fail before network access', async () => {
  let calls = 0;
  const client = createCustomerOrderClient({ ...base, storage: storage(), fetchImpl: async (_url, init) => {
    calls++;
    assert.equal(JSON.parse(init.body).marketingConsent, false);
    return { status: 400, json: async () => ({}) };
  } });
  client.begin({ name: 'synthetic' });
  await assert.rejects(client.submit({ challengeToken: 'first', consent: true, marketingConsent: 'yes' }), /INVALID_MARKETING_CONSENT/);
  assert.equal(calls, 0);
  assert.deepEqual(await client.submit({ challengeToken: 'second', consent: true }), { status: 'rejected', reason: 'check_details' });
  assert.equal(calls, 1);
});
