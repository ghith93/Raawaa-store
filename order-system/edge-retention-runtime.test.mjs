import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEdgeRetention } from './edge-retention-runtime.mjs';

const secret = 'B'.repeat(43);
const authorizedRequest = () => new Request('https://edge.example/retention', {
  method: 'POST',
  headers: { authorization: `Bearer ${secret}` }
});

test('edge adapter invokes both fixed 500-row redaction queries and returns no counts', async () => {
  const queries = [];
  let factoryCalls = 0;
  const handler = createEdgeRetention({
    getEnv: key => ({ SUPABASE_DB_URL: 'postgres://synthetic', RAWAA_RETENTION_SCHEDULER_SECRET: secret })[key],
    postgresFactory: (url, options) => {
      factoryCalls++;
      assert.equal(url, 'postgres://synthetic');
      assert.equal(options.max, 1);
      return { unsafe: async (sql, values) => { queries.push({ sql, values }); return [{ redacted: 7 }]; } };
    }
  });
  const response = await handler(authorizedRequest());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(factoryCalls, 1);
  assert.deepEqual(queries, [
    { sql: 'select rawaa_store.redact_expired_order_contacts($1)::integer as redacted', values: [500] },
    { sql: 'select rawaa_store.redact_expired_marketing_preference_events($1)::integer as redacted', values: [500] }
  ]);
});

test('edge adapter fails closed when required database settings are absent or the function errors', async () => {
  let connected = false;
  const missing = createEdgeRetention({ getEnv: () => undefined, postgresFactory: () => { connected = true; } });
  assert.equal((await missing(authorizedRequest())).status, 503);
  assert.equal(connected, false);

  const broken = createEdgeRetention({
    getEnv: key => ({ SUPABASE_DB_URL: 'postgres://synthetic', RAWAA_RETENTION_SCHEDULER_SECRET: secret })[key],
    postgresFactory: () => ({ unsafe: async () => { throw new Error('private database error'); } })
  });
  const response = await broken(authorizedRequest());
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'unavailable' });
});
