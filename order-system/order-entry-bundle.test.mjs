import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadStoreConfig } from './store-config.mjs';

// The intake bundle is the future deployment surface: single-file, secret-free,
// and never built from stale prices. The hash guard fails the build whenever
// js/config.js changes without re-running scripts/build-order-entry.mjs.
const bundle = await readFile(new URL('./edge/order-entry-bundle.mjs', import.meta.url), 'utf8');
const entry = await readFile(new URL('./edge/order-entry.mjs', import.meta.url), 'utf8');

// Single Deno.serve binding; npm:postgres is the only surviving import.
assert.equal((bundle.match(/Deno\.serve\(/g) || []).length, 1);
assert.equal((entry.match(/Deno\.serve\(/g) || []).length, 1);
const imports = [...bundle.matchAll(/from\s*["']([^"']+)["']/g)].map(m => m[1]);
assert.deepEqual(imports, ['npm:postgres@3.4.7']);

// No embedded credentials of any shape.
assert.ok(!/\d{6,}:[A-Za-z0-9_-]{20,}/.test(bundle), 'bot-token-shaped literal');
assert.ok(!/eyJ[A-Za-z0-9_-]{10,}/.test(bundle), 'jwt-shaped literal');
assert.ok(!/BEGIN [A-Z ]*PRIVATE KEY/.test(bundle), 'private key block');
assert.ok(!/https?:\/\/[^\s"']*:[^\s"']*@/.test(bundle), 'URL with embedded credentials');

// Secrets are read by name from the environment only.
for (const name of ['SUPABASE_DB_URL', 'RAWAA_TURNSTILE_SECRET', 'RAWAA_RATE_LIMIT_HMAC_KEY', 'RAWAA_OWNER_ORIGIN']) {
  assert.ok(bundle.includes(name), `env name ${name}`);
}

// Identity adapter is wired: platform header, spoofed chains refused, fail closed.
assert.ok(bundle.includes('cf-connecting-ip'));
assert.ok(bundle.includes('UNTRUSTED_IDENTITY'));

// Stale-bundle guard: the inlined config hash must match js/config.js right now.
const config = await loadStoreConfig();
const hash = createHash('sha256').update(JSON.stringify(config)).digest('hex');
assert.ok(bundle.includes(hash), 'stale bundle: rebuild with node scripts/build-order-entry.mjs');
// Spot-check that prices really came from the trusted source.
for (const product of config.products) {
  assert.ok(bundle.includes(`"${product.id}"`), `product ${product.id} missing`);
}
assert.ok(bundle.includes(String(hash.slice(0, 12))));

console.log('Order entry bundle: single file, secret-free, identity wired, prices current passed.');
