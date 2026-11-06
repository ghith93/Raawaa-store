// Full-chain retention test against an ephemeral PGlite database, never a hosted project.
// Install @electric-sql/pglite separately and set PGLITE_MODULE to its absolute module path.
//
// Why this file exists: the per-feature PGlite tests each apply only the migrations
// they need, so 001..005 were never exercised together and a cleanup routine that
// referenced a non-existent `closed_at` column passed CI. This test applies every
// migration in order and then actually runs the redaction routine.
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

if (!process.env.PGLITE_MODULE) throw new Error('Set PGLITE_MODULE to the PGlite module entry');
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE));

const db = new PGlite();
await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');

const directory = new URL('./migrations/', import.meta.url);
const chain = (await readdir(directory))
  .filter(name => /^\d{3}_.*\.sql$/.test(name) && !name.endsWith('.down.sql'))
  .sort();
assert.ok(chain.length >= 6, 'expected the full migration chain including 006');
for (const file of chain) {
  await db.exec(await readFile(new URL(file, directory), 'utf8'));
}

const columns = (await db.query(
  "select column_name from information_schema.columns where table_schema='rawaa_store' and table_name='orders'"
)).rows.map(row => row.column_name);
assert.ok(columns.includes('closed_at'), 'retention depends on orders.closed_at existing');

const insertOrder = (reference, key, status = 'pending_review') => `
  insert into rawaa_store.orders (id, reference, idempotency_key, request_hash, order_status, details)
  values (gen_random_uuid(), '${reference}', '${key}', '${'a'.repeat(64)}', '${status}',
          '{"name":"زبونة تجريبية","phone":"0991234567","address":"حماة","totalCents":1600}'::jsonb)`;

await db.exec('set role service_role;');
await db.exec(insertOrder('RAWAA-CHAIN1', '11111111-1111-4111-8111-111111111111'));

// The lifecycle trigger, not a caller, owns closed_at.
assert.equal((await db.query("select closed_at from rawaa_store.orders where reference='RAWAA-CHAIN1'")).rows[0].closed_at, null);
await db.exec("update rawaa_store.orders set order_status='fulfilled' where reference='RAWAA-CHAIN1'");
const closed = (await db.query("select closed_at from rawaa_store.orders where reference='RAWAA-CHAIN1'")).rows[0].closed_at;
assert.ok(closed, 'a fulfilled order must record when it closed');

// Reopening clears the clock, so an open order can never be redacted.
await db.exec("update rawaa_store.orders set order_status='confirmed' where reference='RAWAA-CHAIN1'");
assert.equal((await db.query("select closed_at from rawaa_store.orders where reference='RAWAA-CHAIN1'")).rows[0].closed_at, null);
await db.exec("update rawaa_store.orders set order_status='cancelled' where reference='RAWAA-CHAIN1'");

// A freshly closed order is outside the 365-day window and must survive untouched.
assert.equal((await db.query('select rawaa_store.redact_expired_order_contacts(100) as n')).rows[0].n, 0);
assert.equal((await db.query("select details->>'phone' as phone from rawaa_store.orders where reference='RAWAA-CHAIN1'")).rows[0].phone, '0991234567');

// Age the row past the window, then run the routine that used to fail outright.
await db.exec("update rawaa_store.orders set closed_at = now() - interval '400 days' where reference='RAWAA-CHAIN1'");
assert.equal((await db.query('select rawaa_store.redact_expired_order_contacts(100) as n')).rows[0].n, 1);

const redacted = (await db.query(
  "select details, request_hash, idempotency_key, reference, order_status from rawaa_store.orders where reference='RAWAA-CHAIN1'"
)).rows[0];
for (const field of ['name', 'phone', 'address']) {
  assert.ok(!(field in redacted.details), `${field} must be removed by retention`);
}
assert.equal(redacted.details.totalCents, 1600, 'non-personal order facts are preserved');
assert.equal(redacted.request_hash, null);
assert.equal(redacted.idempotency_key, null);
assert.equal(redacted.reference, 'RAWAA-CHAIN1', 'the reference is not personal data and stays usable');

// Idempotent: a second pass finds nothing left to redact.
assert.equal((await db.query('select rawaa_store.redact_expired_order_contacts(100) as n')).rows[0].n, 0);

// Several redacted rows may coexist even though idempotency_key stays UNIQUE.
await db.exec(insertOrder('RAWAA-CHAIN2', '22222222-2222-4222-8222-222222222222', 'fulfilled'));
await db.exec("update rawaa_store.orders set closed_at = now() - interval '400 days' where reference='RAWAA-CHAIN2'");
assert.equal((await db.query('select rawaa_store.redact_expired_order_contacts(100) as n')).rows[0].n, 1);

// The insert invariant survives the relaxation: a live order still needs both identifiers.
await assert.rejects(db.exec(`
  insert into rawaa_store.orders (id, reference, request_hash, details)
  values (gen_random_uuid(), 'RAWAA-CHAIN3', '${'b'.repeat(64)}', '{"phone":"0991234567"}'::jsonb)`));
await assert.rejects(db.exec(`
  insert into rawaa_store.orders (id, reference, idempotency_key, details)
  values (gen_random_uuid(), 'RAWAA-CHAIN4', '33333333-3333-4333-8333-333333333333', '{"phone":"0991234567"}'::jsonb)`));

// Batch bounds are still enforced.
for (const limit of [0, 501, -1]) {
  await assert.rejects(db.query(`select rawaa_store.redact_expired_order_contacts(${limit})`));
}
await db.exec('reset role');

// Private schema: no anonymous or authenticated access to the data or the routines.
for (const role of ['anon', 'authenticated']) {
  await db.exec(`set role ${role}`);
  await assert.rejects(db.query('select * from rawaa_store.orders'));
  await assert.rejects(db.query('select rawaa_store.redact_expired_order_contacts(10)'));
  await db.exec('reset role');
}

// The candidate rollback removes only the lifecycle additions, never order rows.
const before = (await db.query('select count(*)::int as n from rawaa_store.orders')).rows[0].n;
await db.exec('set role service_role;');
await db.exec("delete from rawaa_store.orders where request_hash is null");
await db.exec('reset role');
await db.exec(await readFile(new URL('006_order_closed_at.down.sql', directory), 'utf8'));
assert.equal((await db.query('select count(*)::int as n from rawaa_store.orders')).rows[0].n, before - 2);
const afterRollback = (await db.query(
  "select column_name from information_schema.columns where table_schema='rawaa_store' and table_name='orders'"
)).rows.map(row => row.column_name);
assert.ok(!afterRollback.includes('closed_at'));

await db.close();
console.log('retention chain: migrations applied, redaction verified, rollback clean');
