import { createOwnerHandler } from './owner-api.mjs';

/** Edge adapter. Secrets and owner identity are injected at runtime; fail closed. */
export function createEdgeOwner({ getEnv, postgresFactory, fetchImpl = fetch }) {
  let url, key, dbUrl, ownerId, allowedOrigin;
  try {
    url = getEnv('SUPABASE_URL'); dbUrl = getEnv('SUPABASE_DB_URL');
    ownerId = getEnv('RAWAA_OWNER_USER_ID'); allowedOrigin = getEnv('RAWAA_OWNER_ORIGIN');
    const keys = getEnv('SUPABASE_PUBLISHABLE_KEYS');
    key = keys ? JSON.parse(keys).default : getEnv('SUPABASE_ANON_KEY');
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.pathname !== '/' || parsed.username || parsed.password || parsed.search || parsed.hash || !key || !dbUrl || !ownerId || !allowedOrigin) throw new Error('missing config');
    url = parsed.origin;
  } catch {
    return () => new Response(JSON.stringify({ error: 'unavailable' }), { status: 503, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  }
  let sql;
  const repository = {
    async listRecent(cursor) {
      if (!sql) sql = postgresFactory(dbUrl, { max: 1, prepare: false, idle_timeout: 20, connect_timeout: 5 });
      const rows = await sql.unsafe(`select o.id as cursor_id,
        to_char(o.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_time,
        o.reference, o.created_at, o.order_status, o.details, q.state as notification_state
        from rawaa_store.orders o left join rawaa_store.notification_outbox q on q.order_id = o.id
        where ($1::timestamptz is null or (o.created_at, o.id) < ($1::timestamptz, $2::uuid))
        order by o.created_at desc, o.id desc limit 51`, [cursor?.time ?? null, cursor?.id ?? null]);
      return Array.from(rows);
    }
  };
  async function verifyUser(token) {
    const response = await fetchImpl(`${url}/auth/v1/user`, {
      method: 'GET', headers: { apikey: key, authorization: `Bearer ${token}` },
      redirect: 'error', signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) return null;
    const user = await response.json();
    return typeof user?.id === 'string' ? { id: user.id } : null;
  }
  return createOwnerHandler({ ownerId, allowedOrigin, verifyUser, repository });
}
