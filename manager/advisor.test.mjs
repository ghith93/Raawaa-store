import test from 'node:test';
import assert from 'node:assert/strict';
import { collectChecks, buildMessages, createReport, validateReport, MODEL } from './advisor.mjs';

const checks = { site_checks: 'pass', order_unit_tests: 'fail' };
const data = { priorities: [{action:'اختبر التكامل',reason:'استقبال الطلبات غير متحقق'}], unknowns: ['بيانات المبيعات'] };
const accountId = 'a'.repeat(32);

test('checks pass only fixed commands and expose statuses, never output', () => {
  const calls = [];
  const result = collectChecks((exe, args, opts) => { calls.push([exe,args,opts]); return {status: calls.length === 1 ? 0 : 1, stdout:'PRIVATE CUSTOMER', stderr:'SECRET'}; });
  assert.deepEqual(result, checks);
  assert.equal(calls.length, 2);
  assert.equal(calls[0][2].shell, undefined);
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
  assert.deepEqual(collectChecks(() => ({status:null,error:new Error('timeout')})), {site_checks:'unknown',order_unit_tests:'unknown'});
});

test('prompt only includes approved statuses and explicitly unknown sales', () => {
  const prompt = JSON.stringify(buildMessages({...checks, customers:'123', secret:'PRIVATE'}));
  assert.ok(!prompt.includes('PRIVATE'));
  assert.ok(!prompt.includes('123'));
  assert.match(prompt, /غير متاحة/);
  assert.throws(() => buildMessages({ ...checks, site_checks:'untrusted' }));
});

test('sends one bounded request to the fixed Cloudflare URL without tools', async () => {
  let calls = 0;
  const report = await createReport({ accountId, token:'TEST_TOKEN', checks, fetchImpl: async (url, init) => {
    calls++;
    assert.equal(url, `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${MODEL}`);
    assert.equal(init.redirect,'error');
    const body = JSON.parse(init.body);
    assert.equal(body.max_completion_tokens,800);
    assert.equal(body.store,false);
    assert.equal(body.tools,undefined);
    assert.equal(init.headers.Authorization,'Bearer TEST_TOKEN');
    return { ok:true, json:async()=>({success:true,result:{choices:[{message:{content:JSON.stringify(data)}}]}}) };
  }});
  assert.deepEqual(report,data);
  assert.equal(calls,1);
});

test('fails closed on bad credentials, errors, or malformed model output', async () => {
  await assert.rejects(createReport({accountId:'../other',token:'test',checks,fetchImpl:()=>{throw Error('must not call');}}), /configuration/);
  await assert.rejects(createReport({accountId,token:'TEST_TOKEN',checks,fetchImpl:async()=>{throw Error('TEST_TOKEN');}}), e => !e.message.includes('TEST_TOKEN'));
  await assert.rejects(createReport({accountId,token:'test',checks,fetchImpl:async()=>({ok:false,status:429})}), /HTTP 429/);
  await assert.rejects(createReport({accountId,token:'test',checks,fetchImpl:async()=>({ok:true,json:async()=>({success:false})})}), /inference failed/);
  assert.throws(() => validateReport('not-json'));
  assert.throws(() => validateReport(JSON.stringify({...data, priorities:[]})));
  assert.throws(() => validateReport(JSON.stringify({...data, unknowns:['bad\ncommand']})));
  assert.deepEqual(validateReport(JSON.stringify({...data, secret:'discarded'})),data);
});

test('inference restricts models and token budgets', async () => {
  const { requestInference } = await import('./advisor.mjs');
  const accountId = 'a'.repeat(32);
  await assert.rejects(requestInference({accountId,token:'x',messages:[],model:'unknown',fetchImpl:()=>{throw Error('called');}}), /allowlisted/);
  await assert.rejects(requestInference({accountId,token:'x',messages:[],maxTokens:1601,fetchImpl:()=>{throw Error('called');}}), /token limit/);
  const result = await requestInference({accountId,token:'x',messages:[],model:'@cf/openai/gpt-oss-120b',maxTokens:1600,fetchImpl:async(url, options)=>{
    assert.ok(url.endsWith('/@cf/openai/gpt-oss-120b'));
    assert.equal(JSON.parse(options.body).max_completion_tokens,1600);
    return {ok:true,json:async()=>({success:true,result:{response:'ok'}})};
  }});
  assert.equal(result,'ok');
});
