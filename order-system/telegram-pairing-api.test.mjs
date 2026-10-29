import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPairingHandler } from './telegram-pairing-api.mjs';
const ownerId='11111111-1111-4111-8111-111111111111', origin='https://store.example';
const start={ok:true,id:'22222222-2222-4222-8222-222222222222',message:'/pair '+'a'.repeat(32),expiresAt:123};
let calls;
function setup() {calls=[];return createPairingHandler({ownerId,allowedOrigin:origin,verifyUser:async token=>token==='owner'?{id:ownerId}:{id:'33333333-3333-4333-8333-333333333333'},pairing:{async start(){calls.push('start');return start;},async finish(value){calls.push(value);return {ok:true, chatId:'private'};}}});}
function req(body, headers={}, method='POST'){return new Request('https://edge.example/pair',{method,headers:{origin,authorization:'Bearer owner','content-type':'application/json',...headers},...(method==='POST'?{body:typeof body==='string'?body:JSON.stringify(body)}:{})});}
test('only authenticated owner can start or finish, responses are not cached or overexposed',async()=>{
 const h=setup(); let r=await h(req({action:'start'}));assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/no-store/);assert.deepEqual(await r.json(),start);
 r=await h(req({action:'finish'}));assert.deepEqual(await r.json(),{ok:true});assert.equal(calls.length,2);
 assert.equal((await h(req({action:'start'},{authorization:'Bearer other'}))).status,403);
 assert.equal((await h(req({action:'start'},{authorization:''}))).status,401);
 assert.equal((await h(req({action:'start'},{origin:'https://evil.example'}))).status,403);
 assert.equal((await h(req({action:'start'},{origin:''}))).status,403);
 assert.equal(calls.length,2);
});
test('rejects malformed payloads, oversized bodies, methods and origins',async()=>{
 const h=setup();assert.equal((await h(req({action:'start',extra:1}))).status,400);
 assert.equal((await h(req('x'.repeat(1025)))).status,400);
 assert.equal((await h(req('{}',{'content-type':'text/plain'}))).status,415);
 assert.equal((await h(req(null,{},'GET'))).status,405);
 const preflight=await h(req(null,{},'OPTIONS'));assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),origin);
 assert.equal((await h(req(null,{origin:'https://evil.example'},'OPTIONS'))).status,403);assert.equal(calls.length,0);
});
test('never discloses errors or provider data',async()=>{
 const h=createPairingHandler({ownerId,allowedOrigin:origin,verifyUser:async()=>({id:ownerId}),pairing:{start:async()=>{throw Error('sensitive');},finish:async()=>({ok:false,error:'sensitive'})}});
 const r=await h(req({action:'start'}));assert.equal(r.status,503);assert.deepEqual(await r.json(),{error:'unavailable'});
 const r2=await h(req({action:'finish'}));assert.deepEqual(await r2.json(),{error:'unavailable'});
});
