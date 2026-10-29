import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendTelegramTest } from './telegram-test-message.mjs';
const token='12345:'+'x'.repeat(25), getRecipient=async()=>'123456';
test('sends explicitly labelled test without customer data to private paired recipient',async()=>{
  let payload;const result=await sendTelegramTest({token,getRecipient,fetchImpl:async(_url,init)=>{payload=JSON.parse(init.body);assert.equal(init.redirect,'error');return {ok:true,json:async()=>({ok:true,result:{message_id:9,chat:{id:123456}}})};}});
  assert.deepEqual(result,{ok:true});assert.equal(payload.chat_id,'123456');assert.match(payload.text,/ليست طلبًا جديدًا/);assert.match(payload.text,/لم تُفعّل/);assert.ok(!JSON.stringify(result).includes('123456'));
});
test('refuses invalid recipient and treats ambiguous delivery as unknown without exposing secrets',async()=>{
  assert.deepEqual(await sendTelegramTest({token,getRecipient:async()=>'-123',fetchImpl:()=>{throw Error();}}),{ok:false,reason:'unavailable'});
  assert.deepEqual(await sendTelegramTest({token,getRecipient,fetchImpl:async()=>{throw Error(token);}}),{ok:false,reason:'unknown'});
  assert.deepEqual(await sendTelegramTest({token,getRecipient,fetchImpl:async()=>({ok:true,json:async()=>({ok:true,result:{message_id:5,chat:{id:99}}})})}),{ok:false,reason:'unknown'});
});
