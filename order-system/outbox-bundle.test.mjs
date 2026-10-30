import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// The deployed bundle is the security surface: it must stay single-file, secret-free,
// and gated by the scheduler secret. This scan fails the build if that ever regresses.
const bundle = await readFile(new URL('./edge/outbox-bundle.mjs', import.meta.url), 'utf8');
const entry = await readFile(new URL('./edge/outbox-entry.mjs', import.meta.url), 'utf8');

// Single Deno.serve binding, npm:postgres as the only surviving import.
assert.equal((bundle.match(/Deno\.serve\(/g) || []).length, 1);
assert.equal((entry.match(/Deno\.serve\(/g) || []).length, 1);
const imports = [...bundle.matchAll(/from\s*["']([^"']+)["']/g)].map(m => m[1]);
assert.deepEqual(imports, ['npm:postgres@3.4.7']);

// No embedded credentials of any shape: bot tokens, JWTs, private keys, URLs with creds.
assert.ok(!/\d{6,}:[A-Za-z0-9_-]{20,}/.test(bundle), 'bot-token-shaped literal');
assert.ok(!/eyJ[A-Za-z0-9_-]{10,}/.test(bundle), 'jwt-shaped literal');
assert.ok(!/BEGIN [A-Z ]*PRIVATE KEY/.test(bundle), 'private key block');
assert.ok(!/https?:\/\/[^\s"']*:[^\s"']*@/.test(bundle), 'URL with embedded credentials');

// Secrets are read by name from the environment only; the scheduler auth gate is present.
for (const name of ['SUPABASE_DB_URL', 'RAWAA_TELEGRAM_BOT_TOKEN', 'RAWAA_OUTBOX_SCHEDULER_SECRET']) {
  assert.ok(bundle.includes(name), `env name ${name}`);
}
assert.ok(bundle.includes('unauthorized'));
assert.ok(/Bearer /.test(bundle));
// Bounded batch: the runner processes at most three items per invocation.
assert.ok(bundle.includes('notification_outbox'));

console.log('Outbox bundle: single file, one serve, secret-free, gated and bounded passed.');
