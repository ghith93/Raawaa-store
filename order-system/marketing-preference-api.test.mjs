import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMarketingPreferenceHandler } from './marketing-preference-api.mjs';

const ownerId = '123e4567-e89b-12d3-a456-426614174000';
const origin = 'https://raawaa-store.pages.dev';
const endpoint = 'https://preferences.test/withdraw';

function fixture(overrides = {}) {
  const calls = [];
  const service = { async recordWithdrawal(input) { calls.push(input); return { recorded: true }; } };
  const handler = createMarketingPreferenceHandler({
    ownerId,
    allowedOrigin: origin,
    verifyUser: async token => token === 'valid-owner-token' ? { id: ownerId } : null,
    service,
    ...overrides
  });
  return { handler, calls, service };
}
function request({ method = 'POST', headers = {}, body = JSON.stringify({ action: 'withdraw', phone: '0997310856' }), url = endpoint } = {}) {
  return new Request(url, { method, headers: { origin, 'content-type': 'application/json', authorization: 'Bearer valid-owner-token', ...headers }, body: ['GET', 'HEAD', 'OPTIONS'].includes(method) ? undefined : body });
}

test('only the verified owner can record a withdrawal; the response reveals no phone or prior status', async () => {
  const f = fixture();
  const response = await f.handler(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(f.calls, [{ phone: '0997310856', ownerAuthorized: true }]);
  assert.equal(response.headers.get('cache-control'), 'no-store, private');

  const unauthorized = await f.handler(request({ headers: { authorization: 'Bearer wrong-token' } }));
  assert.equal(unauthorized.status, 401);
  assert.equal(f.calls.length, 1);
});

test('rejects foreign owner, origin, absent origin, methods, and query parameters before persistence', async () => {
  const f = fixture();
  const wrongOwner = fixture({ verifyUser: async () => ({ id: '223e4567-e89b-12d3-a456-426614174000' }) });
  assert.equal((await wrongOwner.handler(request())).status, 403);
  assert.equal((await f.handler(request({ headers: { origin: 'https://evil.test' } }))).status, 403);
  assert.equal((await f.handler(request({ headers: { origin: '' } }))).status, 403);
  assert.equal((await f.handler(request({ method: 'GET' }))).status, 405);
  assert.equal((await f.handler(request({ url: endpoint + '?phone=0997310856' }))).status, 400);
  assert.equal(f.calls.length, 0);
});

test('preflight is limited to the configured owner origin and approved headers', async () => {
  const f = fixture();
  const response = await f.handler(request({ method: 'OPTIONS' }));
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), origin);
  assert.equal(response.headers.get('access-control-allow-methods'), 'POST, OPTIONS');
  assert.match(response.headers.get('access-control-allow-headers'), /authorization/);
  assert.equal(f.calls.length, 0);
});

test('validates body shape and bounds streamed request bytes', async () => {
  const f = fixture();
  assert.equal((await f.handler(request({ body: JSON.stringify({ action: 'withdraw', phone: '0997310856', name: 'synthetic' }) }))).status, 400);
  assert.equal((await f.handler(request({ body: JSON.stringify({ action: 'subscribe', phone: '0997310856' }) }))).status, 400);
  assert.equal((await f.handler(request({ body: '{broken' }))).status, 400);
  assert.equal((await f.handler(request({ headers: { 'content-type': 'text/plain' } }))).status, 400);
  assert.equal((await f.handler(request({ body: 'x'.repeat(1025) }))).status, 413);
  assert.equal(f.calls.length, 0);
});

test('database or preference service failures return a generic unavailable response', async () => {
  const f = fixture({ service: { async recordWithdrawal() { throw new Error('synthetic storage details'); } } });
  const response = await f.handler(request());
  assert.equal(response.status, 503);
  const text = await response.text();
  assert.doesNotMatch(text, /synthetic storage|0997310856/);
});

test('withdrawal handler fails closed when not configured', async () => {
  const handler = createMarketingPreferenceHandler({ ownerId: null, allowedOrigin: origin, verifyUser: async () => ({ id: ownerId }), service: { recordWithdrawal() {} } });
  assert.equal((await handler(request())).status, 503);
});
