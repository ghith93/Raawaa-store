import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEdgeMarketingPreferences } from './edge-marketing-preferences-runtime.mjs';

const ownerId = '123e4567-e89b-12d3-a456-426614174000';
const origin = 'https://raawaa-store.pages.dev';
const env = {
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_ANON_KEY: 'synthetic-publishable-key',
  SUPABASE_DB_URL: 'postgres://synthetic',
  RAWAA_OWNER_USER_ID: ownerId,
  RAWAA_OWNER_ORIGIN: origin,
  RAWAA_MARKETING_HMAC_KEY: 'synthetic-only-marketing-hmac-key-32-bytes'
};

function build(overrides = {}) {
  const queries = [];
  const fetchCalls = [];
  const state = { connections: 0 };
  const handler = createEdgeMarketingPreferences({
    getEnv: key => ({ ...env, ...overrides.env })[key],
    postgresFactory: (url, options) => {
      state.connections++;
      assert.equal(url, env.SUPABASE_DB_URL);
      assert.equal(options.max, 1);
      return { unsafe: async (sql, values) => { queries.push({ sql, values }); return [{ event_id: '9' }]; } };
    },
    fetchImpl: async (url, options) => {
      fetchCalls.push({ url, options });
      return overrides.fetchResponse || Response.json({ id: ownerId });
    },
    ...overrides.dependencies
  });
  return { handler, queries, fetchCalls, state };
}

function request({ token = 'synthetic-owner-token', originValue = origin, phone = '0997310856' } = {}) {
  return new Request('https://edge.example/withdraw', {
    method: 'POST',
    headers: { origin: originValue, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'withdraw', phone })
  });
}

test('owner withdrawal endpoint verifies the owner and persists only a keyed phone digest', async () => {
  const f = build();
  const response = await f.handler(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(f.fetchCalls[0].url, `${env.SUPABASE_URL}/auth/v1/user`);
  assert.equal(f.fetchCalls[0].options.headers.apikey, env.SUPABASE_ANON_KEY);
  assert.equal(f.fetchCalls[0].options.headers.authorization, 'Bearer synthetic-owner-token');
  assert.equal(f.queries.length, 1);
  assert.match(f.queries[0].values[0], /^[0-9a-f]{64}$/);
  assert.deepEqual(f.queries[0].values.slice(1), ['withdrawal', null, 'owner_withdrawal', f.queries[0].values[4]]);
  assert.doesNotMatch(JSON.stringify(f.queries), /0997310856|963997310856/);
});

test('invalid environment fails closed before database or identity-provider calls', async () => {
  const f = build({ env: { RAWAA_MARKETING_HMAC_KEY: '' } });
  const response = await f.handler(request());
  assert.equal(response.status, 503);
  assert.equal(f.state.connections, 0);
  assert.equal(f.fetchCalls.length, 0);
});

test('wrong owner and origin cannot record an event', async () => {
  const f = build({ fetchResponse: Response.json({ id: '223e4567-e89b-12d3-a456-426614174000' }) });
  assert.equal((await f.handler(request())).status, 403);
  assert.equal(f.queries.length, 0);
  assert.equal((await f.handler(request({ originValue: 'https://evil.example' }))).status, 403);
  assert.equal(f.queries.length, 0);
});
