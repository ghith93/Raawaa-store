import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPostgresMarketingPreferenceRepository } from './marketing-preference-repository.mjs';

const event = {
  phoneKey: 'a'.repeat(64),
  event: 'opt_in',
  consentVersion: 'rawaa-marketing-opt-in-v2',
  source: 'order_form',
  occurredAt: '2026-10-31T12:30:00.000Z'
};

function mockDb(rows = [{ event_id: '7' }]) {
  const calls = [];
  return { calls, db: { async query(sql, params) { calls.push({ sql, params }); return { rows }; } } };
}

test('writes only normalized HMAC preference events with parameterized SQL', async () => {
  const f = mockDb();
  const repository = createPostgresMarketingPreferenceRepository(f.db);
  assert.deepEqual(await repository.appendEvent(event), { eventId: 7 });
  assert.match(f.calls[0].sql, /insert into rawaa_store\.marketing_preference_events/i);
  assert.match(f.calls[0].sql, /values \(\$1, \$2, \$3, \$4, \$5::timestamptz\)/);
  assert.deepEqual(f.calls[0].params, [event.phoneKey, event.event, event.consentVersion, event.source, event.occurredAt]);
  assert.doesNotMatch(f.calls[0].sql, /0997310856|\+963/);
});

test('latest lookup is deterministic by event sequence and maps only explicit fields', async () => {
  const f = mockDb([{ phoneKey: event.phoneKey, event: 'withdrawal', consentVersion: null,
    source: 'owner_withdrawal', occurredAt: '2026-10-31T12:30:00.000Z' }]);
  const repository = createPostgresMarketingPreferenceRepository(f.db);
  assert.deepEqual(await repository.latestEvent(event.phoneKey), f.calls.length ? {
    phoneKey: event.phoneKey, event: 'withdrawal', consentVersion: null,
    source: 'owner_withdrawal', occurredAt: '2026-10-31T12:30:00.000Z'
  } : null);
  assert.match(f.calls[0].sql, /order by event_id desc\s+limit 1/i);
  assert.deepEqual(f.calls[0].params, [event.phoneKey]);
});

test('rejects raw or malformed identifiers and event shapes before database access', async () => {
  const f = mockDb();
  const repository = createPostgresMarketingPreferenceRepository(f.db);
  await assert.rejects(repository.appendEvent({ ...event, phoneKey: '+963997310856' }), /INVALID_EVENT/);
  await assert.rejects(repository.appendEvent({ ...event, event: 'subscribe' }), /INVALID_EVENT/);
  await assert.rejects(repository.appendEvent({ ...event, source: 'owner_withdrawal' }), /INVALID_EVENT/);
  await assert.rejects(repository.latestEvent('0997310856'), /INVALID_PHONE_KEY/);
  assert.equal(f.calls.length, 0);
});

test('fails closed on malformed persistence responses', async () => {
  const f = mockDb([]);
  const repository = createPostgresMarketingPreferenceRepository(f.db);
  await assert.rejects(repository.appendEvent(event), /PREFERENCE_UNAVAILABLE/);
  f.db.query = async () => ({ rows: [{}, {}] });
  await assert.rejects(repository.latestEvent(event.phoneKey), /PREFERENCE_UNAVAILABLE/);
});
