import { createPairingHandler } from './telegram-pairing-api.mjs';
import { createTelegramPairing } from './telegram-pairing.mjs';
import { createTelegramPairingRepository } from './telegram-pairing-repository.mjs';

/** Isolated runtime for owner-verified pairing. Does not expose env or Telegram responses. */
export function createEdgePairing({ getEnv, postgresFactory, fetchImpl = fetch }) {
  let url, key, dbUrl, ownerId, allowedOrigin, botToken;
  try {
    url = new URL(getEnv('SUPABASE_URL'));
    dbUrl = getEnv('SUPABASE_DB_URL'); ownerId = getEnv('RAWAA_OWNER_USER_ID');
    allowedOrigin = getEnv('RAWAA_OWNER_ORIGIN'); botToken = getEnv('RAWAA_TELEGRAM_BOT_TOKEN');
    const keys = getEnv('SUPABASE_PUBLISHABLE_KEYS');
    key = keys ? JSON.parse(keys).default : getEnv('SUPABASE_ANON_KEY');
    if (url.protocol !== 'https:' || url.pathname !== '/' || url.username || url.password || url.search || url.hash || !key || !dbUrl || !ownerId || !allowedOrigin || !botToken) throw new Error();
  } catch {
    return () => new Response('{"error":"unavailable"}', {status:503, headers:{'content-type':'application/json','cache-control':'no-store'}});
  }
  let sql;
  const connection = () => sql ||= postgresFactory(dbUrl, {max:1,prepare:false,idle_timeout:20,connect_timeout:5});
  const db = {
    async query(text, params) { return {rows:Array.from(await connection().unsafe(text,params))}; },
    async transaction(callback) {
      return connection().begin(async tx => callback({query:async(text,params)=>({rows:Array.from(await tx.unsafe(text,params))})}));
    }
  };
  const pairing = createTelegramPairing({repository:createTelegramPairingRepository(db), botToken, fetchImpl});
  async function verifyUser(token) {
    const response = await fetchImpl(`${url.origin}/auth/v1/user`, {method:'GET',
      headers:{apikey:key,authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(5000)});
    if (!response.ok) return null;
    const user=await response.json();
    return typeof user?.id === 'string' ? {id:user.id} : null;
  }
  return createPairingHandler({ownerId,allowedOrigin,verifyUser,pairing});
}
