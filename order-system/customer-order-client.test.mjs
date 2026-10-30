import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCustomerOrderClient} from './customer-order-client.mjs';
const memoryStorage=()=>{let value=null;return {getItem:()=>value,setItem:(_k,v)=>{value=v;},removeItem:()=>{value=null;}};};
const base={storage:memoryStorage(),endpoint:'https://store.example/api/orders',allowedOrigin:'https://store.example',makeId:()=> '11111111-1111-4111-8111-111111111111'};
test('ambiguous acknowledgement keeps same key and locked snapshot with a fresh challenge',async()=>{
  const calls=[];let fail=true;
  const client=createCustomerOrderClient({...base,storage:memoryStorage(),fetchImpl:async(_url,init)=>{calls.push(init);if(fail){fail=false;throw Error('network');}return {status:200,json:async()=>({reference:'RAWAA-TEST123',status:'pending_review'})};}});
  const input={name:'synthetic',items:[{id:'serum-30',qty:1}]};client.begin(input);input.items[0].qty=9;
  assert.deepEqual(await client.submit({challengeToken:'first',consent:true}),{status:'uncertain'});
  assert.equal(client.state(),'uncertain');assert.throws(()=>client.reset(),/SAVE_UNCERTAIN/);assert.throws(()=>client.begin(input),/INTENT_IN_PROGRESS/);
  await assert.rejects(client.submit({challengeToken:'first',consent:true}),/INVALID_CHALLENGE/);
  assert.deepEqual(await client.submit({challengeToken:'fresh',consent:true}),{status:'saved',reference:'RAWAA-TEST123'});
  const a=JSON.parse(calls[0].body),b=JSON.parse(calls[1].body);assert.equal(a.idempotencyKey,b.idempotencyKey);assert.equal(b.order.items[0].qty,1);assert.equal(calls[1].credentials,'omit');assert.equal(calls[1].cache,'no-store');
  client.reset();assert.equal(client.state(),'idle');
});
test('malformed success is uncertain; rejection is not saved and consent is mandatory',async()=>{
  let status=400;const client=createCustomerOrderClient({...base,storage:memoryStorage(),fetchImpl:async()=>({status,json:async()=>({})})});client.begin({name:'test'});
  await assert.rejects(client.submit({challengeToken:'x',consent:false}),/INVALID_CHALLENGE/);
  assert.deepEqual(await client.submit({challengeToken:'x',consent:true}),{status:'rejected',reason:'check_details'});assert.equal(client.state(),'ready');
  status=200;assert.deepEqual(await client.submit({challengeToken:'y',consent:true}),{status:'uncertain'});assert.throws(()=>client.reset(),/SAVE_UNCERTAIN/);
});
test('cannot run parallel submissions or leak to foreign origins',async()=>{
  assert.throws(()=>createCustomerOrderClient({...base,storage:memoryStorage(),endpoint:'https://evil.example/api'}),/INVALID_CONFIGURATION/);
  let release;const client=createCustomerOrderClient({...base,storage:memoryStorage(),fetchImpl:()=>new Promise(r=>{release=r;})});client.begin({name:'test'});
  const pending=client.submit({challengeToken:'a',consent:true});await assert.rejects(client.submit({challengeToken:'b',consent:true}),/IN_FLIGHT/);assert.throws(()=>client.reset(),/IN_FLIGHT/);
  release({status:200,json:async()=>({reference:'RAWAA-TEST123',status:'pending_review'})});assert.equal((await pending).status,'saved');
});

test('reload preserves only an opaque key; restored retry cannot create a second key',async()=>{
  const storage=memoryStorage(),calls=[];let first=true;
  const factory=()=>createCustomerOrderClient({...base,storage,fetchImpl:async(_url,init)=>{calls.push(JSON.parse(init.body));if(first){first=false;throw Error('lost');}return {status:200,json:async()=>({reference:'RAWAA-TEST123',status:'pending_review'})};}});
  const a=factory();a.begin({name:'private synthetic',phone:'0990000000'});assert.equal((await a.submit({challengeToken:'one',consent:true})).status,'uncertain');
  assert.ok(!storage.getItem().includes('private'));assert.ok(!storage.getItem().includes('0990000000'));
  const b=factory();assert.equal(b.state(),'uncertain');assert.throws(()=>b.reset(),/SAVE_UNCERTAIN/);b.begin({name:'private synthetic',phone:'0990000000'});
  assert.equal((await b.submit({challengeToken:'two',consent:true})).status,'saved');assert.equal(calls[0].idempotencyKey,calls[1].idempotencyKey);
  const c=factory();assert.equal(c.state(),'complete');assert.equal(c.restoredReference(),'RAWAA-TEST123');c.reset();assert.equal(c.state(),'idle');
});
test('storage failure prevents submission; corrupted storage fails closed',async()=>{
 let sent=false;const storage={getItem:()=>null,setItem:()=>{throw Error('disabled');},removeItem:()=>{}};
 const c=createCustomerOrderClient({...base,storage,fetchImpl:async()=>{sent=true;}});c.begin({name:'x'});await assert.rejects(c.submit({challengeToken:'one',consent:true}),/STORAGE_UNAVAILABLE/);assert.equal(sent,false);
 assert.throws(()=>createCustomerOrderClient({...base,storage:{...storage,getItem:()=>'{bad'}}),/STORAGE_UNAVAILABLE/);
});
