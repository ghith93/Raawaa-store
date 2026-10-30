import assert from 'node:assert/strict';
import { createClientIdentity } from './client-identity.mjs';
import { createPostgresRateLimiter } from './postgres-rate-limiter.mjs';

const req = headers => ({ headers: new Headers(headers) });
// Stub that bypasses Headers value normalisation, for raw malformed bytes.
const rawReq = value => ({ headers: { get: () => value } });

// --- configuration ---
assert.throws(() => createClientIdentity({}), /INVALID_CONFIGURATION/);
assert.throws(() => createClientIdentity({ mode: 'other', header: 'cf-connecting-ip' }), /INVALID_CONFIGURATION/);
assert.throws(() => createClientIdentity({ mode: 'platform-header', header: 'x-forwarded-for' }), /INVALID_CONFIGURATION/);
assert.throws(() => createClientIdentity({ mode: 'platform-header', header: 'Forwarded' }), /INVALID_CONFIGURATION/);
assert.throws(() => createClientIdentity({ mode: 'platform-header', header: 'bad header!' }), /INVALID_CONFIGURATION/);
assert.throws(() => createClientIdentity({ mode: 'platform-header', header: 'cf-connecting-ip', ipv6GroupBits: 8 }), /INVALID_CONFIGURATION/);
assert.throws(() => createClientIdentity({ mode: 'xff-trusted-hop', header: 'x-forwarded-for' }), /INVALID_CONFIGURATION/);
assert.throws(() => createClientIdentity({ mode: 'xff-trusted-hop', header: 'x-forwarded-for', xffTrustedHops: 0 }), /INVALID_CONFIGURATION/);

// --- platform-header mode ---
const platform = createClientIdentity({ mode: 'platform-header', header: 'cf-connecting-ip' });
assert.equal(await platform.getTrustedIdentity(req({ 'cf-connecting-ip': '192.0.2.1' })), '192.0.2.1');
// Forged chain headers are ignored entirely: only the platform header is read.
assert.equal(await platform.getTrustedIdentity(req({
  'cf-connecting-ip': '192.0.2.1', 'x-forwarded-for': '6.6.6.6', 'x-real-ip': '7.7.7.7'
})), '192.0.2.1');
await assert.rejects(platform.getTrustedIdentity(req({ 'x-forwarded-for': '6.6.6.6' })), /UNTRUSTED_IDENTITY/);
await assert.rejects(platform.getTrustedIdentity(req({})), /UNTRUSTED_IDENTITY/);
await assert.rejects(platform.getTrustedIdentity(req({ 'cf-connecting-ip': '' })), /UNTRUSTED_IDENTITY/);
await assert.rejects(platform.getTrustedIdentity(req({ 'cf-connecting-ip': '1.2.3.4, 5.6.7.8' })), /UNTRUSTED_IDENTITY/);
await assert.rejects(platform.getTrustedIdentity({}), /UNTRUSTED_IDENTITY/);

// --- strict address validation: no hostnames, ports, brackets, zones, ambiguity ---
for (const bad of ['example.com', '1.2.3', '256.1.1.1', '01.2.3.4', '1.2.3.4:80', '1.2.3.4 5.6.7.8',
  '[2001:db8::1]', '2001:db8::1%eth0', '2001:db8:::1', '2001:db8::1::2', '::ffff:999.1.1.1',
  '1::2::3::4', '12345::1', '   ', '-1.2.3.4', '0x7f.0.0.1', '\u00001.2.3.4', '1.2.3.4\u007f']) {
  await assert.rejects(platform.getTrustedIdentity(rawReq(bad)), /UNTRUSTED_IDENTITY/, `should reject ${JSON.stringify(bad)}`);
}

// --- canonicalisation: one spelling, one key ---
assert.equal(await platform.getTrustedIdentity(req({ 'cf-connecting-ip': '::1' })),
  '0000:0000:0000:0000:0000:0000:0000:0001');
assert.equal(await platform.getTrustedIdentity(req({ 'cf-connecting-ip': '2001:DB8:0:0:0:0:0:1' })),
  '2001:0db8:0000:0000:0000:0000:0000:0001');
assert.equal(await platform.getTrustedIdentity(req({ 'cf-connecting-ip': '2001:db8::1' })),
  await platform.getTrustedIdentity(req({ 'cf-connecting-ip': '2001:0db8::0001' })));
// IPv4-mapped keys as its IPv4 address.
assert.equal(await platform.getTrustedIdentity(req({ 'cf-connecting-ip': '::ffff:192.0.2.1' })), '192.0.2.1');

// --- ipv6GroupBits: one household /64 shares one bucket ---
const grouped = createClientIdentity({ mode: 'platform-header', header: 'cf-connecting-ip', ipv6GroupBits: 64 });
const a = await grouped.getTrustedIdentity(req({ 'cf-connecting-ip': '2001:db8:1:2:aaaa::1' }));
const b = await grouped.getTrustedIdentity(req({ 'cf-connecting-ip': '2001:db8:1:2:bbbb::9' }));
const c = await grouped.getTrustedIdentity(req({ 'cf-connecting-ip': '2001:db8:1:3::1' }));
assert.equal(a, b);
assert.notEqual(a, c);
assert.equal(a, '2001:0db8:0001:0002:0000:0000:0000:0000');

// --- xff-trusted-hop: the entry OUR proxy appended, not the client's forgeries ---
const xff1 = createClientIdentity({ mode: 'xff-trusted-hop', header: 'x-forwarded-for', xffTrustedHops: 1 });
assert.equal(await xff1.getTrustedIdentity(req({ 'x-forwarded-for': '6.6.6.6, 198.51.100.7' })), '198.51.100.7');
assert.equal(await xff1.getTrustedIdentity(req({ 'x-forwarded-for': '198.51.100.7' })), '198.51.100.7');
const xff2 = createClientIdentity({ mode: 'xff-trusted-hop', header: 'x-forwarded-for', xffTrustedHops: 2 });
assert.equal(await xff2.getTrustedIdentity(req({ 'x-forwarded-for': '6.6.6.6, 198.51.100.7, 10.0.0.1' })), '198.51.100.7');
await assert.rejects(xff2.getTrustedIdentity(req({ 'x-forwarded-for': '198.51.100.7' })), /UNTRUSTED_IDENTITY/);
await assert.rejects(xff1.getTrustedIdentity(req({})), /UNTRUSTED_IDENTITY/);

// --- integration: the limiter receives a trusted identity and fails closed otherwise ---
const calls = [];
const db = { query: async (text, values) => { calls.push({ text, values }); return { rows: [{ attempts: 1 }] }; } };
const limiter = createPostgresRateLimiter({ db, identityKey: 'k'.repeat(40), getTrustedIdentity: platform.getTrustedIdentity });
assert.equal(await limiter.rateLimit(req({ 'cf-connecting-ip': '192.0.2.1', 'x-forwarded-for': '6.6.6.6' })), true);
assert.match(calls[0].values[0], /^[a-f0-9]{64}$/);
assert.ok(!calls[0].values.includes('192.0.2.1')); // keyed by HMAC, never the raw address
await assert.rejects(limiter.rateLimit(req({ 'x-forwarded-for': '6.6.6.6' })), /UNTRUSTED_IDENTITY/);

console.log('Client identity: platform header only, forged chains ignored, strict canonical keys passed.');
