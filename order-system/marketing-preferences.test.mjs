import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createMarketingPreferenceService,
  MARKETING_CONSENT_VERSION,
  normalizeMarketingPhone
} from './marketing-preferences.mjs';

function mockCrypto() {
  const imported = [];
  const signed = [];
  return {
    imported,
    signed,
    subtle: {
      async importKey(format, secret, algorithm, extractable, usages) {
        imported.push({ format, secret: new TextDecoder().decode(secret), algorithm, extractable, usages });
        return { testKey: true };
      },
      async sign(algorithm, _key, data) {
        const text = new TextDecoder().decode(data);
        signed.push(text);
        let hash = 2166136261;
        for (const char of text) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
        return Uint8Array.from({ length: 32 }, (_, index) => (hash >>> ((index % 4) * 8)) & 0xff).buffer;
      }
    }
  };
}

function fixture(overrides = {}) {
  const cryptoImpl = mockCrypto();
  const events = [];
  let latest = null;
  const repository = {
    async appendEvent(event) { events.push(event); latest = event; },
    async latestEvent(phoneKey) { return latest?.phoneKey === phoneKey ? latest : null; }
  };
  const service = createMarketingPreferenceService({
    repository,
    hmacSecret: 'synthetic-test-key-which-is-not-a-real-secret-32bytes',
    cryptoImpl,
    now: () => Date.parse('2026-10-31T12:30:00.000Z'),
    ...overrides
  });
  return { service, repository, events, cryptoImpl, setLatest: value => { latest = value; } };
}

test('normalizes Syrian and international phone formats without guessing unknown country codes', () => {
  assert.equal(normalizeMarketingPhone('099 731 0856'), '+963997310856');
  assert.equal(normalizeMarketingPhone('٠٩٩٧٣١٠٨٥٦'), '+963997310856');
  assert.equal(normalizeMarketingPhone('+1 (202) 555-0123'), '+12025550123');
  assert.equal(normalizeMarketingPhone('00963997310856'), '+963997310856');
  assert.equal(normalizeMarketingPhone('12345678'), null);
  assert.equal(normalizeMarketingPhone('call 0997310856'), null);
  assert.equal(normalizeMarketingPhone('+00012345678'), null);
});

test('does not create marketing eligibility without an explicit, current-version opt-in', async () => {
  const f = fixture();
  assert.deepEqual(await f.service.recordOptIn({ phone: '0997310856', explicitConsent: false, consentVersion: MARKETING_CONSENT_VERSION }), { recorded: false, reason: 'no_opt_in' });
  assert.deepEqual(await f.service.recordOptIn({ phone: '0997310856', explicitConsent: true, consentVersion: 'stale-version' }), { recorded: false, reason: 'invalid_consent_version' });
  assert.equal(f.events.length, 0);
  assert.equal(f.cryptoImpl.imported.length, 0);
  assert.equal(await f.service.canReceiveManualMarketing('0997310856'), false);
});

