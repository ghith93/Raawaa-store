import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const bundle = await readFile(new URL('./edge/order-entry-bundle.mjs', import.meta.url), 'utf8');
const importMatch = /^import\s+(\w+)\s+from\s*["']npm:postgres@3\.4\.7["'];/m.exec(bundle);
assert.ok(importMatch, 'built edge entry should expose only the external Postgres import');

function makeHarness({ marketingConsent = true, marketingKey = 'synthetic-bundle-hmac-key-never-use-in-production' } = {}) {
  const queries = [];
  const env = {
    SUPABASE_DB_URL: 'postgres://synthetic',
    RAWAA_TURNSTILE_SECRET: 'synthetic-turnstile-secret',
    RAWAA_RATE_LIMIT_HMAC_KEY: 'synthetic-rate-limit-key-at-least-32-bytes',
    RAWAA_OWNER_ORIGIN: 'https://store.example',
    RAWAA_MARKETING_HMAC_KEY: marketingKey
  };
  const database = {
    async unsafe(sql, values = []) {
      queries.push({ sql, values });
      if (/order_rate_limit/.test(sql)) return [{ attempts: 1 }];
      if (/insert into rawaa_store\.orders/.test(sql)) return [{ reference: values[1] }];
      if (/insert into rawaa_store\.notification_outbox/.test(sql)) return [];
      if (/insert into rawaa_store\.marketing_preference_events/.test(sql)) return [{ event_id: '1' }];
      throw new Error('unexpected synthetic SQL');
    },
    async begin(callback) { return callback(this); }
  };
  const postgresMock = (url, options) => {
    assert.equal(url, env.SUPABASE_DB_URL);
    assert.equal(options.max, 1);
    return database;
  };
  let handler;
  const context = {
    postgresMock,
    Deno: {
      env: { get: key => env[key] },
      serve(value) { handler = value; }
    },
    fetch: async (url, init) => {
      assert.equal(url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
      assert.match(init.body, /synthetic-challenge/);
      return { ok: true, json: async () => ({ success: true, hostname: 'store.example', action: 'rawaa_order' }) };
    },
    crypto: webcrypto,
    Request, Response, Headers, AbortSignal, URL, TextEncoder, TextDecoder,
    Uint8Array, ArrayBuffer, structuredClone
  };
  const source = bundle.replace(importMatch[0], `const ${importMatch[1]} = postgresMock;`);
  vm.runInNewContext(source, context, { filename: 'order-entry-bundle.mjs' });
  assert.equal(typeof handler, 'function', 'bundle should register exactly one edge handler');

  const payload = {
    order: { name: 'Synthetic', phone: '0991234567', address: 'Test', items: [{ id: 'serum-30', qty: 1 }], zone: 'hama', method: 'cod' },
    idempotencyKey: 'e231547a-1e5e-4c4d-af55-f06686a30341',
    challengeToken: 'synthetic-challenge', consent: true, marketingConsent
  };
  const request = new Request('https://edge.example/orders', {
    method: 'POST',
    headers: { origin: 'https://store.example', 'cf-connecting-ip': '203.0.113.9', 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return { handler, request, queries };
}

test('built entry completes a synthetic order and stores only a keyed marketing event without sending externally', async () => {
  const f = makeHarness();
  const response = await f.handler(f.request);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.match(result.reference, /^RAWAA-[A-Z0-9]{24}$/);
  assert.equal(result.status, 'pending_review');
  assert.equal(result.marketingOptInStatus, 'recorded');
  const event = f.queries.find(query => /insert into rawaa_store\.marketing_preference_events/.test(query.sql));
  assert.ok(event);
  assert.match(event.values[0], /^[0-9a-f]{64}$/);
  assert.deepEqual(Array.from(event.values.slice(1, 4)), ['opt_in', 'rawaa-marketing-opt-in-v2', 'order_form']);
  assert.doesNotMatch(JSON.stringify(event), /0991234567|963991234567/);
  assert.equal(f.queries.some(query => /telegram|whatsapp/i.test(query.sql)), false);
});

test('built entry never creates a marketing event for an unchecked choice', async () => {
  const f = makeHarness({ marketingConsent: false });
  const response = await f.handler(f.request);
  assert.equal(response.status, 200);
  assert.equal(Object.hasOwn(await response.json(), 'marketingOptInStatus'), false);
  assert.equal(f.queries.some(query => /marketing_preference_events/.test(query.sql)), false);
});
