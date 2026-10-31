// Ephemeral PostgreSQL integration test for candidate migration 005.
// This is not Supabase staging or an Edge-runtime E2E test. It never contacts the network.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

if (!process.env.PGLITE_MODULE) throw new Error('Set PGLITE_MODULE to the isolated PGlite module entry');
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE));
const db = new PGlite();
const digestA = 'a'.repeat(64);
const digestB = 'b'.repeat(64);
const digestC = 'c'.repeat(64);
const migration = await readFile(new URL('./migrations/005_marketing_preference_events.sql', import.meta.url), 'utf8');
const rollback = await readFile(new URL('./migrations/005_marketing_preference_events.down.sql', import.meta.url), 'utf8');

try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema rawaa_store;
    revoke all on schema rawaa_store from public, anon, authenticated;
    grant usage on schema rawaa_store to service_role;
  `);
  await db.exec(migration);

  const metadata = (await db.query(`
    select c.relrowsecurity as rls,
      has_table_privilege('service_role', 'rawaa_store.marketing_preference_events', 'select') as service_select,
      has_table_privilege('service_role', 'rawaa_store.marketing_preference_events', 'insert') as service_insert,
      has_table_privilege('service_role', 'rawaa_store.marketing_preference_events', 'update') as service_update,
      has_table_privilege('service_role', 'rawaa_store.marketing_preference_events', 'delete') as service_delete,
      has_table_privilege('anon', 'rawaa_store.marketing_preference_events', 'select') as anon_select,
      has_table_privilege('authenticated', 'rawaa_store.marketing_preference_events', 'insert') as authenticated_insert,
      has_sequence_privilege('service_role', 'rawaa_store.marketing_preference_events_event_id_seq', 'usage') as sequence_usage,
      has_function_privilege('service_role', 'rawaa_store.redact_expired_marketing_preference_events(integer)', 'execute') as service_cleanup,
      has_function_privilege('anon', 'rawaa_store.redact_expired_marketing_preference_events(integer)', 'execute') as anon_cleanup
    from pg_class c
    where c.oid = 'rawaa_store.marketing_preference_events'::regclass
  `)).rows[0];
  assert.deepEqual(metadata, {
    rls: true,
    service_select: true,
    service_insert: true,
    service_update: false,
    service_delete: false,
    anon_select: false,
    authenticated_insert: false,
    sequence_usage: true,
    service_cleanup: true,
    anon_cleanup: false,
  });

  const columns = (await db.query(`
    select column_name from information_schema.columns
    where table_schema = 'rawaa_store' and table_name = 'marketing_preference_events'
    order by ordinal_position
  `)).rows.map(row => row.column_name);
  assert.deepEqual(columns, ['event_id', 'phone_key', 'event', 'consent_version', 'source', 'occurred_at']);
  assert.equal(columns.some(name => /^(?:raw_?phone|phone|phone_number|normalized_phone)$/i.test(name)), false);

  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(db.query('select * from rawaa_store.marketing_preference_events'));
    await assert.rejects(db.query(
      `insert into rawaa_store.marketing_preference_events (phone_key, event, consent_version, source) values ($1, 'opt_in', 'v2', 'order_form')`,
      [digestA],
    ));
    await db.exec('reset role');
  }

  await db.exec('set role service_role');
  const optIn = await db.query(`
    insert into rawaa_store.marketing_preference_events (phone_key, event, consent_version, source)
    values ($1, 'opt_in', 'rawaa-marketing-opt-in-v2', 'order_form') returning event_id
  `, [digestA]);
  const withdrawal = await db.query(`
    insert into rawaa_store.marketing_preference_events (phone_key, event, consent_version, source)
    values ($1, 'withdrawal', null, 'owner_withdrawal') returning event_id
  `, [digestA]);
  assert.equal(Number(withdrawal.rows[0].event_id) > Number(optIn.rows[0].event_id), true);
  const latest = (await db.query(`
    select event from rawaa_store.marketing_preference_events
    where phone_key = $1 order by event_id desc limit 1
  `, [digestA])).rows[0].event;
  assert.equal(latest, 'withdrawal');

  await assert.rejects(db.query(`
    insert into rawaa_store.marketing_preference_events (phone_key, event, consent_version, source)
    values ('not-a-digest', 'opt_in', 'v2', 'order_form')
  `));
  await assert.rejects(db.query(`
    insert into rawaa_store.marketing_preference_events (phone_key, event, consent_version, source)
    values ($1, 'opt_in', null, 'order_form')
  `, [digestB]));
  await assert.rejects(db.query(`
    insert into rawaa_store.marketing_preference_events (phone_key, event, consent_version, source)
    values ($1, 'withdrawal', 'v2', 'owner_withdrawal')
  `, [digestB]));

  await db.query(`
    insert into rawaa_store.marketing_preference_events (phone_key, event, consent_version, source, occurred_at)
    values
      ($1, 'opt_in', 'v2', 'order_form', now() - interval '366 days'),
      ($2, 'opt_in', 'v2', 'order_form', now() - interval '367 days'),
      ($3, 'opt_in', 'v2', 'order_form', now())
  `, [digestA, digestB, digestC]);
  for (const invalidLimit of [0, 501, null]) {
    await assert.rejects(db.query('select rawaa_store.redact_expired_marketing_preference_events($1)', [invalidLimit]));
  }
  assert.equal((await db.query('select rawaa_store.redact_expired_marketing_preference_events(1) as n')).rows[0].n, 1);
  assert.equal((await db.query(`select count(*)::int as n from rawaa_store.marketing_preference_events where occurred_at < now() - interval '365 days'`)).rows[0].n, 1);
  assert.equal((await db.query('select rawaa_store.redact_expired_marketing_preference_events(1) as n')).rows[0].n, 1);
  assert.equal((await db.query(`select count(*)::int as n from rawaa_store.marketing_preference_events where occurred_at < now() - interval '365 days'`)).rows[0].n, 0);
  assert.equal((await db.query('select count(*)::int as n from rawaa_store.marketing_preference_events where phone_key = $1', [digestC])).rows[0].n, 1);
  await db.exec('reset role');

  await db.exec(rollback);
  assert.equal((await db.query(`select to_regclass('rawaa_store.marketing_preference_events') as table_name`)).rows[0].table_name, null);
  assert.equal((await db.query(`select to_regprocedure('rawaa_store.redact_expired_marketing_preference_events(integer)') as function_name`)).rows[0].function_name, null);
} catch (error) {
  // GitHub Actions annotations expose a concise failure reason through the Checks API
  // even when hosted-runner log archives are unavailable to this environment.
  if (process.env.GITHUB_ACTIONS === 'true') {
    const detail = String(error?.message ?? error).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A').slice(0, 500);
    console.log(`::error title=PGlite candidate migration integration::${detail}`);
  }
  throw error;
} finally {
  await db.close();
}

console.log('Ephemeral PGlite: candidate migration 005 constraints, grants, RLS, withdrawal ordering, bounded cleanup, and rollback passed.');