test('stores only a keyed phone digest and requires the latest explicit opt-in for manual eligibility', async () => {
  const f = fixture();
  const result = await f.service.recordOptIn({ phone: '٠٩٩٧٣١٠٨٥٦', explicitConsent: true, consentVersion: MARKETING_CONSENT_VERSION });
  assert.equal(result.recorded, true);
  assert.equal(result.event, 'opt_in');
  assert.deepEqual(f.events[0], {
    phoneKey: f.events[0].phoneKey,
    event: 'opt_in',
    consentVersion: MARKETING_CONSENT_VERSION,
    source: 'order_form',
    occurredAt: '2026-10-31T12:30:00.000Z'
  });
  assert.match(f.events[0].phoneKey, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(JSON.stringify(f.events), /0997310856|963997310856/);
  assert.equal(f.cryptoImpl.imported[0].algorithm.name, 'HMAC');
  assert.equal(f.cryptoImpl.imported[0].algorithm.hash, 'SHA-256');
  assert.equal(f.cryptoImpl.imported[0].extractable, false);
  assert.ok(f.cryptoImpl.signed[0].startsWith('rawaa:marketing-phone:v1\0+963997310856'));
  assert.equal(await f.service.canReceiveManualMarketing('+963 997 310 856'), true);
});

test('opt-in eligibility expires after the proposed bounded 90-day window and rejects future timestamps', async () => {
  const f = fixture();
  await f.service.recordOptIn({ phone: '0997310856', explicitConsent: true, consentVersion: MARKETING_CONSENT_VERSION });
  const key = f.events[0].phoneKey;
  f.setLatest({ phoneKey: key, event: 'opt_in', consentVersion: MARKETING_CONSENT_VERSION, source: 'order_form', occurredAt: '2026-08-03T12:30:00.000Z' });
  assert.equal(await f.service.canReceiveManualMarketing('0997310856'), true);
  f.setLatest({ phoneKey: key, event: 'opt_in', consentVersion: MARKETING_CONSENT_VERSION, source: 'order_form', occurredAt: '2026-08-02T12:30:00.000Z' });
  assert.equal(await f.service.canReceiveManualMarketing('0997310856'), false);
  f.setLatest({ phoneKey: key, event: 'opt_in', consentVersion: MARKETING_CONSENT_VERSION, source: 'order_form', occurredAt: '2026-11-01T12:30:00.000Z' });
  assert.equal(await f.service.canReceiveManualMarketing('0997310856'), false);
});

test('withdrawal requires owner authorization and immediately fails closed for the matching phone', async () => {
  const f = fixture();
  await f.service.recordOptIn({ phone: '0997310856', explicitConsent: true, consentVersion: MARKETING_CONSENT_VERSION });
  assert.deepEqual(await f.service.recordWithdrawal({ phone: '0997310856', ownerAuthorized: false }), { recorded: false, reason: 'unauthorized' });
  assert.equal(f.events.length, 1);
  const result = await f.service.recordWithdrawal({ phone: '+963997310856', ownerAuthorized: true });
  assert.equal(result.recorded, true);
  assert.equal(f.events.length, 2);
  assert.equal(f.events[1].event, 'withdrawal');
  assert.equal(f.events[1].consentVersion, null);
  assert.equal(f.events[1].source, 'owner_withdrawal');
  assert.equal(await f.service.canReceiveManualMarketing('0997310856'), false);
});

test('invalid input, persistence errors and malformed latest events never enable marketing', async () => {
  const f = fixture();
  assert.deepEqual(await f.service.recordOptIn({ phone: 'no-country-code', explicitConsent: true, consentVersion: MARKETING_CONSENT_VERSION }), { recorded: false, reason: 'invalid_phone' });
  assert.equal(await f.service.canReceiveManualMarketing('no-country-code'), false);
  f.repository.appendEvent = async () => { throw new Error('synthetic database failure'); };
  assert.deepEqual(await f.service.recordOptIn({ phone: '0997310856', explicitConsent: true, consentVersion: MARKETING_CONSENT_VERSION }), { recorded: false, reason: 'unavailable' });
  f.setLatest({ phoneKey: 'a'.repeat(64), event: 'opt_in', consentVersion: MARKETING_CONSENT_VERSION, source: 'order_form', occurredAt: 'not-a-date' });
  assert.equal(await f.service.canReceiveManualMarketing('0997310856'), false);
});

test('rejects weak service configuration before handling preferences', () => {
  assert.throws(() => createMarketingPreferenceService({ repository: {}, hmacSecret: 'short' }), /INVALID_CONFIGURATION/);
  assert.throws(() => createMarketingPreferenceService({ repository: { appendEvent() {}, latestEvent() {} }, hmacSecret: 'long-enough-synthetic-value-but-no-crypto', cryptoImpl: {} }), /INVALID_CONFIGURATION/);
});
