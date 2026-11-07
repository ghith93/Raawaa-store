/**
 * اختبار واجهة محرّر الأسعار في DOM حقيقي (jsdom).
 *
 * لماذا؟ الاختبارات السابقة تغطي المنطق الخالص، لكن الواجهة قد تربط الحقل الخطأ
 * أو تعرض جدولًا فارغًا. هذا الملف ينفّذ owner/pricing-tool.mjs فعليًا على
 * owner/pricing.html ويتحقق من الأثر الظاهر.
 *
 * حدّ صريح: jsdom ليس متصفحًا. لا يثبت المظهر أو التمرير أو سلوك الهاتف.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const root = new URL('../', import.meta.url);
const html = await readFile(new URL('owner/pricing.html', root), 'utf8');
const configSource = await readFile(new URL('js/config.js', root), 'utf8');

/** يزرع الصفحة ويشغّل الأدوات، ثم يعيد الوثيقة والنوافذ. */
async function bootTool() {
  const dom = new JSDOM(html, { url: 'https://owner.test/owner/pricing.html', runScripts: 'outside-only' });
  const { window } = dom;
  window.fetch = async (url) => {
    const target = String(url);
    if (target.endsWith('/js/config.js') || target.endsWith('js/config.js')) {
      return { ok: true, status: 200, text: async () => configSource };
    }
    return { ok: false, status: 404, text: async () => '' };
  };
  // نستورد الوحدة بعد تجهيز globals لأنها تنفّذ boot() عند الاستيراد.
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.fetch = window.fetch;
  globalThis.HTMLElement = window.HTMLElement;
  const moduleUrl = new URL('owner/pricing-tool.mjs?v=' + Date.now(), root).href;
  await import(moduleUrl);
  // انتظار انتهاء التحميل غير المتزامن (fetch + الإعدادات).
  for (let i = 0; i < 50; i += 1) {
    if (window.document.getElementById('impact').querySelector('tbody')) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return window;
}

test('the tool renders one input per size, seeded from config', async () => {
  const window = await bootTool();
  const doc = window.document;
  const inputs = [...doc.querySelectorAll('[data-price-for]')];
  assert.equal(inputs.length, 3);
  const byId = Object.fromEntries(inputs.map((i) => [i.dataset.priceFor, i.value]));
  assert.deepEqual(byId, { 'serum-30': '13', 'serum-50': '16', 'serum-100': '25' });
});

test('the impact table shows the real customer total for every combination', async () => {
  const window = await bootTool();
  const doc = window.document;
  const rows = [...doc.querySelectorAll('#impact tbody tr')];
  assert.equal(rows.length, 12, '3 أحجام × 2 مناطق × 2 طرق دفع');

  const readRow = (tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent);
  // 50 مل + حماة + شام كاش: 16 − 1.60 = 14.40، توصيل مجاني
  const target = rows.map(readRow).find((cells) => cells[0] === '50 مل' && cells[1] === 'حماة' && cells[2] === 'شام كاش');
  assert.ok(target, 'يجب وجود صف 50 مل/حماة/شام كاش');
  assert.equal(target[3], '$16');
  assert.equal(target[4], '− $1.6');
  assert.equal(target[5], 'مجاني');
  assert.equal(target[6], '$14.4');
});

test('delivery is free in every rendered row under the approved policy', async () => {
  const window = await bootTool();
  const doc = window.document;
  const deliveryCells = [...doc.querySelectorAll('#impact tbody tr')]
    .map((tr) => tr.querySelectorAll('td')[5].textContent);
  assert.ok(deliveryCells.length > 0);
  assert.ok(deliveryCells.every((cell) => cell === 'مجاني'), 'كل الصفوف يجب أن تكون مجانية');
});

test('an invalid price surfaces an error and never silently updates the table', async () => {
  const window = await bootTool();
  const doc = window.document;
  const input = doc.querySelector('[data-price-for="serum-50"]');
  input.value = '-5';
  input.dispatchEvent(new window.Event('input'));
  const errors = doc.getElementById('price-errors').textContent;
  assert.match(errors, /أكبر من صفر/);
  // الجدول يعود للسعر الصالح، لا إلى سالب.
  const row = [...doc.querySelectorAll('#impact tbody tr')]
    .map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent))
    .find((cells) => cells[0] === '50 مل' && cells[2] === 'شام كاش');
  assert.equal(row[3], '$16');
});

test('changing a price updates the customer total immediately', async () => {
  const window = await bootTool();
  const doc = window.document;
  const input = doc.querySelector('[data-price-for="serum-50"]');
  input.value = '20';
  input.dispatchEvent(new window.Event('input'));
  const row = [...doc.querySelectorAll('#impact tbody tr')]
    .map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent))
    .find((cells) => cells[0] === '50 مل' && cells[1] === 'حماة' && cells[2] === 'شام كاش');
  assert.equal(row[3], '$20');
  assert.equal(row[6], '$18');
  assert.match(doc.getElementById('summary').textContent, /زيادة/);
});

test('adding an invalid offer is refused with a visible reason', async () => {
  const window = await bootTool();
  const doc = window.document;
  doc.getElementById('offer-id').value = 'over-cap';
  doc.getElementById('offer-label').value = 'عرض مبالغ فيه';
  doc.getElementById('offer-type').value = 'percent';
  doc.getElementById('offer-value').value = '90';
  doc.getElementById('offer-enabled').checked = true;
  doc.getElementById('offer-form').dispatchEvent(new window.Event('submit', { cancelable: true }));
  assert.match(doc.getElementById('offer-errors').textContent, /السقف/);
  assert.equal(doc.querySelectorAll('.offer-row').length, 0, 'العرض المرفوض لا يُضاف للقائمة');
});

test('adding a valid offer is accepted and summarised for review', async () => {
  const window = await bootTool();
  const doc = window.document;
  doc.getElementById('offer-id').value = 'launch-15';
  doc.getElementById('offer-label').value = 'عرض الإطلاق';
  doc.getElementById('offer-type').value = 'percent';
  doc.getElementById('offer-value').value = '15';
  doc.getElementById('offer-enabled').checked = true;
  doc.getElementById('offer-form').dispatchEvent(new window.Event('submit', { cancelable: true }));
  assert.equal(doc.querySelectorAll('.offer-row').length, 1);
  assert.equal(doc.getElementById('offer-errors').textContent, '');
  assert.match(doc.getElementById('summary').textContent, /العروض المفعّلة/);
});

test('the output block never claims to have saved or published anything', async () => {
  const window = await bootTool();
  const doc = window.document;
  const note = doc.querySelector('.demo').textContent;
  assert.match(note, /لا يغيّر الموقع لحظيًا/);
  const output = doc.getElementById('output').textContent;
  assert.doesNotMatch(output, /تم الحفظ|تم النشر|نُشر/);
});
