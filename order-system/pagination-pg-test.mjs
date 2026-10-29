import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { createPostgresRepository } from './postgres-repository.mjs';
import { createOwnerHandler } from './owner-api.mjs';
if (!process.env.PGLITE_MODULE) throw new Error('Set PGLITE_MODULE');
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE));
const db = new PGlite();
await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
await db.exec(await readFile(new URL('./migrations/001_private_orders.sql', import.meta.url), 'utf8'));
// Two timestamps only one microsecond apart; many rows have the same timestamp.
for (let i = 0; i < 105; i++) {
  const uuid = crypto.randomUUID();
  const ref = `RAWAA-${String(i).padStart(6, '0')}`;
  const time = i % 2 === 0 ? '2026-10-30T10:00:00.123456Z' : '2026-10-30T10:00:00.123455Z';
  await db.query(`insert into rawaa_store.orders(id, reference, idempotency_key, request_hash, details, created_at) values($1,$2,$3,$4,$5::jsonb,$6::timestamptz)`, [uuid, ref, crypto.randomUUID(), 'a'.repeat(64), JSON.stringify({ name: 'Test', phone: '0000000', address: 'Test', entries: [] }), time]);
}
const ownerId = '11111111-1111-4111-8111-111111111111';
const handler = createOwnerHandler({ ownerId, allowedOrigin: 'https://store.example', verifyUser: async () => ({ id: ownerId }), repository: createPostgresRepository(db) });
let cursor = null, pages = 0;
const refs = new Set();
do {
  const url = new URL('https://backend.example/orders');
  if (cursor) url.searchParams.set('cursor', cursor);
  const response = await handler(new Request(url, { headers: { authorization: 'Bearer valid' } }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(body.orders.length <= 50);
  for (const item of body.orders) {
    assert.ok(!refs.has(item.reference), 'repeated order');
    refs.add(item.reference);
  }
  cursor = body.nextCursor;
  assert.equal(body.hasMore, Boolean(cursor));
  pages++;
  assert.ok(pages <= 3);
} while (cursor);
assert.equal(pages, 3);
assert.equal(refs.size, 105);
await db.close();
console.log('Ephemeral PostgreSQL: 105 orders across pages without omissions or duplicates, microsecond timestamps preserved.');
