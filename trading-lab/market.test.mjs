import {test} from 'node:test'; import assert from 'node:assert/strict'; import {normalizeMarket,fetchHistory,hour} from './market.mjs';
const start=Date.UTC(2026,0,1,1);const candles=Array.from({length:4},(_,i)=>({t:start+(i-1)*hour,c:'25'}));const funding=Array.from({length:4},(_,i)=>({time:start+i*hour,fundingRate:'0.0001'}));
test('align closing candles to funding settlement',()=>{const r=normalizeMarket(candles,funding,start,start+3*hour);assert.equal(r.length,4);assert.equal(r[0].time,start);assert.equal(r[0].price,25)});
test('reject missing hour rather than invent values',()=>assert.throws(()=>normalizeMarket(candles,funding.slice(1),start,start+3*hour),/ناقصة/));
test('fetch chunks API using official request shapes',async()=>{const seen=[];const rows=await fetchHistory(async p=>{seen.push(p);return p.type==='candleSnapshot'?candles:funding},start,start+3*hour);assert.equal(rows.length,4);assert.equal(seen[0].req.interval,'1h');assert.equal(seen[1].coin,'HYPE')});
test('reject malformed upstream data',async()=>{await assert.rejects(fetchHistory(async()=>({error:'bad'}),start,start+3*hour))});

test('align funding settlement milliseconds after the hour',()=>{const delayed=funding.map(f=>({...f,time:f.time+106}));assert.equal(normalizeMarket(candles,delayed,start,start+3*hour).length,4)});
test('fetch includes delayed final funding settlement',async()=>{const seen=[];await fetchHistory(async p=>{seen.push(p);return p.type==='candleSnapshot'?candles:funding.map(f=>({...f,time:f.time+48}))},start,start+3*hour);assert.equal(seen[1].endTime,start+3*hour+60000)});
test('reject duplicate funding for the same hour',()=>assert.throws(()=>normalizeMarket(candles,[...funding,{...funding[0],time:funding[0].time+10}],start,start+3*hour),/أكثر من سجل/));
