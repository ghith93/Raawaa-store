import { createTestMessageHandler } from './telegram-test-api.mjs';
import { sendTelegramTest } from './telegram-test-message.mjs';
export function createEdgeTelegramTest({getEnv,postgresFactory,fetchImpl=fetch}) {
  let url,key,dbUrl,ownerId,allowedOrigin,token;
  try{
    url=new URL(getEnv('SUPABASE_URL'));dbUrl=getEnv('SUPABASE_DB_URL');ownerId=getEnv('RAWAA_OWNER_USER_ID');allowedOrigin=getEnv('RAWAA_OWNER_ORIGIN');token=getEnv('RAWAA_TELEGRAM_BOT_TOKEN');
    const keys=getEnv('SUPABASE_PUBLISHABLE_KEYS');key=keys?JSON.parse(keys).default:getEnv('SUPABASE_ANON_KEY');
    if(url.protocol!=='https:'||url.pathname!=='/'||url.username||url.password||url.search||url.hash||!key||!dbUrl||!ownerId||!allowedOrigin||!token)throw Error();
  }catch{return ()=>new Response('{"error":"unavailable"}',{status:503,headers:{'content-type':'application/json','cache-control':'no-store'}});}
  let sql;const connection=()=>sql||=postgresFactory(dbUrl,{max:1,prepare:false,idle_timeout:20,connect_timeout:5});
  async function verifyUser(jwt){const r=await fetchImpl(`${url.origin}/auth/v1/user`,{headers:{apikey:key,authorization:`Bearer ${jwt}`},redirect:'error',signal:AbortSignal.timeout(5000)});if(!r.ok)return null;const user=await r.json();return typeof user?.id==='string'?{id:user.id}:null;}
  async function sendTest(){return sendTelegramTest({token,fetchImpl,getRecipient:async()=>{const rows=await connection().unsafe('select chat_id::text as chat_id from rawaa_store.telegram_recipient where singleton=true',[]);return rows.length===1?rows[0].chat_id:null;}});}
  return createTestMessageHandler({ownerId,allowedOrigin,verifyUser,sendTest});
}
