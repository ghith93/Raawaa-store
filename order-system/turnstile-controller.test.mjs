import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createTurnstileController} from './turnstile-controller.mjs';
const sitekey='0x4AAAAAAFr3EbyzAicxJebq';
test('only serves a fresh token once and clears on expiry, reset and destruction',()=>{
 let opts,resets=0,removes=0;const states=[];
 const turnstile={render(_element,options){opts=options;return 'widget';},reset(id){assert.equal(id,'widget');resets++;},remove(id){assert.equal(id,'widget');removes++;}};
 const c=createTurnstileController({turnstile,container:{},sitekey,onChange:s=>states.push(s)});
 assert.equal(opts.action,'rawaa_order');assert.equal(opts.sitekey,sitekey);opts.callback('test-token');assert.equal(c.take(),'test-token');assert.equal(c.take(),null);
 opts.callback('old-token');opts['expired-callback']();assert.equal(c.take(),null);
 opts.callback('to-clear');c.reset();assert.equal(c.take(),null);assert.equal(resets,1);
 c.destroy();opts.callback('late');assert.equal(c.take(),null);assert.equal(removes,1);assert.throws(()=>c.reset(),/WIDGET_UNAVAILABLE/);
 assert.deepEqual(states,['ready','ready','expired','ready','pending']);
});
test('fails closed on invalid dependencies and challenge failures',()=>{
 assert.throws(()=>createTurnstileController({turnstile:{},container:{},sitekey}),/INVALID_CONFIGURATION/);
 let opts;const c=createTurnstileController({turnstile:{render(_,x){opts=x;return 'id';},reset(){},remove(){}},container:{},sitekey});
 opts.callback('valid');opts['error-callback']();assert.equal(c.take(),null);opts.callback('x'.repeat(2049));assert.equal(c.take(),null);
});
