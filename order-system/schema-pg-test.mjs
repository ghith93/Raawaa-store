// Integration test against an ephemeral PGlite database, not the production project.
// Install @electric-sql/pglite separately and set PGLITE_MODULE to its absolute module path.
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
if (!process.env.PGLITE_MODULE) throw new Error('Set PGLITE_MODULE to the PGlite module entry');
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE));
const db = new PGlite();
await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
const sql = await readFile(new URL('./migrations/001_private_orders.sql', import.meta.url), 'utf8');
await db.exec(sql);
const oid = '6d6b1ba0-14ce-418c-bfae-2ced2f0ae5b7';
const key = 'e231547a-1e5e-4c4d-af55-f06686a30341';
const insert = `insert into rawaa_store.orders (id, reference, idempotency_key, request_hash, details) values ('${oid}', 'RAWAA-TEST123', '${key}', '${'a'.repeat(64)}', '{"test":true}');`;
// Privileged server path can insert; store + outbox may be committed atomically.
await db.exec(`set role service_role; begin; ${insert} insert into rawaa_store.notification_outbox(order_id) values ('${oid}'); commit; reset role;`);
assert.equal((await db.query('select count(*)::int as n from rawaa_store.orders')).rows[0].n, 1);
assert.equal((await db.query('select count(*)::int as n from rawaa_store.notification_outbox')).rows[0].n, 1);
await assert.rejects(db.exec(`set role service_role; ${insert}`));
await db.exec('reset role');
for (const role of ['anon', 'authenticated']) {
  await db.exec(`set role ${role}`);
  await assert.rejects(db.query('select * from rawaa_store.orders'));
  await assert.rejects(db.query('select * from rawaa_store.notification_outbox'));
  await assert.rejects(db.exec(insert));
  await db.exec('reset role');
}
await assert.rejects(db.exec(`update rawaa_store.notification_outbox set state = 'sending', lease_until = null`));
await db.exec(`begin; insert into rawaa_store.orders (id,reference,idempotency_key,request_hash,details) values ('11111111-1111-4111-8111-111111111111','RAWAA-TEST222','22222222-2222-4222-8222-222222222222','${'b'.repeat(64)}','{}'); rollback;`);
assert.equal((await db.query('select count(*)::int as n from rawaa_store.orders')).rows[0].n, 1);
await db.close();
console.log('Ephemeral PostgreSQL: private roles, constraints, unique key and rollback passed.');
