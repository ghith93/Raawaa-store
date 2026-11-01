import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
if (!process.env.PLAYWRIGHT_MODULE || !process.env.CHROMIUM_MODULE || !process.env.OWNER_URL) throw new Error('Missing test module paths or URL');
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE));
const chromiumPackage = (await import(pathToFileURL(process.env.CHROMIUM_MODULE))).default;
for (const width of [320,390,430]) {
  const browser = await chromium.launch({ executablePath: await chromiumPackage.executablePath(), args: chromiumPackage.args, headless:true });
  try {
    const ctx = await browser.newContext({viewport:{width,height:844}, isMobile:true, hasTouch:true, locale:'ar'});
    const page = await ctx.newPage(), errors=[];
    page.on('pageerror', error => errors.push(error.message));
    let rejectNext = false, logoutCalls = 0, withdrawalCalls = 0;
    const cors = {'access-control-allow-origin':'*','access-control-allow-headers':'authorization, apikey, content-type','access-control-allow-methods':'GET, POST, OPTIONS'};
    await page.route('**/settings.mjs', route => route.fulfill({contentType:'application/javascript',body:`export const settings={ownerOrigin:${JSON.stringify(new URL(process.env.OWNER_URL).origin)},supabaseUrl:'https://example.supabase.co',ownerEndpoint:'https://example.functions.supabase.co/orders',pairingEndpoint:'https://example.functions.supabase.co/pair',telegramTestEndpoint:'https://example.functions.supabase.co/test',marketingPreferencesEndpoint:'https://example.functions.supabase.co/marketing',publishableKey:'fake-public-key'};`}));
    await page.route('https://example.supabase.co/**', async route => {
      if(route.request().method()==='OPTIONS') return route.fulfill({status:204,headers:cors});
      if(route.request().url().includes('/logout')) {logoutCalls++; return route.fulfill({status:204,headers:cors});}
      const body=route.request().postDataJSON();
      assert.equal(body.password,'fake-test-password');
      return route.fulfill({status:200,headers:cors,contentType:'application/json',body:JSON.stringify({access_token:'fake.valid.jwt',expires_in:3600})});
    });
    await page.route('https://example.functions.supabase.co/**', async route => {
      if(route.request().method()==='OPTIONS') return route.fulfill({status:204,headers:cors});
      assert.equal(route.request().headers().authorization,'Bearer fake.valid.jwt');
      if(rejectNext) return route.fulfill({status:401,headers:cors,contentType:'application/json',body:'{}'});
      if(route.request().url().endsWith('/marketing')) {
        withdrawalCalls++;
        assert.equal(route.request().method(),'POST');
        assert.deepEqual(route.request().postDataJSON(),{action:'withdraw',phone:'0997310856'});
        return route.fulfill({status:200,headers:cors,contentType:'application/json',body:'{"ok":true}'});
      }
      if (route.request().url().endsWith('/test')) return route.fulfill({status:200,headers:cors,contentType:'application/json',body:'{"ok":true}'});
      if (route.request().url().endsWith('/pair')) {
        const data=route.request().postDataJSON();
        return route.fulfill({status:200,headers:cors,contentType:'application/json',body:JSON.stringify(data.action==='start'?{ok:true,id:'11111111-1111-4111-8111-111111111111',message:'/pair '+ 'a'.repeat(32),expiresAt:Date.now()+600000}:{ok:true})});
      }
      const page2=new URL(route.request().url()).searchParams.has('cursor');
      const order={reference:page2?'RAWAA-TEST002':'RAWAA-TEST001',name:'<img src=x onerror=alert(1)>',phone:'0990000000',address:'عنوان تجريبي',status:'pending_review',notification:'unknown',items:[{size:'50 مل',qty:1}],method:'cod',scent:'unscented',oil:'',totalCents:2240};
      return route.fulfill({status:200,headers:cors,contentType:'application/json',body:JSON.stringify({orders:[order],nextCursor:page2?null:'cGFnZTI',hasMore:!page2})});
    });
    await page.goto(process.env.OWNER_URL, {waitUntil:'load'});
    await page.locator('#email').fill('owner@example.org'); await page.locator('#password').fill('fake-test-password'); await page.locator('#login').click();
    await page.locator('.card').first().waitFor();
    assert.equal(await page.locator('#password').inputValue(),'');
    assert.equal(await page.locator('.card img').count(),0);
    assert.match(await page.locator('.card').first().innerText(),/<img src=x/);
    assert.match(await page.locator('.card').first().innerText(),/22\.40/);
    assert.equal(await page.evaluate('document.documentElement.scrollWidth <= innerWidth'),true);
    assert.equal(await page.evaluate('localStorage.length + sessionStorage.length'),0);
    assert.equal(await page.locator('#marketing-withdraw-button').isEnabled(),true);
    await page.locator('#marketing-phone').fill('0997310856');
    await page.locator('#marketing-withdraw-button').click();
    await page.waitForFunction(() => document.querySelector('#marketing-withdraw-status').textContent.includes('سُجّل طلب الإلغاء'));
    assert.equal(withdrawalCalls,1);
    assert.equal(await page.locator('#marketing-phone').inputValue(),'');
    assert.equal((await page.locator('#marketing-withdraw-status').innerText()).includes('0997310856'),false);
    if (await page.locator('#pair-start').count()) {
      await page.locator('#pair-start').click(); await page.locator('#pair-code').waitFor();
      await page.waitForFunction(() => document.querySelector('#pair-code').textContent.startsWith('/pair '));
      await page.locator('#pair-finish').click(); await page.waitForFunction(() => document.querySelector('#pair-status').textContent.includes('تم ربط'));
      assert.equal(await page.locator('#pair-code').innerText(),'');
      if (await page.locator('#telegram-test').count()) { await page.locator('#telegram-test').click(); await page.waitForFunction(() => document.querySelector('#pair-status').textContent.includes('أُرسلت رسالة اختبار')); }
    }
    await page.addScriptTag({path:'scripts/vendor/axe.min.js'});
    const violations=await page.evaluate(async()=> (await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa']}})).violations.map(v=>v.id));
    assert.deepEqual(violations,[]);
    await page.locator('#more').click(); await page.locator('.card').nth(1).waitFor(); assert.equal(await page.locator('.card').count(),2);
    rejectNext=true; await page.locator('#refresh').click();
    await page.locator('#entry').waitFor(); assert.equal(await page.locator('.card').count(),0);
    assert.match(await page.locator('#login-message').innerText(),/انتهت الجلسة/);
    rejectNext=false; await page.locator('#password').fill('fake-test-password'); await page.locator('#login').click();
    await page.locator('.card').first().waitFor(); await page.locator('#logout').click();
    await page.locator('#entry').waitFor(); assert.equal(await page.locator('.card').count(),0);
    await page.waitForFunction(() => document.querySelector('#logout').hidden);
    assert.deepEqual(errors,[]);
    console.log(`Owner app Chromium mobile ${width}px: login mock, data rendering, pagination, expiration, accessibility passed`);
    await ctx.close();
  } finally { await browser.close(); }
}
// Default test fixture remains disabled; the separately built site is intentionally configured.
if (process.env.TEST_CONFIGURED !== '1') {
const browser = await chromium.launch({ executablePath: await chromiumPackage.executablePath(), args: chromiumPackage.args, headless:true });
try {
 const page=await browser.newPage(); await page.goto(process.env.OWNER_URL,{waitUntil:'load'});
 assert.equal(await page.locator('#login').isDisabled(),true);
 assert.equal(await page.locator('#unconfigured').isVisible(),true);
 console.log('Default configuration is disabled');
} finally {await browser.close();}
}
