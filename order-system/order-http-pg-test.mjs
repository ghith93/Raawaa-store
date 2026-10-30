import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import { createOrderHandler } from './order-http.mjs';
import { createPostgresRepository } from './postgres-repository.mjs';
import { createPostgresRateLimiter } from './postgres-rate-limiter.mjs';
import { createCustomerOrderClient } from './customer-order-client.mjs';
if (!process.env.PGLITE_MODULE) throw new Error('Set PGLITE_MODULE');
const { PGlite }=await import(pathToFileURL(process.env.PGLITE_MODULE));
const db=new PGlite();
await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
for (const file of ['001_private_orders.sql','003_order_rate_limit.sql']) await db.exec(await readFile(new URL(`./migrations/${file}`,import.meta.url),'utf8'));
const sandbox={window:{}};vm.runInNewContext(await readFile(new URL('../js/config.js',import.meta.url),'utf8'),sandbox);
const real=createPostgresRepository(db); let first=true, notifications=0;
const repository={async insertPending(args){const result=await real.insertPending(args); if(first){first=false; throw new Error('simulated lost acknowledgement');} return result;}};
const origin='https://store.example';
// Synthetic trusted edge identity; never read an unverified forwarding header.
const limiter=createPostgresRateLimiter({db,identityKey:'test-key-'.repeat(5),getTrustedIdentity:async()=> 'synthetic-client'});
const handler=createOrderHandler({origin,config:sandbox.window.RAWAA_CONFIG,repository,
 notificationRunner:{async kick(){notifications++;}},rateLimit:limiter.rateLimit,verifyChallenge:async()=>true});
const payload={consent:true,challengeToken:'fake-token-1',idempotencyKey:'e231547a-1e5e-4c4d-af55-f06686a30341',order:{name:'تجربة',phone:'0991234567',address:'حماة',items:[{id:'serum-50',qty:1}],method:'cod',zone:'hama',totalCents:1}};
const req=body=>new Request('https://edge.example/orders',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
const firstRes=await handler(req(payload));assert.equal(firstRes.status,503);assert.equal((await firstRes.json()).error,'save_uncertain');
const retry=await handler(req({...payload,challengeToken:'fresh-fake-token'}));assert.equal(retry.status,200);
const result=await retry.json();assert.match(result.reference,/^RAWAA-/);assert.equal(result.status,'pending_review');
assert.equal((await db.query('select count(*)::int as n from rawaa_store.orders')).rows[0].n,1);
assert.equal((await db.query("select count(*)::int as n from rawaa_store.notification_outbox where state='pending'")).rows[0].n,1);
assert.equal(notifications,0); // scheduler is required to recover the persisted pending job
const changed=await handler(req({...payload,challengeToken:'another-fake-token',order:{...payload.order,address:'مكان مختلف'}}));assert.equal(changed.status,503);
for (let i=0;i<7;i++) assert.equal((await handler(req({...payload,challengeToken:'fresh'}))).status,200);
assert.equal((await handler(req({...payload,challengeToken:'fresh'}))).status,429);
assert.equal((await db.query('select count(*)::int as n from rawaa_store.orders')).rows[0].n,1);
// A lost response followed by a full page reload preserves only the opaque key.
let stored=null, loseResponse=true;const storage={getItem:()=>stored,setItem:(_k,v)=>{stored=v;},removeItem:()=>{stored=null;}};
const freshLimiter=createPostgresRateLimiter({db,identityKey:'test-key-'.repeat(5),getTrustedIdentity:async()=> 'second-client'});
const liveHandler=createOrderHandler({origin,config:sandbox.window.RAWAA_CONFIG,repository:real,notificationRunner:{kick:async()=>{}},rateLimit:freshLimiter.rateLimit,verifyChallenge:async()=>true});
const fakeFetch=async(url,init)=>{const result=await liveHandler(new Request(url,{...init,headers:{...init.headers,origin}}));if(loseResponse){loseResponse=false;throw Error('response lost');}return result;};
const newClient=()=>createCustomerOrderClient({endpoint:'https://store.example/api/orders',allowedOrigin:origin,storage,fetchImpl:fakeFetch});
const client1=newClient();client1.begin(payload.order);assert.equal((await client1.submit({challengeToken:'first',consent:true})).status,'uncertain');
assert.ok(!stored.includes(payload.order.phone));
const client2=newClient();assert.equal(client2.state(),'uncertain');client2.begin(payload.order);assert.equal((await client2.submit({challengeToken:'new-token',consent:true})).status,'saved');
assert.equal((await db.query('select count(*)::int as n from rawaa_store.orders')).rows[0].n,2);
assert.equal((await db.query('select count(*)::int as n from rawaa_store.notification_outbox')).rows[0].n,2);
await db.close(); console.log('HTTP + ephemeral PostgreSQL: uncertain commit, safe retry and durable outbox passed.');
