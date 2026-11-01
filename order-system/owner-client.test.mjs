import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOwnerClient } from './owner-client.mjs';
const base = { supabaseUrl:'https://example.supabase.co', ownerEndpoint:'https://example.functions.supabase.co/orders', publishableKey:'public-test-key' };
const response = data => ({ok:true, status:200, json:async()=>data});
test('login, authenticated list and logout use private in-memory token with safe fetch options', async () => {
  const calls=[];
  const client=createOwnerClient({ ...base, fetchImpl:async (url, init) => { calls.push({url,init}); if(url.includes('/token?')) return response({access_token:'abc.def.ghi',expires_in:3600}); if(url.endsWith('/logout')) return response({}); return response({orders:[],nextCursor:null}); } });
  await client.login(' test@example.org ', 'dummy-password');
  await client.list(); await client.logout();
  assert.equal(calls[1].init.headers.authorization, 'Bearer abc.def.ghi');
  assert.equal(calls[1].init.cache, 'no-store');
  assert.equal(calls[1].init.credentials, 'omit');
  assert.equal(calls[1].init.redirect, 'error');
  await assert.rejects(client.list(), /SESSION_EXPIRED/);
});
test('rejects foreign, insecure or malformed endpoints', () => {
  for(const override of [{ownerEndpoint:'https://evil.example/orders'}, {supabaseUrl:'http://example.supabase.co'}, {supabaseUrl:'https://example.supabase.co/path'}, {ownerEndpoint:'https://example.functions.supabase.co/orders?bad=1'}]) assert.throws(()=>createOwnerClient({...base,...override}));
});
test('expires sessions and suppresses underlying network errors', async () => {
  let time=0;
  const client=createOwnerClient({...base, now:()=>time, fetchImpl:async url => url.includes('/token?') ? response({access_token:'valid.jwt',expires_in:1}) : Promise.reject(new Error('private data'))});
  await client.login('a@b.com','dummy');
  await assert.rejects(client.list(), /LOAD_FAILED/);
  time=1000; await assert.rejects(client.list(), /SESSION_EXPIRED/);
});
test('401 and malformed server results do not expose error details', async () => {
  let mode='login';
  const client=createOwnerClient({...base, fetchImpl:async ()=> mode==='login' ? response({access_token:'valid.jwt',expires_in:1}) : mode==='unauthorized' ? {ok:false,status:401} : response({orders:'bad',nextCursor:null})});
  await client.login('a@b.com','dummy'); mode='invalid'; await assert.rejects(client.list(), /LOAD_FAILED/);
  mode='unauthorized'; await assert.rejects(client.list(), /SESSION_EXPIRED/);
  await assert.rejects(client.list(), /SESSION_EXPIRED/);
});
test('logout while login is in flight cannot restore the session', async () => {
  let resolveLogin;
  const client=createOwnerClient({...base, fetchImpl:()=>new Promise(resolve=>{resolveLogin=resolve;})});
  const pending=client.login('a@b.com','dummy');
  await client.logout(); resolveLogin(response({access_token:'late.jwt',expires_in:60}));
  await assert.rejects(pending,/LOGIN_FAILED/); await assert.rejects(client.list(),/SESSION_EXPIRED/);
});
test('pairing uses authenticated requests and never permits foreign endpoint',async()=>{
  assert.throws(()=>createOwnerClient({...base,pairingEndpoint:'https://evil.example/pair'}));
  const calls=[];const client=createOwnerClient({...base,pairingEndpoint:'https://example.functions.supabase.co/pair',fetchImpl:async(url,init)=>{
    calls.push({url,init}); if(url.includes('/token?'))return response({access_token:'valid.jwt',expires_in:60});
    return response(JSON.parse(init.body).action==='start'?{ok:true,message:'/pair '+'a'.repeat(32),expiresAt:Date.now()+1000}:{ok:true});
  }});
  await client.login('a@b.com','dummy');assert.match((await client.pair('start')).message,/^\/pair /);await client.pair('finish');
  assert.equal(calls[1].init.headers.authorization,'Bearer valid.jwt');assert.equal(calls[1].init.cache,'no-store');assert.deepEqual(JSON.parse(calls[2].init.body),{action:'finish'});
});
test('owner withdrawal request uses authenticated no-store POST and sends only the requested action and phone',async()=>{
  assert.throws(()=>createOwnerClient({...base,marketingPreferencesEndpoint:'https://evil.example/withdraw'}));
  const calls=[];
  const client=createOwnerClient({...base,marketingPreferencesEndpoint:'https://example.functions.supabase.co/preferences',fetchImpl:async(url,init)=>{
    calls.push({url,init});
    return url.includes('/token?')?response({access_token:'valid.jwt',expires_in:60}):response({ok:true});
  }});
  await client.login('owner@example.org','synthetic-password');
  await assert.rejects(client.withdrawMarketing('letters-only'),/PREFERENCE_INVALID/);
  assert.equal(calls.length,1);
  assert.deepEqual(await client.withdrawMarketing('0997310856'),{ok:true});
  assert.equal(calls[1].url,'https://example.functions.supabase.co/preferences');
  assert.equal(calls[1].init.method,'POST');
  assert.equal(calls[1].init.cache,'no-store');
  assert.equal(calls[1].init.credentials,'omit');
  assert.equal(calls[1].init.redirect,'error');
  assert.equal(calls[1].init.headers.authorization,'Bearer valid.jwt');
  assert.deepEqual(JSON.parse(calls[1].init.body),{action:'withdraw',phone:'0997310856'});
});
test('withdrawal errors are generic and sessions expire without exposing preference data',async()=>{
  let calls=0;
  const client=createOwnerClient({...base,marketingPreferencesEndpoint:'https://example.functions.supabase.co/preferences',fetchImpl:async url=>{
    calls++; return url.includes('/token?')?response({access_token:'valid.jwt',expires_in:60}):{ok:false,status,json:async()=>({error:'synthetic database detail phone 0997310856'})};
  }});
  await client.login('owner@example.org','synthetic-password');
  await assert.rejects(client.withdrawMarketing('0997310856'),/PREFERENCE_UNAVAILABLE/);
  assert.equal(calls,2);
  const noEndpoint=createOwnerClient(base);
  await assert.rejects(noEndpoint.withdrawMarketing('0997310856'),/PREFERENCE_UNAVAILABLE/);
  let time=0;
  const expiring=createOwnerClient({...base,marketingPreferencesEndpoint:'https://example.functions.supabase.co/preferences',now:()=>time,fetchImpl:async url=>url.includes('/token?')?response({access_token:'valid.jwt',expires_in:1}):response({ok:true})});
  await expiring.login('owner@example.org','synthetic-password'); time=1000;
  await assert.rejects(expiring.withdrawMarketing('0997310856'),/SESSION_EXPIRED/);
});

test('test message request uses owner token, no body, and distinguishes unknown delivery',async()=>{
  assert.throws(()=>createOwnerClient({...base,telegramTestEndpoint:'https://evil.example'}));
  let fail=false;const client=createOwnerClient({...base,telegramTestEndpoint:'https://example.functions.supabase.co/test',fetchImpl:async(url,init)=>{
    if(url.includes('/token?'))return response({access_token:'valid.jwt',expires_in:60});assert.equal(init.body,undefined);assert.equal(init.headers.authorization,'Bearer valid.jwt');return fail?{ok:false,status:503,json:async()=>({error:'unknown'})}:response({ok:true});
  }});await client.login('a@b.com','dummy');await client.sendTest();fail=true;await assert.rejects(client.sendTest(),/TEST_UNKNOWN/);
});
