import {createOutboxBatch} from './outbox-batch.mjs';
import {createOutboxSchedulerHandler} from './outbox-scheduler-api.mjs';

/** Local staging only. Deployment requires isolated secret storage and scheduled invocation. */
export function createEdgeOutbox({getEnv,postgresFactory,fetchImpl=fetch}) {
  let dbUrl,telegramToken,schedulerSecret;
  try {
    dbUrl=getEnv('SUPABASE_DB_URL');telegramToken=getEnv('RAWAA_TELEGRAM_BOT_TOKEN');
    schedulerSecret=getEnv('RAWAA_OUTBOX_SCHEDULER_SECRET');
    if(!dbUrl || typeof postgresFactory!=='function' || typeof fetchImpl!=='function')throw Error();
  } catch {return ()=>new Response('{"error":"unavailable"}',{status:503,headers:{'content-type':'application/json','cache-control':'no-store'}});}
  let sql;const connection=()=>sql||=postgresFactory(dbUrl,{max:1,prepare:false,idle_timeout:20,connect_timeout:5});
  const db={async query(text,params){return {rows:Array.from(await connection().unsafe(text,params))};}};
  let batch;
  try {batch=createOutboxBatch({db,token:telegramToken,fetchImpl});} catch {return ()=>new Response('{"error":"unavailable"}',{status:503,headers:{'content-type':'application/json','cache-control':'no-store'}});}
  return createOutboxSchedulerHandler({secret:schedulerSecret,runBatch:batch.run});
}
