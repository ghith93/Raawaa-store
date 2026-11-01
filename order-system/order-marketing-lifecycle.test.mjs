import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { submitOrder } from './order-service.mjs';
import { createMarketingPreferenceService, MARKETING_CONSENT_VERSION } from './marketing-preferences.mjs';

const sandbox = { window: {} };
vm.runInNewContext(await readFile(new URL('../js/config.js', import.meta.url), 'utf8'), sandbox);
const config = sandbox.window.RAWAA_CONFIG;
const phone = '0991234567';
const input = { name: 'Synthetic', phone, address: 'Test', items: [{ id: 'serum-30', qty: 1 }], zone: 'hama', method: 'cod' };
const idempotencyKey = 'e231547a-1e5e-4c4d-af55-f06686a30341';

test('synthetic lifecycle: explicit opt-in, owner withdrawal, and idempotent retry never restores consent', async () => {
  const events = [];
  const repository = {
    async appendEvent(event) { events.push(event); },
    async latestEvent(phoneKey) { return [...events].reverse().find(event => event.phoneKey === phoneKey) || null; }
  };
  const preferences = createMarketingPreferenceService({
    repository,
    hmacSecret: 'synthetic-lifecycle-test-key-not-a-secret-please-rotate',
    cryptoImpl: webcrypto,
    now: () => Date.parse('2026-10-31T12:00:00.000Z')
  });
  const orderResults = ['created', 'existing'];
  let saveCalls = 0, preferenceCalls = 0, mockNotifications = 0;
  const args = {
    input, idempotencyKey, config, marketingConsent: true,
    repository: { async insertPending() {
      return { result: orderResults[saveCalls++], reference: 'RAWAA-TEST123' };
    } },
    notificationRunner: { async kick() { mockNotifications++; } },
    async recordMarketingOptIn({ phone: value }) {
      preferenceCalls++;
      return preferences.recordOptIn({ phone: value, explicitConsent: true, consentVersion: MARKETING_CONSENT_VERSION });
    }
  };

  const created = await submitOrder(args);
  assert.equal(created.marketingOptInStatus, 'recorded');
  assert.equal(await preferences.canReceiveManualMarketing(phone), true);

  assert.equal((await preferences.recordWithdrawal({ phone, ownerAuthorized: true })).recorded, true);
  assert.equal(await preferences.canReceiveManualMarketing(phone), false);

  const retry = await submitOrder(args);
  assert.equal(retry.marketingOptInStatus, 'unknown');
  assert.equal(preferenceCalls, 1);
  assert.equal(events.length, 2);
  assert.equal(events[0].event, 'opt_in');
  assert.equal(events[1].event, 'withdrawal');
  assert.equal(await preferences.canReceiveManualMarketing(phone), false);
  assert.equal(mockNotifications, 1, 'retry must not send a duplicate notification');
  assert.doesNotMatch(JSON.stringify(events), /0991234567|963991234567/);
});
