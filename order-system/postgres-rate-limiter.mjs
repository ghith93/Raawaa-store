/**
 * Fixed window, atomic across replicas. Call only with an identity attested by a
 * trusted edge/platform, never a client-supplied forwarding header. A retained
 * HMAC key prevents offline enumeration of raw IP addresses from the database.
 * A scheduler must invoke bounded cleanup repeatedly; rateLimit does not prune unrelated rows.
 */
export function createPostgresRateLimiter({ db, identityKey, getTrustedIdentity, limits }) {
  if (typeof db?.query !== 'function' || typeof identityKey !== 'string' || identityKey.length < 32 ||
      typeof getTrustedIdentity !== 'function') throw new Error('INVALID_CONFIGURATION');
  // Defaults preserve the 10-attempt/15-minute prototype. Both are tunable before
  // launch for shared networks (CGNAT); the SQL check constraint allows up to 100.
  const attemptsMax = limits?.attemptsMax ?? 10;
  const windowMinutes = limits?.windowMinutes ?? 15;
  if (!Number.isInteger(attemptsMax) || attemptsMax < 1 || attemptsMax > 100 ||
      !Number.isInteger(windowMinutes) || windowMinutes < 1 || windowMinutes > 1440) throw new Error('INVALID_CONFIGURATION');
  const secret = new TextEncoder().encode(identityKey);
  const keyPromise = crypto.subtle.importKey('raw', secret, {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
  async function rateLimit(request) {
    const identity = await getTrustedIdentity(request);
    // Identity authenticity and canonicalisation are the deployment adapter's responsibility.
    if (typeof identity !== 'string' || !identity || identity.length > 128 || /[\u0000-\u001f\u007f]/.test(identity)) throw new Error('UNTRUSTED_IDENTITY');
    const mac = await crypto.subtle.sign('HMAC', await keyPromise, new TextEncoder().encode(`rawaa-order-v1:${identity}`));
    const hash = Array.from(new Uint8Array(mac), x => x.toString(16).padStart(2,'0')).join('');
    // The conditional upsert bounds attempts under concurrent requests. DB time is authoritative.
    const result = await db.query(`insert into rawaa_store.order_rate_limit (identity_key, attempts, window_end)
      values ($1, 1, now() + make_interval(mins => $3::int))
      on conflict (identity_key) do update set
        attempts = case when rawaa_store.order_rate_limit.window_end <= now() then 1 else rawaa_store.order_rate_limit.attempts + 1 end,
        window_end = case when rawaa_store.order_rate_limit.window_end <= now() then now() + make_interval(mins => $3::int) else rawaa_store.order_rate_limit.window_end end
      where rawaa_store.order_rate_limit.window_end <= now() or rawaa_store.order_rate_limit.attempts < $2
      returning attempts`, [hash, attemptsMax, windowMinutes]);
    return result.rows.length === 1;
  }
  async function cleanup() {
    const result=await db.query("delete from rawaa_store.order_rate_limit where identity_key in (select identity_key from rawaa_store.order_rate_limit where window_end < now() - interval '24 hours' order by window_end limit 500) returning 1", []);
    return {count:result.rows.length};
  }
  return {rateLimit, cleanup};
}
