import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCustomerOrderClient} from './customer-order-client.mjs';
import {createTurnstileController} from './turnstile-controller.mjs';
import {createCheckoutFlow} from './customer-checkout-flow.mjs';
function fixture(){
 let value=null,options,resets=0,sends=0,fail=true;const storage={getItem:()=>value,setItem:(_k,v)=>{value=v;},removeItem:()=>{value=null;}};
 const client=createCustomerOrderClient({endpoint:'https://store.example/api/orders',allowedOrigin:'https://store.example',storage,makeId:()=> '11111111-1111-4111-8111-111111111111',fetchImpl:async()=>{sends++;if(fail){fail=false;throw Error('lost');}return {status:200,json:async()=>({reference:'RAWAA-TEST123',status:'pending_review'})};}});
 const challenge=createTurnstileController({container:{},sitekey:'0x4AAAAAAFr3EbyzAicxJebq',turnstile:{render(_el,o){options=o;return 'id';},reset(){resets++;},remove(){}}});
 return {flow:createCheckoutFlow({client,challenge}),challenge:token=>options.callback(token),expire:()=>options['expired-callback'](),resets:()=>resets,sends:()=>sends,stored:()=>value};
}
test('requires consent and challenge; a lost response retries safely with a new challenge',async()=>{
 const f=fixture();f.flow.begin({name:'Synthetic'});
 assert.deepEqual(await f.flow.submit(false),{status:'consent_required'});assert.deepEqual(await f.flow.submit(true),{status:'challenge_required'});assert.equal(f.sends(),0);
 f.challenge('first');assert.deepEqual(await f.flow.submit(true),{status:'uncertain'});assert.equal(f.resets(),1);assert.throws(()=>f.flow.reset(),/SAVE_UNCERTAIN/);
 assert.deepEqual(await f.flow.submit(true),{status:'challenge_required'});f.challenge('second');assert.deepEqual(await f.flow.submit(true),{status:'saved',reference:'RAWAA-TEST123'});assert.equal(f.resets(),2);assert.equal(f.sends(),2);assert.ok(!f.stored().includes('Synthetic'));
});
test('an expired challenge does not issue a request',async()=>{
 const f=fixture();f.flow.begin({name:'Synthetic'});f.challenge('expired');f.expire();assert.equal((await f.flow.submit(true)).status,'challenge_required');assert.equal(f.sends(),0);
});
test('challenge reset happens when client refuses storage before sending',async()=>{
 let resets=0;const f=createCheckoutFlow({client:{begin(){},submit:async()=>{throw Error('storage');},reset(){},state(){return 'ready';}},challenge:{take:()=> 'token',reset:()=>{resets++;}}});
 f.begin({});await assert.rejects(f.submit(true),/storage/);assert.equal(resets,1);
});

test('a broken widget reset cannot mask a confirmed save',async()=>{
 const flow=createCheckoutFlow({client:{begin(){},submit:async()=>({status:'saved',reference:'RAWAA-TEST123'}),reset(){},state(){return 'complete';}},challenge:{take:()=> 'token',reset:()=>{throw Error('widget failed');}}});
 flow.begin({});assert.deepEqual(await flow.submit(true),{status:'saved',reference:'RAWAA-TEST123'});
});
