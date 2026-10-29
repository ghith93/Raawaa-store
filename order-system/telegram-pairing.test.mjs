import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTelegramPairing } from './telegram-pairing.mjs';
const token='123456:'+'x'.repeat(25), time=1800000000000;
function fixture() {
  let record, recipient, messages=[], clock=time;
  const repository={async create(row){record={...row,consumed:false};},async findCurrent(){return record ? {...record} : null;},async consume({id,codeHash,chatId,now}){if(!record||record.id!==id||record.codeHash!==codeHash||record.consumed||now>=record.expiresAt)return false;record.consumed=true;recipient=chatId;return true;}};
  const fetchImpl=async (_url,init)=>{assert.equal(JSON.parse(init.body).limit,100);return {ok:true,json:async()=>({ok:true,result:messages})};};
  const service=createTelegramPairing({repository,botToken:token,fetchImpl,now:()=>clock});
  return {service,getRecord:()=>record,getRecipient:()=>recipient,setMessages:value=>{messages=value;},setTime:value=>{clock=value;}};
}
const update=(text,id=123,date=Math.floor(time/1000),type='private')=>({message:{text,date,chat:{id,type},from:{id}}});
test('pairs only after owner sends the one-time code, without persisting the code',async()=>{
  const f=fixture(), start=await f.service.start(), code=start.message.split(' ')[1];
  assert.equal(start.ok,true); assert.ok(!JSON.stringify(f.getRecord()).includes(code));
  assert.equal((await f.service.finish({id:start.id,code})).error,'not_found');
  f.setMessages([update(start.message)]); assert.deepEqual(await f.service.finish({id:start.id,code}),{ok:true});
  assert.equal(f.getRecipient(),'123'); assert.equal((await f.service.finish({id:start.id,code})).error,'invalid');
});
test('rejects expired, malformed, old, group, impersonated and ambiguous messages',async()=>{
  const f=fixture(), start=await f.service.start(),code=start.message.split(' ')[1];
  f.setMessages([update(start.message,123,Math.floor(time/1000)-1),update(start.message,123,Math.floor(time/1000),'group'),{message:{text:start.message,date:time/1000,chat:{id:123,type:'private'},from:{id:999}}}]);
  assert.equal((await f.service.finish({id:start.id,code})).error,'not_found');
  f.setMessages([update(start.message,123),update(start.message,456)]);
  assert.equal((await f.service.finish({id:start.id,code})).error,'ambiguous');
  assert.equal((await f.service.finish({id:start.id,code:'bad'})).error,'ambiguous');
  f.setTime(time+600001); assert.equal((await f.service.finish({id:start.id,code})).error,'invalid');
  assert.equal(f.getRecipient(),undefined);
});
test('fails closed on absent secrets or Telegram/network errors without exposing them',async()=>{
  const broken=createTelegramPairing({repository:{},botToken:''});assert.equal((await broken.start()).error,'unavailable');
  const f=fixture(), start=await f.service.start(),code=start.message.split(' ')[1];
  const repository={async create(){},async findCurrent(){return f.getRecord();},async consume(){throw new Error('unexpected');}};
  const unavailable=createTelegramPairing({repository,botToken:token,now:()=>time,fetchImpl:async()=>{throw new Error(token);}});
  const result=await unavailable.finish({id:start.id,code}); assert.deepEqual(result,{ok:false,error:'unavailable'});assert.ok(!JSON.stringify(result).includes(token));
});

test('atomic consumption permits only one concurrent pairing',async()=>{
  const f=fixture(), start=await f.service.start(),code=start.message.split(' ')[1];
  f.setMessages([update(start.message)]);
  const results=await Promise.all([f.service.finish({id:start.id,code}),f.service.finish({id:start.id,code})]);
  assert.equal(results.filter(r=>r.ok).length,1);
  assert.equal(results.filter(r=>!r.ok).length,1);
});
