import {createOrderHandler,createTurnstileVerifier} from './order-http.mjs';
import {createPostgresRepository} from './postgres-repository.mjs';
import {createPostgresRateLimiter} from './postgres-rate-limiter.mjs';
import {createMarketingPreferenceService,MARKETING_CONSENT_VERSION} from './marketing-preferences.mjs';
import {createPostgresMarketingPreferenceRepository} from './marketing-preference-repository.mjs';

/**
 * Staged public intake adapter. Do not deploy with a client-provided IP header.
 * Platform-specific identity must be authenticated and canonicalized by the caller.
 * Pending alerts are deliberately left for the durable scheduled worker.
 */
export function createEdgeOrder({getEnv,postgresFactory,getTrustedIdentity,config,fetchImpl=fetch}) {
  let dbUrl,secret,pepper,origin;
  try {
    dbUrl=getEnv('SUPABASE_DB_URL');secret=getEnv('RAWAA_TURNSTILE_SECRET');
    pepper=getEnv('RAWAA_RATE_LIMIT_HMAC_KEY');origin=getEnv('RAWAA_OWNER_ORIGIN');
    const parsed=new URL(origin);
    if(!dbUrl||!secret||typeof pepper!=='string'||pepper.length<32||parsed.protocol!=='https:'||parsed.origin!==origin||
       parsed.username||parsed.password||parsed.search||parsed.hash||typeof postgresFactory!=='function'||
       typeof getTrustedIdentity!=='function'||typeof fetchImpl!=='function'||!config)throw Error();
  } catch {return ()=>new Response('{"error":"unavailable"}',{status:503,headers:{'content-type':'application/json','cache-control':'no-store'}});}
  let sql;
  const connection=()=>sql||=postgresFactory(dbUrl,{max:1,prepare:false,idle_timeout:20,connect_timeout:5});
  const db={
    async query(text,params){return {rows:Array.from(await connection().unsafe(text,params))};},
    async transaction(callback){return connection().begin(async tx=>callback({query:async(text,params)=>({rows:Array.from(await tx.unsafe(text,params))})}));}
  };
  const repository=createPostgresRepository(db);
  const limiter=createPostgresRateLimiter({db,identityKey:pepper,getTrustedIdentity});
  const verifyChallenge=createTurnstileVerifier({secret,hostname:new URL(origin).hostname,fetchImpl});
  let recordMarketingOptIn;
  try {
    const marketingKey=getEnv('RAWAA_MARKETING_HMAC_KEY');
    if (typeof marketingKey==='string' && marketingKey) {
      const preferences=createMarketingPreferenceService({
        repository:createPostgresMarketingPreferenceRepository(db),
        hmacSecret:marketingKey
      });
      recordMarketingOptIn=({phone})=>preferences.recordOptIn({
        phone,explicitConsent:true,consentVersion:MARKETING_CONSENT_VERSION
      });
    }
  } catch { /* order intake remains available; optional marketing consent stays unrecorded */ }
  return createOrderHandler({origin,config,repository,rateLimit:limiter.rateLimit,verifyChallenge,recordMarketingOptIn,
    notificationRunner:{async kick(){/* Saved to durable outbox; scheduler will process. */}}});
}
