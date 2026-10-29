import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../sw.js', import.meta.url),'utf8');
test('service worker never intercepts private owner paths or external requests', () => {
  const handlers={}; const context={ self:{location:{origin:'https://raawaa-store.pages.dev'},addEventListener:(name,fn)=>handlers[name]=fn}, URL, caches:{}, fetch(){} };
  vm.runInNewContext(source,context);
  for (const path of ['/owner','/owner/','/owner/index.html','/owner/app.mjs','/owner/settings.mjs']) {
    let intercepted=false;
    handlers.fetch({request:{method:'GET',url:`https://raawaa-store.pages.dev${path}`},respondWith:()=>{intercepted=true;}});
    assert.equal(intercepted,false,path);
  }
  let intercepted=false;
  handlers.fetch({request:{method:'GET',url:'https://oyoyozdugicmnkfhjovo.supabase.co/functions/v1/rawaa-owner-orders'},respondWith:()=>{intercepted=true;}});
  assert.equal(intercepted,false);
});
