import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('./migrations/004_order_retention.sql', import.meta.url), 'utf8');
const rollback = await readFile(new URL('./migrations/004_order_retention.down.sql', import.meta.url), 'utf8');
const preferences = await readFile(new URL('./migrations/005_marketing_preference_events.sql', import.meta.url), 'utf8');
const preferencesRollback = await readFile(new URL('./migrations/005_marketing_preference_events.down.sql', import.meta.url), 'utf8');
const pgliteIntegration = await readFile(new URL('./marketing-preferences-pg-test.mjs', import.meta.url), 'utf8');
const ciWorkflow = await readFile(new URL('../.github/workflows/site-checks.yml', import.meta.url), 'utf8');

test('retention source matches the already-applied staging migration and remains bounded/private', () => {
  assert.match(migration, /20261030134505\/rawaa_order_retention/);
  assert.match(migration, /closed_at < now\(\) - interval '365 days'/);
  assert.match(migration, /batch_limit < 1 or batch_limit > 500/);
  assert.match(migration, /for update skip locked/i);
  assert.match(migration, /details - array\['name', 'phone', 'address'\]/);
  assert.match(migration, /request_hash = null/);
  assert.match(migration, /idempotency_key = null/);
  assert.match(migration, /revoke all .* from public, anon, authenticated/i);
  assert.match(migration, /grant execute .* to service_role/i);
  assert.doesNotMatch(migration, /create\s+table|insert\s+into/i);
});

test('retention rollback removes only the function, never order or outbox data', () => {
  assert.match(rollback, /drop function if exists rawaa_store\.redact_expired_order_contacts\(integer\)/i);
  assert.doesNotMatch(rollback, /drop\s+table|delete\s+from|truncate/i);
  assert.match(rollback, /do not run here/i);
});

test('marketing preference schema stores only a keyed digest, is private, and has bounded expiry', () => {
  assert.match(preferences, /phone_key text not null check \(phone_key ~ '\^\[0-9a-f\]\{64\}\$'\)/);
  assert.match(preferences, /event in \('opt_in', 'withdrawal'\)/);
  assert.match(preferences, /alter table rawaa_store\.marketing_preference_events enable row level security/i);
  assert.match(preferences, /revoke all .* from public, anon, authenticated/i);
  assert.match(preferences, /grant select, insert on rawaa_store\.marketing_preference_events to service_role/i);
  assert.doesNotMatch(preferences, /grant [^;]*delete on rawaa_store\.marketing_preference_events to service_role/i);
  assert.match(preferences, /security definer/i);
  assert.match(preferences, /occurred_at < now\(\) - interval '365 days'/);
  assert.match(preferences, /batch_limit < 1 or batch_limit > 500/);
  assert.match(preferences, /for update skip locked/i);
  assert.doesNotMatch(preferences, /phone\s+text|raw_phone|insert\s+into[^;]*phone\s*[,)]/i);
  assert.match(preferencesRollback, /drop table if exists rawaa_store\.marketing_preference_events/i);
  assert.match(preferencesRollback, /irreversibly lost/i);
});

test('candidate migration has a PGlite integration test enrolled in the existing isolated CI job', () => {
  assert.match(pgliteIntegration, /create role anon/);
  assert.match(pgliteIntegration, /db\.exec\(migration\)/);
  assert.match(pgliteIntegration, /await db\.exec\(rollback\)/);
  assert.match(ciWorkflow, /@electric-sql\/pglite@0\.3\.14/);
  assert.match(ciWorkflow, /order-system\/\*-pg-test\.mjs/);
  assert.match(pgliteIntegration, /marketing_preference_events/);
  assert.doesNotMatch(pgliteIntegration, /fetch\(|https?:\/\//i);
});
