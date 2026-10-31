import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCheckoutFlow } from './customer-checkout-flow.mjs';

test('forwards optional marketing consent separately from required processing consent', async () => {
  const submitted = [];
  const flow = createCheckoutFlow({
    client: {
      begin() {},
      async submit(value) { submitted.push(value); return { status: 'saved', reference: 'RAWAA-TEST123' }; },
      reset() {}, state() { return 'ready'; }
    },
    challenge: { take: () => 'synthetic-token', reset() {} }
  });
  flow.begin({ name: 'synthetic' });
  assert.deepEqual(await flow.submit(true, true), { status: 'saved', reference: 'RAWAA-TEST123' });
  assert.deepEqual(submitted, [{ challengeToken: 'synthetic-token', consent: true, marketingConsent: true }]);
});

test('invalid marketing preference does not consume a challenge or submit an order', async () => {
  let takes = 0, submits = 0;
  const flow = createCheckoutFlow({
    client: { begin() {}, async submit() { submits++; }, reset() {}, state() { return 'ready'; } },
    challenge: { take() { takes++; return 'synthetic-token'; }, reset() {} }
  });
  flow.begin({ name: 'synthetic' });
  assert.deepEqual(await flow.submit(true, 'yes'), { status: 'invalid_marketing_consent' });
  assert.equal(takes, 0);
  assert.equal(submits, 0);
});
