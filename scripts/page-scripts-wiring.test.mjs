/*
 * فحص ربط سكربتات الصفحات — بديل جزئي عن المتصفح، يعمل في CI بلا Playwright.
 *
 * الدافع: بعد إخراج <script> المضمّن من الصفحات إلى ملفات خارجية (لإزالة الحاجة
 * إلى script-src 'unsafe-inline')، صار الربط قابلًا للكسر بصمت: مسار خاطئ، أو
 * ترتيب تحميل مختلف، أو سكربت يعتمد على عنصر لم يعد موجودًا. لا شيء يكشف ذلك
 * إلا متصفح حقيقي.
 *
 * هذا الفحص يحمّل كل صفحة منشورة في jsdom **بنفس ترتيب المتصفح**، وينفّذ
 * سكربتاتها المحلية، ويفشل عند أي استثناء. وقد أثبت قيمته فعلًا: كشف أن
 * check.html كان يتوقف كله إذا أعادت canvas قيمة null.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(resolve(ROOT, path), 'utf8');

/** الصفحات التي تُنشر ولها سكربتات محلية. */
const PAGES = ['index.html', 'privacy.html', 'setup.html', 'check.html', 'serum.html'];

function boot(page) {
  const html = read(page);
  const dom = new JSDOM(html, {
    url: 'https://raawaa-store.pages.dev/',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const { window } = dom;
  window.matchMedia = window.matchMedia || (() => ({
    matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}
  }));
  window.scrollTo = () => {};

  const errors = [];
  window.addEventListener('error', event => errors.push(String(event.message)));

  // نُنفّذ <script src> المحلية بالترتيب نفسه الذي يتبعه المتصفح.
  const sources = [...html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)]
    .map(match => match[1])
    .filter(src => !/^https?:/.test(src));

  const executed = [];
  for (const src of sources) {
    const file = resolve(ROOT, src.replace(/^\//, ''));
    assert.ok(existsSync(file), `${page}: src مفقود — ${src}`);
    try {
      window.eval(readFileSync(file, 'utf8'));
      executed.push(src);
    } catch (error) {
      errors.push(`${src}: ${error.message}`);
    }
  }
  return { window, errors, executed };
}

test('كل صفحة تُنفّذ سكربتاتها بلا استثناء', () => {
  const failures = [];
  for (const page of PAGES) {
    const { window, errors } = boot(page);
    if (errors.length) failures.push(`${page}: ${errors.slice(0, 2).join(' | ')}`);
    window.close();
  }
  assert.deepEqual(failures, [], `\n${failures.join('\n')}\n`);
});

test('السكربتات المستخرجة مربوطة فعلًا وبعدد معقول', () => {
  // فحص إيجابي: لو نُسي وسم script، لما نُفّذ شيء ولن يفشل الاختبار السابق.
  const expected = {
    'index.html': 'js/index-inline.js',
    'privacy.html': 'js/privacy-inline.js',
    'setup.html': 'js/setup-inline.js',
    'check.html': 'js/check-inline.js',
    'serum.html': 'js/serum-inline.js'
  };
  for (const [page, script] of Object.entries(expected)) {
    const { executed, window } = boot(page);
    assert.ok(executed.includes(script), `${page} لم يُنفّذ ${script}`);
    assert.ok(executed.length >= 1, `${page} بلا سكربتات منفَّذة`);
    window.close();
  }
});

test('أزرار الصفحات تعمل بلا onclick سطري', () => {
  // بعد استبدال onclick="" بمستمعات، يجب أن تكون العناصر التي تعتمد عليها موجودة.
  const { window } = boot('setup.html');
  for (const id of ['genBtn', 'copySecret', 'genRateBtn', 'copyRate']) {
    assert.ok(window.document.getElementById(id), `setup.html: زر #${id} مفقود`);
  }
  const marker = window.document.querySelector('[data-copy-text]');
  assert.ok(marker, 'setup.html: لا عنصر data-copy-text — النسخ سيتعطّل');
  assert.ok(marker.getAttribute('data-copy-text'), 'data-copy-text بلا قيمة');
  window.close();
});

test('صفحة التشخيص تكمل تقريرها حتى لو فشل مسبار canvas', () => {
  const { window, errors } = boot('check.html');
  assert.deepEqual(errors, [], 'سكربت التشخيص انهار');
  // jsdom بلا حزمة canvas: toDataURL يعيد null. الصفحة يجب أن تصمد وتكتب النتيجة.
  const avif = window.document.getElementById('avif');
  assert.ok(avif && avif.innerHTML.length > 0, 'خانة avif لم تُكتب — المسبار أسقط الصفحة');
  window.close();
});

test('سنة التذييل تُملأ من السكربت لا يدويًا', () => {
  const { window } = boot('privacy.html');
  const node = window.document.querySelector('[data-current-year]');
  if (node) assert.match(node.textContent, /^20\d\d$/, 'السنة لم تُحدَّث');
  window.close();
});
