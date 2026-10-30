import {test} from 'node:test';
import assert from 'node:assert/strict';
import {turnstileSettings} from './turnstile-settings.mjs';
test('staged widget settings pin the storefront hostname and order action',()=>{
 assert.match(turnstileSettings.sitekey,/^[A-Za-z0-9_-]{20,}$/);
 assert.equal(turnstileSettings.hostname,'raawaa-store.pages.dev');
 assert.equal(turnstileSettings.action,'rawaa_order');
 assert.equal(Object.keys(turnstileSettings).some(k=>/secret/i.test(k)),false);
});
