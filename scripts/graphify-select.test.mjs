import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
const exists=async path=>{try{await stat(path);return true;}catch{return false;}};
test('Graphify snapshot includes tracked code and docs but excludes sensitive and generated paths',async()=>{
  const output=await mkdtemp(join(tmpdir(),'rawaa-graph-test-'));
  try {
    execFileSync('python3',['scripts/graphify-select.py',output]);
    for(const file of ['js/cart.js','order-system/order-core.mjs','order-system/migrations/001_private_orders.sql','docs/GRAPHIFY-AR.md','.github/workflows/site-checks.yml']) assert.equal(await exists(join(output,file)),true,file);
    for(const file of ['.config','.local','.wrangler','.git','node_modules','scripts/vendor','index.html','css/styles.css','assets/img/products/trio-v6-480.avif']) assert.equal(await exists(join(output,file)),false,file);
    const ui=await readFile(join(output,'project-ui-structure.md'),'utf8');assert.match(ui,/## index\.html/);assert.match(ui,/## css\/styles\.css/);assert.doesNotMatch(ui,/wa\.me|https?:\/\//);
    const inventory=await readFile(join(output,'project-file-inventory.md'),'utf8');assert.match(inventory,/index\.html/);assert.match(inventory,/css\/styles\.css/);assert.match(inventory,/robots\.txt/);assert.match(inventory,/_headers/);assert.doesNotMatch(inventory,/\.local\/|\.wrangler\/|\.config\//);
  } finally {await rm(output,{recursive:true,force:true});}
});
