import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import vm from 'node:vm';
import {createCustomerOrderClient} from './customer-order-client.mjs';
import {createEdgeOrder} from './edge-order-runtime.mjs';
import {createEdgeOutbox} from './edge-outbox-runtime.mjs';
import {createEdgeOwner} from './edge-owner-runtime.mjs';
if(!process.env.PGLITE_MODULE)throw Error('Set PGLITE_MODULE');
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE));const db=new PGlite();
await db.exec('create role anon;create role authenticated;create role service_role bypassrls;');
for(const file of ['001_private_orders.sql','002_telegram_pairing.sql','003_order_rate_limit.sql'])await db.exec(await readFile(new URL(`./migrations/${file}`,import.meta.url),'utf8'));
await db.query('insert into rawaa_store.telegram_recipient(chat_id) values ($1)',[12345]);
const sandbox={window:{}};vm.runInNewContext(await readFile(new URL('../js/config.js',import.meta.url),'utf8'),sandbox);
const ownerId='11111111-1111-4111-8111-111111111111', origin='https://store.example', schedulerSecret='s'.repeat(48);
const settings={SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEYS:'{"default":"test-public"}',SUPABASE_DB_URL:'postgres://dummy',RAWAA_TURNSTILE_SECRET:'fake-secret',RAWAA_RATE_LIMIT_HMAC_KEY:'r'.repeat(48),RAWAA_OUTBOX_SCHEDULER_SECRET:schedulerSecret,RAWAA_TELEGRAM_BOT_TOKEN:'12345:'+'t'.repeat(25),RAWAA_OWNER_ORIGIN:origin,RAWAA_OWNER_USER_ID:ownerId};
const sql={unsafe:async(text,args)=>(await db.query(text,args)).rows,begin:async cb=>db.transaction(async tx=>cb({unsafe:async(text,args)=>(await tx.query(text,args)).rows}))};
const usedTokens=new Set(),alerts=[];
const fetchImpl=async(url,init)=>{
 if(url==='https://challenges.cloudflare.com/turnstile/v0/siteverify'){
  const payload=JSON.parse(init.body);const fresh=!usedTokens.has(payload.response);usedTokens.add(payload.response);
  return {ok:true,json:async()=>({success:fresh,hostname:'store.example',action:'rawaa_order',...(fresh ? {} : {'error-codes':['timeout-or-duplicate']})})};
 }
 if(url.startsWith('https://api.telegram.org/')){const body=JSON.parse(init.body);alerts.push(body);return {ok:true,json:async()=>({ok:true,result:{message_id:17,chat:{id:12345}}})};}
 if(url==='https://example.supabase.co/auth/v1/user')return {ok:init.headers.authorization==='Bearer owner',json:async()=>({id:ownerId})};
 throw Error('Unexpected mocked endpoint');
};
const orderHandler=createEdgeOrder({getEnv:key=>settings[key],postgresFactory:()=>sql,getTrustedIdentity:async()=> 'fake-client-ip',config:sandbox.window.RAWAA_CONFIG,fetchImpl});
let lost=true,storageValue=null;
const storage={getItem:()=>storageValue,setItem:(_key,value)=>{storageValue=value;},removeItem:()=>{storageValue=null;}};
const client=()=>createCustomerOrderClient({endpoint:'https://store.example/api/orders',allowedOrigin:origin,storage,fetchImpl:async(url,init)=>{
 const result=await orderHandler(new Request(url,{...init,headers:{...init.headers,origin}}));
 if(lost){lost=false;throw Error('simulated lost confirmation');}return result;
}});
const data={name:'Synthetic',phone:'0990000000',address:'Synthetic address',items:[{id:'serum-50',qty:1}],zone:'hama',method:'cod'};
const first=client();first.begin(data);assert.deepEqual(await first.submit({consent:true,challengeToken:'fresh-1'}),{status:'uncertain'});
assert.equal((await db.query('select count(*)::int as n from rawaa_store.orders')).rows[0].n,1);
assert.equal(alerts.length,0);
const afterReload=client();assert.equal(afterReload.state(),'uncertain');afterReload.begin({...data,address:'different synthetic address'});
// An already-consumed challenge rejects this retry; it does not undo the first save.
assert.deepEqual(await afterReload.submit({consent:true,challengeToken:'fresh-1'}),{status:'uncertain'});
assert.equal(afterReload.state(),'uncertain');assert.throws(()=>afterReload.reset(),/SAVE_UNCERTAIN/);
assert.deepEqual(await afterReload.submit({consent:true,challengeToken:'fresh-2'}),{status:'intent_mismatch'});
assert.equal(afterReload.state(),'uncertain');assert.throws(()=>afterReload.reset(),/SAVE_UNCERTAIN/);
afterReload.revise(data);
const saved=await afterReload.submit({consent:true,challengeToken:'fresh-3'});assert.equal(saved.status,'saved');assert.match(saved.reference,/^RAWAA-/);
assert.equal((await db.query('select count(*)::int as n from rawaa_store.orders')).rows[0].n,1);
assert.equal((await db.query('select count(*)::int as n from rawaa_store.notification_outbox')).rows[0].n,1);
const worker=createEdgeOutbox({getEnv:key=>settings[key],postgresFactory:()=>sql,fetchImpl});
const jobRequest=secret=>new Request('https://edge.example/worker',{method:'POST',headers:{authorization:`Bearer ${secret}`}});
assert.equal((await worker(jobRequest('wrong'.repeat(10)))).status,401);assert.equal(alerts.length,0);
assert.equal((await worker(jobRequest(schedulerSecret))).status,200);assert.equal(alerts.length,1);
assert.equal(alerts[0].chat_id,'12345');assert.ok(alerts[0].text.includes(saved.reference));
assert.ok(!alerts[0].text.includes('0990000000'));assert.ok(!alerts[0].text.includes('Synthetic'));
assert.equal((await worker(jobRequest(schedulerSecret))).status,200);assert.equal(alerts.length,1);
const owner=createEdgeOwner({getEnv:key=>settings[key],postgresFactory:()=>sql,fetchImpl});
const noAuth=await owner(new Request('https://edge.example/owner',{headers:{origin}}));assert.equal(noAuth.status,401);
const ownerRes=await owner(new Request('https://edge.example/owner',{headers:{origin,authorization:'Bearer owner'}}));
assert.equal(ownerRes.status,200);const ownerData=await ownerRes.json();assert.equal(ownerData.orders.length,1);assert.equal(ownerData.orders[0].reference,saved.reference);assert.equal(ownerData.orders[0].notification,'sent');assert.equal(ownerData.orders[0].totalCents,2240);
assert.ok(!storageValue.includes('0990000000'));assert.ok(!storageValue.includes('Synthetic'));
await db.close();console.log('End-to-end staged: lost confirmation, safe retry, queued alert, private owner view and mock Telegram passed.');
