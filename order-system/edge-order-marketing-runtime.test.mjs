import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createEdgeOrder } from './edge-order-runtime.mjs';

const sandbox = { window: {} };
vm.runInNewContext(await readFile(new URL('../js/config.js', import.meta.url), 'utf8'), sandbox);
const config = sandbox.window.RAWAA_CONFIG;
const origin = 'https://store.example';
const env = {
  SUPABASE_DB_URL: 'postgres://synthetic',
  RAWAA_TURNSTILE_SECRET: 'synthetic-turnstile-secret',
  RAWAA_RATE_LIMIT_HMAC_KEY: 'synthetic-rate-limit-key-at-least-32-bytes',
  RAWAA_OWNER_ORIGIN: origin,
  RAWAA_MARKETING_HMAC_KEY: 'synthetic-marketing-hmac-key-at-least-32-bytes'
};
const payload = {
  order: { name: 'Synthetic', phone: '0991234567', address: 'Test', items: [{ id: 'serum-30', qty: 1 }], zone: 'hama', method: 'cod' },
  idempotencyKey: 'e231547a-1e5e-4c4d-af55-f06686a30341',
  challengeToken: 'synthetic-token', consent: true, marketingConsent: true
};

function setup({ marketingKey = env.RAWAA_MARKETING_HMAC_KEY, preferenceFailure = false } = {}) {
  const queries = [];
  const getEnv = key => key === 'RAWAA_MARKETING_HMAC_KEY' ? marketingKey : env[key];
  const database = {
    async unsafe(sql, values = []) {
      queries.push({ sql, values });
      if (/order_rate_limit/.test(sql)) return [{ attempts: 1 }];
      if (/insert into rawaa_store\.orders/.test(sql)) return [{ reference: values[1] }];
      if (/insert into rawaa_store\.notification_outbox/.test(sql)) return [];
      if (/insert into rawaa_store\.marketing_preference_events/.test(sql)) {
        if (preferenceFailure) throw new Error('synthetic migration missing');
        return [{ event_id: '1' }];
      }
      throw new Error('unexpected synthetic SQL');
    },
    async begin(callback) { return callback(this); }
  };
  const handler = createEdgeOrder({
    getEnv,
    postgresFactory: (url, options) => {
      assert.equal(url, env.SUPABASE_DB_URL);
      assert.equal(options.max, 1);
      return database;
    },
    getTrustedIdentity: async () => '203.0.113.9',
    config,
    fetchImpl: async (url, init) => {
      assert.equal(url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
      assert.match(init.body, /synthetic-token/);
      return { ok: true, json: async () => ({ success: true, hostname: 'store.example', action: 'rawaa_order' }) };
    }
  });
  return { handler, queries };
}

const request = body => new Request('https://edge.example/orders', {
  method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body)
});

test('edge composition records an explicit opt-in as an HMAC-only event after new order creation', async () => {
  const f = setup();
  const response = await f.handler(request(payload));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.match(result.reference, /^RAWAA-[A-Z0-9]{24}$/);
  assert.equal(result.status, 'pending_review');
  assert.equal(result.marketingOptInStatus, 'recorded');
  const insert = f.queries.find(query => /insert into rawaa_store\.marketing_preference_events/.test(query.sql));
  assert.ok(insert);
  assert.match(insert.values[0], /^[0-9a-f]{64}$/);
  assert.deepEqual(insert.values.slice(1, 4), ['opt_in', 'rawaa-marketing-opt-in-v2', 'order_form']);
  assert.doesNotMatch(JSON.stringify(insert), /0991234567|963991234567/);
});

test('missing HMAC configuration or missing candidate migration does not block an order or enable opt-in', async () => {
  const noKey = setup({ marketingKey: null });
  const noKeyResponse = await noKey.handler(request(payload));
  assert.equal(noKeyResponse.status, 200);
  assert.equal((await noKeyResponse.json()).marketingOptInStatus, 'not_recorded');
  assert.equal(noKey.queries.some(query => /marketing_preference_events/.test(query.sql)), false);

  const unavailable = setup({ preferenceFailure: true });
  const unavailableResponse = await unavailable.handler(request(payload));
  assert.equal(unavailableResponse.status, 200);
  assert.equal((await unavailableResponse.json()).marketingOptInStatus, 'not_recorded');
});

test('unchecked customer choice never writes a marketing preference event', async () => {
  const f = setup();
  const response = await f.handler(request({ ...payload, marketingConsent: false }));
  assert.equal(response.status, 200);
  assert.equal(Object.hasOwn(await response.json(), 'marketingOptInStatus'), false);
  assert.equal(f.queries.some(query => /marketing_preference_events/.test(query.sql)), false);
});
