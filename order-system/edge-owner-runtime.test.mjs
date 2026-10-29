import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEdgeOwner } from './edge-owner-runtime.mjs';
const owner='11111111-1111-4111-8111-111111111111';
const config = { SUPABASE_URL:'https://example.supabase.co', SUPABASE_DB_URL:'postgres://private', SUPABASE_PUBLISHABLE_KEYS:'{"default":"fake-public"}', RAWAA_OWNER_USER_ID:owner, RAWAA_OWNER_ORIGIN:'https://store.example' };
const req = token => new Request('https://edge.example/orders', { headers: token ? { authorization:`Bearer ${token}` } : {} });
test('missing or invalid config fails closed without touching auth or database', async () => {
  for (const values of [{}, {...config, SUPABASE_URL:'http://insecure.example'}, {...config, SUPABASE_PUBLISHABLE_KEYS:'bad'}]) {
    let used = false;
    const handle=createEdgeOwner({getEnv:k=>values[k], postgresFactory:()=>{used=true;}, fetchImpl:()=>{used=true;}});
    assert.equal((await handle(req('fake.token'))).status,503); assert.equal(used,false);
  }
});
test('verified identity gates database and uses parameterized cursor', async () => {
  let queries=0, authCalls=0;
  const handle=createEdgeOwner({getEnv:k=>config[k], fetchImpl:async (_url,init)=>{authCalls++; assert.equal(init.headers.authorization,'Bearer fake.token'); return {ok:true,json:async()=>({id:owner})};}, postgresFactory:()=>({unsafe:async (_sql,params)=>{queries++; assert.deepEqual(params,[null,null]); return [];}})});
  const res=await handle(req('fake.token'));
  assert.equal(res.status,200); assert.deepEqual(await res.json(),{orders:[],hasMore:false,nextCursor:null});
  assert.equal(queries,1); assert.equal(authCalls,1);
});
test('invalid or different user cannot query database and errors reveal no credentials', async () => {
  for (const response of [null, {id:'22222222-2222-4222-8222-222222222222'}]) {
    let queried=false;
    const handle=createEdgeOwner({getEnv:k=>config[k],fetchImpl:async()=> response ? {ok:true,json:async()=>response} : {ok:false},postgresFactory:()=>{queried=true;}});
    assert.equal((await handle(req('fake.token'))).status,403); assert.equal(queried,false);
  }
  const handle=createEdgeOwner({getEnv:k=>config[k],fetchImpl:async()=>{throw new Error('postgres://private');},postgresFactory:()=>{throw new Error('unexpected');}});
  const res=await handle(req('fake.token')); assert.equal(res.status,401); assert.ok(!(await res.text()).includes('private'));
});
