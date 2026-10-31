import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const root = new URL('../', import.meta.url);
const html = await readFile(new URL('campaign.html', root), 'utf8');
const configJs = await readFile(new URL('js/config.js', root), 'utf8');
const marketingJs = await readFile(new URL('js/marketing.js', root), 'utf8');
const campaignJs = await readFile(new URL('js/campaign.js', root), 'utf8');

function page(url = 'https://store.test/campaign') {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  dom.window.eval(configJs);
  dom.window.eval(marketingJs);
  dom.window.eval(campaignJs);
  return dom;
}

test('campaign creative angle is selected only from the allowlist', () => {
  const benefit = page('https://store.test/campaign?utm_content=benefit');
  assert.equal(benefit.window.document.documentElement.dataset.campaignAngle, 'benefit');
  assert.match(benefit.window.document.querySelector('h1').textContent, /لمسة تشطيب/);

  const steps = page('https://store.test/campaign?utm_content=order_steps');
  assert.equal(steps.window.document.documentElement.dataset.campaignAngle, 'order_steps');
  assert.match(steps.window.document.querySelector('h1').textContent, /راجعي التفاصيل/);

  const prices = page('https://store.test/campaign?utm_content=reference_prices');
  assert.equal(prices.window.document.documentElement.dataset.campaignAngle, 'reference_prices');
  assert.match(prices.window.document.querySelector('h1').textContent, /قارني الأحجام/);

  const sizeGuide = page('https://store.test/campaign?utm_content=size_guide');
  assert.equal(sizeGuide.window.document.documentElement.dataset.campaignAngle, 'size_guide');
  assert.match(sizeGuide.window.document.querySelector('h1').textContent, /اختاري الحجم/);
});

test('price cards are generated from central config and link to product page with safe UTM tags', () => {
  const dom = page('https://store.test/campaign?utm_source=facebook&utm_medium=organic&utm_campaign=pilot_14day&utm_content=reference_prices');
  const { document, RAWAA_CONFIG } = dom.window;
  const cards = [...document.querySelectorAll('.campaign-product-card')];
  assert.equal(cards.length, RAWAA_CONFIG.products.length);
  assert.deepEqual(cards.map((card) => card.querySelector('h3').textContent), Array.from(RAWAA_CONFIG.products, (product) => product.sizeLabel));
  assert.deepEqual(cards.map((card) => card.querySelector('.campaign-product-price').textContent), Array.from(RAWAA_CONFIG.products, (product) => '$' + product.price));
  for (const card of cards) {
    const url = new URL(card.querySelector('a').href);
    assert.equal(url.pathname, '/serum');
    assert.equal(url.hash, '#products');
    assert.equal(url.searchParams.get('utm_source'), 'facebook');
    assert.equal(url.searchParams.get('utm_medium'), 'organic');
    assert.equal(url.searchParams.get('utm_campaign'), 'pilot_14day');
    assert.equal(url.searchParams.get('utm_content'), 'reference_prices');
  }
});

test('delivery examples and WhatsApp address use owner config without sending or tracking', () => {
  const dom = page('https://store.test/campaign?utm_source=facebook&utm_campaign=pilot_14day&utm_content=benefit');
  const { document, RAWAA_CONFIG } = dom.window;
  const delivery = document.querySelector('[data-campaign-delivery]').textContent;
  const configuredScentPrice = '$' + RAWAA_CONFIG.customization.scentPrice;
  assert.equal(document.querySelector('[data-campaign-scent-price]').textContent, configuredScentPrice);
  assert.ok(document.querySelector('[data-campaign-addon]').textContent.includes(configuredScentPrice));
  assert.match(delivery, /شام كاش/);
  assert.match(delivery, /توصيل مجاني/);
  assert.match(delivery, /الدفع عند الاستلام/);
  assert.match(delivery, /\$2/);
  assert.match(delivery, /\$4/);

  const wa = document.querySelector('[data-campaign-whatsapp]');
  const url = new URL(wa.href);
  assert.equal(url.hostname, 'wa.me');
  assert.equal(url.pathname, '/' + RAWAA_CONFIG.contact.whatsappNumber);
  assert.match(url.searchParams.get('text'), /الاستفسار عن السيروم/);
  assert.match(url.searchParams.get('text'), /المصدر: pilot_14day/);
  assert.match(url.searchParams.get('text'), /نسخة المحتوى: benefit/);
  assert.equal(dom.window.fbq, undefined, 'the pixel remains disabled and no remote tracking client is loaded');
  assert.equal(document.querySelectorAll('script[src^="https://"]').length, 0);
});

test('untrusted UTM content cannot inject markup into the page', () => {
  const dom = page('https://store.test/campaign?utm_content=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E&utm_campaign=%40example.invalid');
  const { document } = dom.window;
  assert.equal(document.documentElement.dataset.campaignAngle, 'default');
  assert.equal(document.querySelectorAll('img[onerror]').length, 0);
  assert.match(document.querySelector('h1').textContent, /لمسة تشطيب/);
  for (const link of document.querySelectorAll('a[href*="/serum"]')) {
    assert.equal(new URL(link.href).searchParams.has('utm_campaign'), false);
  }
});

test('campaign landing stays noindex and discloses conceptual packaging and manual order confirmation', () => {
  assert.match(html, /name="robots" content="noindex,follow"/);
  assert.match(html, /تصور تصميمي للعبوات/);
  assert.match(html, /العبوة تُجهّز عند الطلب/);
  assert.match(html, /فتح واتساب لا يرسل الرسالة تلقائيًا/);
  assert.match(html, /لا توجد بوابة دفع أو طلب مؤكد/);
});
