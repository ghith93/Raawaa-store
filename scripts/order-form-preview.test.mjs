import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const html = await readFile(new URL('docs/order-flow-prototype/index.html', root), 'utf8');
const configSource = await readFile(new URL('js/config.js', root), 'utf8');
const appSource = await readFile(new URL('docs/order-flow-prototype/app.js', root), 'utf8');
const offersSource = await readFile(new URL('js/offers.js', root), 'utf8');
const pricingSource = await readFile(new URL('order-system/order-pricing.js', root), 'utf8');
const previewServerSource = await readFile(new URL('scripts/marketing-studio-preview.py', root), 'utf8');

function makeElement(initial = {}) {
  return Object.assign({
    value: '', checked: false, textContent: '', href: '', listeners: {}, attributes: {}, children: [],
    addEventListener(type, callback) { this.listeners[type] = callback; },
    append(child) { this.children.push(child); if (this.children.length === 1 && ['product', 'delivery-zone', 'payment-method', 'scent-option', 'oil-option'].includes(this.id)) this.value = child.value; },
    setAttribute(name, value) { this.attributes[name] = value; },
    removeAttribute(name) { delete this.attributes[name]; }
  }, initial);
}

function bootPreview() {
  const ids = {};
  for (const id of ['order-form', 'product', 'product-reference', 'form-status', 'withdraw-link', 'customer-phone', 'processing-consent', 'marketing-consent', 'customer-name', 'customer-address', 'delivery-zone', 'payment-method', 'scent-option', 'oil-option', 'quantity', 'delivery-reference', 'payment-reference', 'customization-reference', 'estimate-products', 'estimate-scent', 'estimate-subtotal', 'estimate-discount', 'estimate-delivery', 'estimate-total', 'estimate-note']) {
    ids[id] = makeElement({ id, value: id === 'quantity' ? '1' : '' });
  }
  const form = ids['order-form'];
  form.checkValidity = () => true;
  form.reportValidity = () => {};
  form.reset = () => {
    ids['customer-phone'].value = '';
    ids['customer-name'].value = '';
    ids['customer-address'].value = '';
    ids['processing-consent'].checked = false;
    ids['marketing-consent'].checked = false;
    ids.product.value = ids.product.children[0]?.value || '';
    ids.quantity.value = '1';
    ids['delivery-zone'].value = ids['delivery-zone'].children[0]?.value || '';
    ids['payment-method'].value = ids['payment-method'].children[0]?.value || '';
    ids['scent-option'].value = ids['scent-option'].children[0]?.value || '';
    ids['oil-option'].value = ids['oil-option'].children[0]?.value || '';
  };
  const document = {
    readyState: 'complete',
    getElementById(id) { return ids[id] || null; },
    createElement(tag) { return makeElement({ tag }); },
    addEventListener() {}
  };
  const context = vm.createContext({ document, URL });
  context.window = context;
  const window = context;
  vm.runInContext(configSource, context);
  vm.runInContext(offersSource, context);
  vm.runInContext(pricingSource, context);
  vm.runInContext(appSource, context);
  return { api: window.RawaaOrderPreview, config: window.RAWAA_CONFIG, ids };
}

test('consents are separate: processing required, marketing optional and initially unchecked', () => {
  assert.match(html, /id="processing-consent"[^>]*required/);
  assert.match(html, /id="marketing-consent"[^>]*type="checkbox"[^>]*>/);
  const optional = html.match(/<input id="marketing-consent"[^>]*>/)?.[0] || '';
  assert.ok(optional);
  assert.doesNotMatch(optional, /\brequired\b|\bchecked\b/);
  assert.match(html, /تركه فارغًا لا يمنع معالجة الطلب/);
  assert.match(html, /لا تُسجّل أي موافقة/);
});

test('the local preview allowlists its pricing scripts while keeping network access disabled', () => {
  for (const [url, file] of [
    ['/js/config.js', 'js/config.js'],
    ['/js/offers.js', 'js/offers.js'],
    ['/order-system/order-pricing.js', 'order-system/order-pricing.js']
  ]) assert.ok(previewServerSource.includes(`"${url}": "${file}"`));
  assert.match(html, /connect-src 'none'/);
  assert.match(previewServerSource, /relative = ALLOWED\.get\(path\)/);
  assert.match(previewServerSource, /self\.send_error\(404\)/);
});

test('withdrawal link is a user-controlled WhatsApp draft, with no customer identifier', () => {
  const { api, config } = bootPreview();
  const url = new URL(api.buildWithdrawalUrl(config.contact.whatsappNumber));
  assert.equal(url.hostname, 'wa.me');
  assert.equal(url.pathname, '/' + config.contact.whatsappNumber);
  assert.match(url.searchParams.get('text'), /إلغاء موافقتي/);
  assert.equal(api.buildWithdrawalUrl('not-a-phone'), '');
  assert.doesNotMatch(url.href, /name=|phone=|address=|customer/i);
  assert.match(html, /لن تُرسل حتى تضغطي «إرسال» بنفسك/);
  assert.match(html, /غير مربوط بسجل إلغاء/);
});

test('local form validation discards synthetic fields and never calls network or storage', () => {
  const { api, config, ids } = bootPreview();
  assert.equal(ids.product.children.length, config.products.length);
  assert.equal(ids['product-reference'].textContent.includes(config.currency.symbol + config.products[0].price), true);
  assert.equal(api.validPhone('0991234567'), true);
  assert.equal(api.validPhone('٠٩٩١٢٣٤٥٦٧'), true);
  assert.equal(api.validPhone('letters-only'), false);
  assert.equal(ids['estimate-total'].textContent, '≈ $17');
  assert.equal(api.formatAmount(2340, config), '≈ $23');
  assert.equal(api.formatAmount(123400, config), '$1234');
  ids.quantity.value = '2';
  ids.quantity.listeners.input();
  assert.equal(ids['estimate-products'].textContent, '$38');
  assert.equal(ids['estimate-total'].textContent, '≈ $34');
  ids['payment-method'].value = 'cod';
  ids['scent-option'].value = 'vanilla';
  ids['payment-method'].listeners.change();
  assert.equal(ids['estimate-scent'].textContent, '$4');
  assert.equal(ids['estimate-total'].textContent, '$44');
  ids['oil-option'].value = 'argan';
  ids['oil-option'].listeners.change();
  assert.match(ids['estimate-note'].textContent, /لا يشمل الإجمالي إضافة الزيت/);

  ids['customer-name'].value = 'Synthetic Test';
  ids['customer-phone'].value = '0991234567';
  ids['customer-address'].value = 'Synthetic address';
  ids['processing-consent'].checked = true;
  ids['marketing-consent'].checked = true;
  let prevented = false;
  ids['order-form'].listeners.submit({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.match(ids['form-status'].textContent, /لم يُرسل الطلب/);
  assert.equal(ids['customer-name'].value, '');
  assert.equal(ids['customer-phone'].value, '');
  assert.equal(ids['customer-address'].value, '');
  assert.equal(ids['processing-consent'].checked, false);
  assert.equal(ids['marketing-consent'].checked, false);
  assert.doesNotMatch(appSource, /\bfetch\s*\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|indexedDB/);
});
