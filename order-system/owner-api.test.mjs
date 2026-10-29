import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOwnerHandler, supabaseUserVerifier } from './owner-api.mjs';
const ownerId = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const origin = 'https://store.example';
const row = { cursor_id: '66666666-6666-4666-8666-666666666666', cursor_time: '2026-10-30T12:00:00.123456Z', reference: 'RAWAA-TEST123', created_at: '2026-10-30', order_status: 'pending_review', notification_state: 'unknown',
  details: { name: 'اختبار', phone: '0990000000', address: 'عنوان تجريبي', entries: [{ id: 'serum-30', size: '30 مل', qty: 1, unitCents: 1700, internal: 'secret' }], totalCents: 1900, internal: 'secret' }, request_hash: 'secret' };
let queries = 0;
const repository = { async listRecent() { queries++; return [row]; } };
const verifyUser = async token => token === 'owner-token' ? { id: ownerId } : token === 'other-token' ? { id: other } : null;
const handler = createOwnerHandler({ ownerId, allowedOrigin: origin, verifyUser, repository });
const req = (token, opts = {}) => new Request('https://backend.example/orders', { headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(opts.origin ? { origin: opts.origin } : {}) }, method: opts.method || 'GET' });

test('denies missing, invalid, non-owner and failing verification before database access', async () => {
  queries = 0;
  assert.equal((await handler(req())).status, 401);
  assert.equal((await handler(req('forged'))).status, 403);
  assert.equal((await handler(req('other-token'))).status, 403);
  assert.equal((await handler(req('owner-token', { origin: 'https://evil.example' }))).status, 403);
  const throwing = createOwnerHandler({ ownerId, allowedOrigin: origin, repository, verifyUser: async () => { throw new Error('private'); } });
  assert.equal((await throwing(req('owner-token'))).status, 401);
  assert.equal(queries, 0);
});

test('authorizes the verified owner, disables caching and returns only explicit fields', async () => {
  const res = await handler(req('owner-token', { origin }));
  assert.equal(res.status, 200);
  assert.match(res.headers.get('cache-control'), /no-store/);
  assert.equal(res.headers.get('access-control-allow-origin'), origin);
  const result = await res.json();
  assert.equal(result.orders[0].phone, row.details.phone);
  assert.equal(result.orders[0].notification, 'unknown');
  assert.ok(!JSON.stringify(result).includes('secret'));
});

test('fails closed on missing configuration, bad methods and repository errors', async () => {
  assert.equal((await createOwnerHandler({ allowedOrigin: origin, verifyUser, repository })(req('owner-token'))).status, 503);
  assert.equal((await handler(req('owner-token', { method: 'POST' }))).status, 405);
  const failed = createOwnerHandler({ ownerId, allowedOrigin: origin, verifyUser, repository: { async listRecent() { throw new Error('private data'); } } });
  const result = await failed(req('owner-token'));
  assert.equal(result.status, 503);
  assert.ok(!(await result.text()).includes('private data'));
});

test('only approved origins receive preflight CORS headers and page truncation is explicit', async () => {
  assert.equal((await handler(req(null, { method: 'OPTIONS', origin }))).status, 204);
  assert.equal((await handler(req(null, { method: 'OPTIONS', origin: 'https://evil.example' }))).status, 403);
  const many = createOwnerHandler({ ownerId, allowedOrigin: origin, verifyUser, repository: { async listRecent() { return Array(51).fill(row); } } });
  const result = await (await many(req('owner-token'))).json();
  assert.equal(result.orders.length, 50);
  assert.equal(result.hasMore, true);
  assert.ok(result.nextCursor);
  let seen;
  const paged = createOwnerHandler({ ownerId, allowedOrigin: origin, verifyUser, repository: { async listRecent(cursor) { seen = cursor; return []; } } });
  const next = await paged(new Request(`https://backend.example/orders?cursor=${result.nextCursor}`, { headers: { authorization: 'Bearer owner-token' } }));
  assert.equal(next.status, 200);
  assert.deepEqual(seen, { time: row.cursor_time, id: row.cursor_id });
  const invalid = await paged(new Request('https://backend.example/orders?cursor=bad', { headers: { authorization: 'Bearer owner-token' } }));
  assert.equal(invalid.status, 400);
});

test('Supabase verifier obtains a server-validated user, never trusts a session object', async () => {
  let received;
  const verifier = supabaseUserVerifier({ auth: { async getUser(token) { received = token; return { data: { user: { id: ownerId } }, error: null }; } } });
  assert.deepEqual(await verifier('signed.token'), { id: ownerId });
  assert.equal(received, 'signed.token');
  assert.equal(await supabaseUserVerifier({ auth: { async getUser() { return { error: 'bad', data: {} }; } } })('bad'), null);
});
