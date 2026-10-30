import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createEvaluationCases,scoreEvaluation} from './model-evaluation.mjs';
const sandbox={window:{}};
vm.runInNewContext(await readFile(new URL('../js/config.js',import.meta.url),'utf8'),sandbox);
const config=sandbox.window.RAWAA_CONFIG;

test('five synthetic cases draw current prices and delivery from config, with no customer data',()=>{
 const cases=createEvaluationCases(config);
 assert.equal(cases.length,5);assert.equal(cases[0].expected,'2040');assert.equal(cases[1].expected,'0');
 assert.ok(!JSON.stringify(cases).includes(config.contact.whatsappNumber));
 assert.deepEqual(cases.slice(2).map(x=>x.expected),['unknown','unknown','unknown']);
 const modified=structuredClone(config);modified.products.find(x=>x.id==='serum-50').price=21;modified.payment.methods.find(x=>x.id==='shamcash').freeDeliveryIn=[];
 const updated=createEvaluationCases(modified);assert.equal(updated[0].expected,'2100');assert.equal(updated[1].expected,'200');
 assert.throws(()=>createEvaluationCases({}),/INVALID_EVALUATION_CONFIG/);
});

test('scores strict JSON, rejects false claims, extra fields and malformed replies',()=>{
 const cases=createEvaluationCases(config),correct=cases.map(x=>JSON.stringify({answer:x.expected}));
 assert.equal(scoreEvaluation(cases,correct).passed,5);
 const bad=['not json','{}',JSON.stringify({answer:'known'}),JSON.stringify({answer:'unknown',extra:'secret'}),JSON.stringify({answer:'confirmed'})];
 const result=scoreEvaluation(cases,bad);assert.equal(result.passed,0);
 assert.deepEqual(result.results.map(x=>x.reason),['invalid_json','invalid_schema','mismatch','invalid_schema','mismatch']);
 assert.throws(()=>scoreEvaluation(cases,correct.slice(1)),/INVALID_EVALUATION/);
 assert.ok(!JSON.stringify(result).includes('secret'));
});
