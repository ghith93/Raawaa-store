/**
 * Deployment-platform client identity for the staged order intake.
 *
 * Produces the string consumed by `createPostgresRateLimiter`'s getTrustedIdentity.
 * It reads ONLY a header that the deployment platform overwrites on every request.
 * Client-initiated chain headers (X-Forwarded-For, Forwarded) are never trusted in
 * platform-header mode because a client can start those lists and rotate the key.
 *
 * Supported modes:
 * - 'platform-header': one platform-overwritten header, e.g. 'cf-connecting-ip'
 *   on Cloudflare-fronted deployments. A live spoofing probe on the deployment is
 *   required before trusting any other header name: send forged values of the
 *   chosen header and confirm they never reach the function. Undocumented gateway
 *   behaviour has changed before (see docs/ORDER-SYSTEM-PROGRESS-AR.md).
 * - 'xff-trusted-hop': last resort when only X-Forwarded-For exists. xffTrustedHops
 *   is the number of entries appended by OUR trusted proxies; the entry at index
 *   length - xffTrustedHops is taken, so client-forged entries in front are ignored.
 *   The hop count must match the actual chain; a gateway that REBUILDS the header
 *   changes what the rightmost entries mean, so verify with a probe first.
 *
 * NAT/shared networks: an IP identity cannot distinguish visitors behind one
 * CGNAT or mobile gateway. This adapter cannot fix that; keep the limit moderate
 * and configurable (see postgres-rate-limiter.mjs limits), watch 429 rates, and
 * treat IPv6 with ipv6GroupBits (e.g. 64) so one household prefix shares a bucket
 * instead of each device getting a fresh one.
 *
 * Fail closed: any missing, malformed, chained, or unexpected value throws
 * UNTRUSTED_IDENTITY and the request is rejected, never guessed.
 */

const REFUSED_CHAIN_HEADERS = new Set(['x-forwarded-for', 'forwarded', 'x-original-forwarded-for']);
const HEADER_NAME = /^[a-z][a-z0-9-]{0,40}$/;

function parseIPv4Strict(text) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (!m) return null;
  const octets = [];
  for (let i = 1; i <= 4; i++) {
    const part = m[i];
    if (part.length > 1 && part[0] === '0') return null; // ambiguous leading zeros
    const n = Number(part);
    if (n > 255) return null;
    octets.push(n);
  }
  return octets;
}

/** Returns 8 16-bit groups or null. Embeds an IPv4 tail per RFC 4291. */
function parseIPv6Groups(text) {
  if (!text || text.length > 45 || text.includes('%') || text.includes('[') || text.includes(']')) return null;
  if (!/^[0-9a-f:.]+$/i.test(text)) return null;
  if (text.split('::').length > 2) return null;
  let head = text;
  if (text.includes('.')) {
    const cut = text.lastIndexOf(':');
    if (cut < 0) return null;
    const octets = parseIPv4Strict(text.slice(cut + 1));
    if (!octets) return null;
    const hi = ((octets[0] << 8) | octets[1]).toString(16);
    const lo = ((octets[2] << 8) | octets[3]).toString(16);
    head = `${text.slice(0, cut + 1)}${hi}:${lo}`;
  }
  const isGroup = g => /^[0-9a-f]{1,4}$/i.test(g);
  const parts = head.split('::');
  const left = parts[0] === '' ? [] : parts[0].split(':');
  const right = parts.length === 2 ? (parts[1] === '' ? [] : parts[1].split(':') ) : [];
  if (parts.length === 2 && left.length + right.length > 7) return null; // '::' must compress ≥1 group
  if (parts.length === 1 && left.length !== 8) return null;
  const all = [...left, ...right];
  if (!all.every(isGroup)) return null;
  const missing = 8 - all.length;
  const groups = [...left, ...Array(parts.length === 2 ? missing : 0).fill('0'), ...right]
    .map(g => parseInt(g, 16));
  return groups.length === 8 ? groups : null;
}

function dottedFromGroups(groups) {
  return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join('.');
}

function canonicalize(value, ipv6GroupBits) {
  const v4 = parseIPv4Strict(value);
  if (v4) return v4.join('.');
  const groups = parseIPv6Groups(value);
  if (!groups) return null;
  // IPv4-mapped (::ffff:a.b.c.d) keys as the IPv4 address itself.
  if (groups.slice(0, 5).every(g => g === 0) && groups[5] === 0xffff) return dottedFromGroups(groups);
  if (ipv6GroupBits > 0) {
    for (let i = 0; i < 8; i++) {
      const keepBits = Math.min(16, Math.max(0, ipv6GroupBits - i * 16));
      const mask = keepBits === 16 ? 0xffff : ((0xffff << (16 - keepBits)) & 0xffff);
      groups[i] &= mask;
    }
  }
  return groups.map(g => g.toString(16).padStart(4, '0')).join(':');
}

export function createClientIdentity({ mode, header, xffTrustedHops, ipv6GroupBits = 0 } = {}) {
  if (mode !== 'platform-header' && mode !== 'xff-trusted-hop') throw new Error('INVALID_CONFIGURATION');
  if (typeof header !== 'string' || !HEADER_NAME.test(header)) throw new Error('INVALID_CONFIGURATION');
  const name = header.toLowerCase();
  if (mode === 'platform-header' && REFUSED_CHAIN_HEADERS.has(name)) throw new Error('INVALID_CONFIGURATION');
  if (!Number.isInteger(ipv6GroupBits) || (ipv6GroupBits !== 0 && (ipv6GroupBits < 32 || ipv6GroupBits > 128))) {
    throw new Error('INVALID_CONFIGURATION');
  }
  if (mode === 'xff-trusted-hop' &&
      (!Number.isInteger(xffTrustedHops) || xffTrustedHops < 1 || xffTrustedHops > 8)) {
    throw new Error('INVALID_CONFIGURATION');
  }
  return {
    async getTrustedIdentity(request) {
      const raw = request?.headers?.get(name);
      if (typeof raw !== 'string') throw new Error('UNTRUSTED_IDENTITY');
      let candidate = raw.trim();
      if (mode === 'xff-trusted-hop') {
        const chain = raw.split(',').map(part => part.trim());
        if (chain.length < xffTrustedHops) throw new Error('UNTRUSTED_IDENTITY');
        candidate = chain[chain.length - xffTrustedHops];
      } else if (candidate.includes(',')) {
        // A platform-overwritten header must be one address, never a chain.
        throw new Error('UNTRUSTED_IDENTITY');
      }
      const identity = canonicalize(candidate, ipv6GroupBits);
      if (!identity || identity.length > 128 || /[\u0000-\u001f\u007f]/.test(identity)) throw new Error('UNTRUSTED_IDENTITY');
      return identity;
    }
  };
}
