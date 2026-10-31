import { createMarketingPreferenceHandler } from './marketing-preference-api.mjs';
import { createMarketingPreferenceService } from './marketing-preferences.mjs';
import { createPostgresMarketingPreferenceRepository } from './marketing-preference-repository.mjs';

/** Owner-only withdrawal endpoint. Requires migration 005 and an independent HMAC key. */
export function createEdgeMarketingPreferences({ getEnv, postgresFactory, fetchImpl = fetch, cryptoImpl = globalThis.crypto }) {
  let supabaseUrl, publishableKey, dbUrl, ownerId, allowedOrigin, hmacSecret;
  try {
    supabaseUrl = getEnv('SUPABASE_URL');
    dbUrl = getEnv('SUPABASE_DB_URL');
    ownerId = getEnv('RAWAA_OWNER_USER_ID');
    allowedOrigin = getEnv('RAWAA_OWNER_ORIGIN');
    hmacSecret = getEnv('RAWAA_MARKETING_HMAC_KEY');
    const keys = getEnv('SUPABASE_PUBLISHABLE_KEYS');
    publishableKey = keys ? JSON.parse(keys).default : getEnv('SUPABASE_ANON_KEY');
    const parsed = new URL(supabaseUrl);
    if (parsed.protocol !== 'https:' || parsed.pathname !== '/' || parsed.username || parsed.password || parsed.search || parsed.hash ||
        !publishableKey || !dbUrl || !ownerId || !allowedOrigin || !hmacSecret || typeof postgresFactory !== 'function' ||
        typeof fetchImpl !== 'function') throw new Error('INVALID_CONFIGURATION');
    supabaseUrl = parsed.origin;
  } catch {
    return () => new Response('{"error":"unavailable"}', {
      status: 503,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store, private' }
    });
  }

  let sql;
  const connection = () => sql ||= postgresFactory(dbUrl, {
    max: 1,
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 5
  });
  const repository = createPostgresMarketingPreferenceRepository({
    async query(text, values) {
      const rows = await connection().unsafe(text, values);
      return { rows: Array.from(rows) };
    }
  });
  let service;
  try {
    service = createMarketingPreferenceService({ repository, hmacSecret, cryptoImpl });
  } catch {
    return () => new Response('{"error":"unavailable"}', {
      status: 503,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store, private' }
    });
  }

  async function verifyUser(token) {
    const response = await fetchImpl(`${supabaseUrl}/auth/v1/user`, {
      method: 'GET',
      headers: { apikey: publishableKey, authorization: `Bearer ${token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) return null;
    const user = await response.json();
    return typeof user?.id === 'string' ? { id: user.id } : null;
  }

  return createMarketingPreferenceHandler({ ownerId, allowedOrigin, verifyUser, service });
}
