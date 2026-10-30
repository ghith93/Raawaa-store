import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createOutboxSchedulerHandler} from './outbox-scheduler-api.mjs';
const secret='a'.repeat(48), other='b'.repeat(48);
function request(token=secret,method='POST',url='https://edge.example/scheduler'){return new Request(url,{method,headers:token?{authorization:`Bearer ${token}`}:{}});}
test('only a holder of the dedicated scheduler secret can process the bounded worker',async()=>{
 let calls=0;const handle=createOutboxSchedulerHandler({secret,runBatch:async()=>{calls++;return {ok:true,chatId:'private',reference:'RAWAA-TEST123'};}});
 assert.equal((await handle(request(null))).status,401);assert.equal((await handle(request(other))).status,401);
 assert.equal((await handle(request(secret,'GET'))).status,405);assert.equal((await handle(request(secret,'POST','https://edge.example/scheduler?anything=1'))).status,400);
 assert.equal((await handle(new Request('https://edge.example/scheduler',{method:'POST',headers:{authorization:`Bearer ${secret}`},body:'x'.repeat(1025)}))).status,413);
 assert.equal(calls,0);const r=await handle(request());assert.equal(r.status,200);assert.deepEqual(await r.json(),{ok:true});assert.match(r.headers.get('cache-control'),/no-store/);assert.equal(calls,1);
});
test('fails closed on configuration errors and never leaks worker errors',async()=>{
 const missing=createOutboxSchedulerHandler({secret:'short',runBatch:async()=>({ok:true})});assert.equal((await missing(request())).status,503);
 const broken=createOutboxSchedulerHandler({secret,runBatch:async()=>{throw Error(secret);}});const r=await broken(request());assert.equal(r.status,503);assert.deepEqual(await r.json(),{error:'unavailable'});
 const unpaired=createOutboxSchedulerHandler({secret,runBatch:async()=>({ok:false,reason:'not_paired'})});assert.equal((await unpaired(request())).status,503);
});
