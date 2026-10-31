import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const html = await readFile(new URL('docs/marketing-studio/index.html', root), 'utf8');
const configSource = await readFile(new URL('js/config.js', root), 'utf8');
const appSource = await readFile(new URL('docs/marketing-studio/app.js', root), 'utf8');
const campaignSource = await readFile(new URL('js/campaign.js', root), 'utf8');
const organicKit = await readFile(new URL('docs/ORGANIC-TEST-KIT-AR.md', root), 'utf8');

function tools() {
  const window = {};
  const document = { readyState: 'loading', addEventListener() {} };
  const context = vm.createContext({ window, document, URL });
  vm.runInContext(configSource, context);
  vm.runInContext(appSource, context);
  return { api: window.RawaaMarketingStudio, config: window.RAWAA_CONFIG };
}

test('local marketing desk is clearly a draft tool with no publish or network integrations', () => {
  assert.match(html, /مسودات/);
  assert.match(html, /لا تحتوي زر نشر/);
  assert.match(html, /لا تدخلي أسماء أو أرقام هواتف/);
  assert.match(html, /connect-src 'none'/);
  assert.equal(/<script[^>]+src=["']https?:/.test(html), false);
  assert.equal(/<button[^>]*>[^<]*(?:نشر|جدولة)/.test(html), false);
  assert.match(campaignSource, /size_guide:/);
  assert.match(organicKit, /يتطلب نشر تعديل `size_guide`/);
});

test('UTM builder allowlists source, content, and campaign syntax with correct media', () => {
  const { api } = tools();
  assert.equal(api.cleanCampaign('pilot_14day'), 'pilot_14day');
  assert.equal(api.cleanCampaign('Bad Name!'), '');
  const whatsapp = new URL(api.campaignUrl('pilot_14day', 'whatsapp', 'reference_prices'));
  assert.equal(whatsapp.origin, 'https://raawaa-store.pages.dev');
  assert.equal(whatsapp.pathname, '/campaign');
  assert.equal(whatsapp.searchParams.get('utm_source'), 'whatsapp');
  assert.equal(whatsapp.searchParams.get('utm_medium'), 'messaging');
  assert.equal(whatsapp.searchParams.get('utm_content'), 'reference_prices');
  const social = new URL(api.campaignUrl('pilot_14day', 'instagram', 'benefit'));
  assert.equal(social.searchParams.get('utm_medium'), 'organic');
  assert.equal(api.campaignUrl('pilot_14day', 'instagram', 'size_guide'), '');
  assert.equal(api.campaignUrl('pilot_14day', 'unknown', 'benefit'), '');
  assert.equal(api.campaignUrl('pilot_14day', 'instagram', 'free_text'), '');
  assert.equal(api.campaignUrl('bad name', 'instagram', 'benefit'), '');
});

test('draft prices always derive from the store config, not duplicated price literals', () => {
  const { api, config } = tools();
  const output = api.formatPriceList(config);
  for (const product of config.products) {
    assert.ok(output.includes(product.sizeLabel));
    assert.ok(output.includes(config.currency.symbol + product.price));
  }
  assert.equal(config.products.length, 3);
});

test('aggregate storage accepts only bounded counts and exact non-personal fields', () => {
  const { api } = tools();
  const row = { post: 'size_guide', date: '2026-10-31', reach: 120, clicks: 12, messages: 3, inquiries: 2, orders: 1, delivered: 1 };
  assert.deepEqual(JSON.parse(JSON.stringify(api.parseMetricRows(JSON.stringify([row])))), [row]);
  assert.deepEqual(JSON.parse(JSON.stringify(api.parseMetricRows(JSON.stringify([{ ...row, phone: 'synthetic' }])))), []);
  assert.deepEqual(JSON.parse(JSON.stringify(api.parseMetricRows(JSON.stringify([{ ...row, reach: 1e9 }])))), []);
  assert.deepEqual(JSON.parse(JSON.stringify(api.parseMetricRows(JSON.stringify([{ ...row, post: 'free_text' }])))), []);
  assert.deepEqual(JSON.parse(JSON.stringify(api.parseMetricRows('not json'))), []);
  const csv = api.formatCsv([row]);
  assert.ok(csv.startsWith('\ufeff'));
  assert.match(csv, /"رسم مقارنة الأحجام","2026-10-31","120"/);
  assert.doesNotMatch(csv, /phone|name|address|customer/i);
});
