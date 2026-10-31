import test from 'node:test';
import assert from 'node:assert/strict';
import { createManufacturingPrototypeServer } from './server.mjs';
import { createManufacturingDomain } from './domain.mjs';

async function withServer(run) {
  const server = createManufacturingPrototypeServer({ domain: createManufacturingDomain() });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  try { await run(`http://127.0.0.1:${address.port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

const cookieFrom = response => (response.headers.get('set-cookie') || '').split(';')[0];
const post = (base, path, payload, cookie, origin) => fetch(`${base}${path}`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    ...(cookie ? { cookie } : {}),
    ...(origin ? { origin } : {})
  },
  body: JSON.stringify(payload)
});

test('local server serves only the allowlisted UI and exposes synthetic-mode health', async () => {
  await withServer(async base => {
    const health = await fetch(`${base}/api/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).mode, 'local-synthetic-demo');
    assert.equal((await fetch(`${base}/`)).status, 200);
    assert.equal((await fetch(`${base}/server.mjs`)).status, 404);
    assert.equal((await fetch(`${base}/.git/config`)).status, 404);
  });
});

test('persona switching is session-bound and cross-origin actions are rejected', async () => {
  await withServer(async base => {
    const initial = await fetch(`${base}/api/state`);
    assert.equal(initial.status, 200);
    const cookieA = cookieFrom(initial);
    assert.ok(cookieA.startsWith('rawaa_mfg_demo='));
    assert.equal((await initial.json()).actor.role, 'designer');

    const switched = await post(base, '/api/demo/persona', { personaId: 'factory-east' }, cookieA, base);
    assert.equal(switched.status, 200);
    const cookieB = cookieFrom(switched);
    const factoryState = await fetch(`${base}/api/state`, { headers: { cookie: cookieB } });
    const view = await factoryState.json();
    assert.equal(view.actor.factoryId, 'factory-east');
    assert.equal(view.product, null);
    assert.equal(view.productionOrders.length, 0);

    const secondSession = await fetch(`${base}/api/state`);
    assert.equal((await secondSession.json()).actor.id, 'designer');
    const forbidden = await post(base, '/api/action', { action: 'GENERATE_CONCEPT', payload: {} }, cookieA, 'https://attacker.invalid');
    assert.equal(forbidden.status, 403);

    const badPersona = await post(base, '/api/demo/persona', { personaId: 'not-a-persona' }, cookieA, base);
    assert.equal(badPersona.status, 422);
  });
});

test('server executes an allowed action and rejects an action assigned to another role', async () => {
  await withServer(async base => {
    const response = await fetch(`${base}/api/state`);
    const cookie = cookieFrom(response);
    const actionResponse = await post(base, '/api/action', { action: 'GENERATE_CONCEPT', payload: {} }, cookie, base);
    assert.equal(actionResponse.status, 200);
    const result = await actionResponse.json();
    assert.equal(result.state.product.status, 'AI_CONCEPT');
    const denied = await post(base, '/api/action', { action: 'PUBLISH_PRODUCT', payload: {} }, cookie, base);
    assert.equal(denied.status, 403);
    assert.equal((await denied.json()).error, 'FORBIDDEN');
  });
});
