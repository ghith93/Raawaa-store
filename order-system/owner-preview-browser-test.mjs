// Local Chromium test; requires test-only Playwright Core and Sparticuz Chromium.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
if (!process.env.PLAYWRIGHT_MODULE || !process.env.CHROMIUM_MODULE || !process.env.PREVIEW_URL) throw new Error('Missing test module paths or preview URL');
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE));
const chromiumPackage = (await import(pathToFileURL(process.env.CHROMIUM_MODULE))).default;
for (const width of [320,390,430]) {
  const browser = await chromium.launch({ executablePath: await chromiumPackage.executablePath(), args: chromiumPackage.args, headless:true });
  try {
    const context = await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true,locale:'ar'});
    const page=await context.newPage(); const errors=[];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(process.env.PREVIEW_URL, { waitUntil:'load' });
    assert.equal(await page.locator('.demo').isVisible(), true);
    await page.locator('#open').click();
    await page.locator('.card').first().waitFor();
    assert.equal(await page.locator('.card').count(),1);
    assert.match(await page.locator('#orders').innerText(),/20\.16/);
    await page.locator('#more').click();
    assert.equal(await page.locator('.card').count(),2);
    assert.match(await page.locator('#orders').innerText(),/غير مؤكدة/);
    assert.equal(await page.evaluate('document.documentElement.scrollWidth <= innerWidth'),true);
    await page.addScriptTag({ path: 'scripts/vendor/axe.min.js' });
    const violations=await page.evaluate(async()=> (await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa']}})).violations.map(v=>({id:v.id, nodes:v.nodes.map(n=>({target:n.target, summary:n.failureSummary}))})));
    assert.deepEqual(violations, []);
    await page.locator('#refresh').click();
    assert.equal(await page.locator('.card').count(),1);
    await page.locator('#logout').click();
    assert.equal(await page.locator('.card').count(),0);
    assert.equal(await page.locator('#entry').isVisible(),true);
    assert.deepEqual(errors,[]);
    console.log(`Chromium mobile ${width}px: navigation, pagination, logout, layout and axe passed`);
    await context.close();
  } finally { await browser.close(); }
}
