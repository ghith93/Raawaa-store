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
 assert.equal(calls,0);const r=await handle(request());assert.equal(r.status,200);assert.deepEqual(await r.json(),{ok:true,sent:0,failed:0,unknown:0,recovered:0});assert.match(r.headers.get('cache-control'),/no-store/);assert.equal(calls,1);
});
test('fails closed on configuration errors and never leaks worker errors',async()=>{
 const missing=createOutboxSchedulerHandler({secret:'short',runBatch:async()=>({ok:true})});assert.equal((await missing(request())).status,503);
 const broken=createOutboxSchedulerHandler({secret,runBatch:async()=>{throw Error(secret);}});const r=await broken(request());assert.equal(r.status,503);assert.deepEqual(await r.json(),{error:'unavailable'});
 const unpaired=createOutboxSchedulerHandler({secret,runBatch:async()=>({ok:false,reason:'not_paired'})});assert.equal((await unpaired(request())).status,503);
});

// البند 67: الفشل الصامت. دفعة تعمل لكن كل تسليم فيها فاشل يجب أن تظهر للمُشغّل.
test('delivery failures are visible as counters while identifiers never leave the function',async()=>{
 const leaky={ok:true,sent:1,failed:2,unknown:3,recovered:1,chatId:'private',reference:'RAWAA-TEST123',token:'secret'};
 const handle=createOutboxSchedulerHandler({secret,runBatch:async()=>leaky});
 const r=await handle(request());
 assert.equal(r.status,200);
 const body=await r.json();
 assert.deepEqual(body,{ok:true,sent:1,failed:2,unknown:3,recovered:1});
 const text=JSON.stringify(body);
 for(const secretValue of ['private','RAWAA-TEST123','secret'])assert.ok(!text.includes(secretValue),`leaked ${secretValue}`);
 // كل تسليم فشل: ما زال 200 لأن الدفعة عملت، لكن العدّادات تفضح الفشل.
 const allFailed=createOutboxSchedulerHandler({secret,runBatch:async()=>({ok:true,sent:0,failed:3,unknown:0})});
 assert.deepEqual(await (await allFailed(request())).json(),{ok:true,sent:0,failed:3,unknown:0,recovered:0});
 const ambiguous=createOutboxSchedulerHandler({secret,runBatch:async()=>({ok:true,sent:0,failed:0,unknown:3})});
 assert.deepEqual(await (await ambiguous(request())).json(),{ok:true,sent:0,failed:0,unknown:3,recovered:0});
});

test('malformed or hostile counters coerce to zero and cannot inject fields',async()=>{
 for(const bad of [-1,1.5,'3',null,undefined,NaN,Infinity,{},[],9007199254740992]){
  const handle=createOutboxSchedulerHandler({secret,runBatch:async()=>({ok:true,failed:bad})});
  assert.deepEqual(await (await handle(request())).json(),{ok:true,sent:0,failed:0,unknown:0,recovered:0});
 }
 const nested=createOutboxSchedulerHandler({secret,runBatch:async()=>({ok:true,failed:2,__proto__:{leak:1},constructor:{leak:1}})});
 const body=await (await nested(request())).json();
 assert.deepEqual(body,{ok:true,sent:0,failed:2,unknown:0,recovered:0});
 assert.equal(Object.getPrototypeOf(body),Object.prototype);
});
