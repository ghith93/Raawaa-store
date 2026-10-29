import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestMessageHandler} from './telegram-test-api.mjs';
const ownerId='11111111-1111-4111-8111-111111111111', allowedOrigin='https://store.example';
const req=(headers={},method='POST',body)=>new Request('https://example.test/test',{method,headers:{origin:allowedOrigin,authorization:'Bearer valid',...headers},...(body!==undefined?{body}:{})});
test('only the verified owner can send the fixed test, without leaking provider details',async()=>{
 let sent=0;const handle=createTestMessageHandler({ownerId,allowedOrigin,verifyUser:async token=>token==='valid'?{id:ownerId}:null,sendTest:async()=>{sent++;return {ok:true,chatId:'secret'};}});
 assert.equal((await handle(req({origin:'https://evil.example'}))).status,403);
 assert.equal((await handle(req({authorization:'Bearer no'}))).status,403);
 assert.equal((await handle(req({authorization:''}))).status,401);
 assert.equal((await handle(req({},'POST','arbitrary text'))).status,400);
 assert.equal((await handle(req({},'GET'))).status,405);
 assert.equal(sent,0);const r=await handle(req());assert.equal(r.status,200);assert.deepEqual(await r.json(),{ok:true});assert.match(r.headers.get('cache-control'),/no-store/);assert.equal(sent,1);
});
test('an ambiguous delivery is not reported as success',async()=>{
 const h=createTestMessageHandler({ownerId,allowedOrigin,verifyUser:async()=>({id:ownerId}),sendTest:async()=>({ok:false,reason:'unknown',token:'private'})});const r=await h(req());assert.equal(r.status,503);assert.deepEqual(await r.json(),{error:'unknown'});
});
