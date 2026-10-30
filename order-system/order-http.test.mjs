import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createOrderHandler, createTurnstileVerifier } from './order-http.mjs';
const sandbox={window:{}}; vm.runInNewContext(await readFile(new URL('../js/config.js',import.meta.url),'utf8'),sandbox);
const config=sandbox.window.RAWAA_CONFIG, origin='https://store.example';
const key='e231547a-1e5e-4c4d-af55-f06686a30341';
const order={ name:'تجربة', phone:'0991234567', address:'حماة', items:[{id:'serum-30',qty:1}],zone:'hama',method:'cod',totalCents:1 };
const payload={order,idempotencyKey:key,challengeToken:'fake-token',consent:true};
const request=(body=payload,extra={})=>new Request('https://edge.example/orders',{method:'POST',headers:{origin,'content-type':'application/json',...extra},body:JSON.stringify(body)});
let calls=[];
const deps={origin,config,repository:{async insertPending({order: saved}) {calls.push('saved'); assert.equal(saved.totalCents,1900); return {result:'created',reference:'RAWAA-TEST123'};}},notificationRunner:{async kick(){calls.push('notify');}},verifyChallenge:async()=>{calls.push('challenge');return true;},rateLimit:async()=>{calls.push('limit');return true;}};
test('only saves consented, challenge-validated order and never trusts the client total',async()=>{
  calls=[]; const response=await createOrderHandler(deps)(request());
  assert.equal(response.status,200); assert.match(response.headers.get('cache-control'),/no-store/);
  assert.deepEqual(await response.json(),{reference:'RAWAA-TEST123',status:'pending_review'});
  assert.deepEqual(calls,['limit','challenge','saved','notify']);
});
test('fails closed without production controls or when origin and input are invalid',async()=>{
  calls=[]; assert.equal((await createOrderHandler({...deps,rateLimit:null})(request())).status,503);
  assert.equal((await createOrderHandler(deps)(request(payload,{origin:'https://evil.example'}))).status,403);
  assert.equal((await createOrderHandler(deps)(request({...payload,consent:false}))).status,400);
  assert.equal((await createOrderHandler(deps)(request({...payload,idempotencyKey:'bad'}))).status,400);
  assert.equal((await createOrderHandler(deps)(request(payload,{'content-type':'text/plain'}))).status,415);
  assert.equal((await createOrderHandler(deps)(request({...payload,challengeToken:'x'.repeat(2049)}))).status,400);
  assert.deepEqual(calls,[]);
});
test('rejects size limit even when content length is omitted or incorrect',async()=>{
  const handle=createOrderHandler(deps);
  assert.equal((await handle(request({...payload, extra:'x'.repeat(5000)}))).status,413);
  assert.equal((await handle(request(payload,{'content-length':'9000'}))).status,413);
});
test('rate limiting and captcha failures never reach storage',async()=>{
  calls=[];
  assert.equal((await createOrderHandler({...deps,rateLimit:async()=>false})(request())).status,429);
  assert.equal((await createOrderHandler({...deps,rateLimit:async()=>{throw new Error('private');}})(request())).status,503);
  assert.equal((await createOrderHandler({...deps,verifyChallenge:async()=>false})(request())).status,403);
  assert.ok(!calls.includes('saved'));
});
test('database failure is uncertain, never falsely says order was not saved',async()=>{
  const handle=createOrderHandler({...deps,repository:{async insertPending(){throw new Error('private');}}});
  const res=await handle(request()); assert.equal(res.status,503); assert.deepEqual(await res.json(),{error:'save_uncertain'});
});
test('Turnstile is checked server-side against expected host and action',async()=>{
  for (const result of [{success:true,hostname:'store.example',action:'rawaa_order'},{success:true,hostname:'evil.example',action:'rawaa_order'},{success:true,hostname:'store.example',action:'other'},{success:false,'error-codes':['timeout-or-duplicate']}]) {
    const verifier=createTurnstileVerifier({secret:'fake-secret',hostname:'store.example',fetchImpl:async (url,init)=>{
      assert.equal(url,'https://challenges.cloudflare.com/turnstile/v0/siteverify'); assert.equal(JSON.parse(init.body).response,'fake-token');
      return {ok:true,json:async()=>result};}});
    assert.equal(await verifier('fake-token'),result.success===true&&result.hostname==='store.example'&&result.action==='rawaa_order');
  }
  await assert.rejects(createTurnstileVerifier({secret:'',hostname:'store.example'})('fake-token'),/CHALLENGE_UNAVAILABLE/);
  await assert.rejects(createTurnstileVerifier({secret:'fake',hostname:'store.example',fetchImpl:async()=>{throw new Error('fake');}})('fake-token'),/CHALLENGE_UNAVAILABLE/);
});


test('Turnstile outages and invalid secrets are unavailable, not customer rejection',async()=>{
  const responses=[
    {ok:false,status:500},
    {ok:true,json:async()=>({success:false,'error-codes':['invalid-input-secret']})},
    {ok:true,json:async()=>({success:false,'error-codes':['internal-error']})},
    {ok:true,json:async()=>({success:false,'error-codes':['timeout-or-duplicate','internal-error']})},
    {ok:true,json:async()=>({success:false})},
    {ok:true,json:async()=>null},
    {ok:true,json:async()=>{throw Error('private provider response');}},
  ];
  for(const response of responses){
    calls=[];
    const verifier=createTurnstileVerifier({secret:'synthetic-secret',hostname:'store.example',fetchImpl:async()=>response});
    const result=await createOrderHandler({...deps,verifyChallenge:verifier})(request());
    assert.equal(result.status,503);assert.deepEqual(await result.json(),{error:'unavailable'});
    assert.ok(!calls.includes('saved'));
  }
  for(const code of ['missing-input-response','invalid-input-response','timeout-or-duplicate']){
    const verifier=createTurnstileVerifier({secret:'fake',hostname:'store.example',fetchImpl:async()=>({ok:true,json:async()=>({success:false,'error-codes':[code]})})});
    assert.equal((await createOrderHandler({...deps,verifyChallenge:verifier})(request())).status,403);
  }
});

test('intent mismatch returns no reference or details and never triggers an alert',async()=>{
  calls=[];
  const handle=createOrderHandler({...deps,repository:{async insertPending(){return {result:'conflict'};}}});
  const response=await handle(request());
  assert.equal(response.status,409);assert.deepEqual(await response.json(),{error:'intent_mismatch'});
  assert.ok(!calls.includes('notify'));assert.match(response.headers.get('cache-control'),/no-store/);
});
