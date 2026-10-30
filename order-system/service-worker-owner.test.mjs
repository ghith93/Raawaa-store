import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../sw.js', import.meta.url),'utf8');
test('service worker never intercepts private owner, API or external requests', () => {
  const handlers={}; const context={ self:{location:{origin:'https://raawaa-store.pages.dev'},addEventListener:(name,fn)=>handlers[name]=fn}, URL, caches:{}, fetch(){} };
  vm.runInNewContext(source,context);
  for (const path of ['/owner','/owner/','/owner/index.html','/owner/app.mjs','/owner/settings.mjs','/api','/api/','/api/orders','/api/orders/status','/api/order.json']) {
    let intercepted=false;
    handlers.fetch({request:{method:'GET',url:`https://raawaa-store.pages.dev${path}`},respondWith:()=>{intercepted=true;}});
    assert.equal(intercepted,false,path);
  }
  let intercepted=false;
  handlers.fetch({request:{method:'GET',url:'https://oyoyozdugicmnkfhjovo.supabase.co/functions/v1/rawaa-owner-orders'},respondWith:()=>{intercepted=true;}});
  assert.equal(intercepted,false);
});


test('all API methods bypass the service worker without falling back to stored HTML',()=>{
 const handlers={};const context={self:{location:{origin:'https://raawaa-store.pages.dev'},addEventListener:(name,fn)=>handlers[name]=fn},URL,caches:{},fetch(){throw Error('unexpected');}};
 vm.runInNewContext(source,context);
 for(const method of ['GET','POST','PUT','DELETE']){
   let intercepted=false;handlers.fetch({request:{method,url:'https://raawaa-store.pages.dev/api/orders?reference=private'},respondWith:()=>{intercepted=true;}});
   assert.equal(intercepted,false,method);
 }
});
