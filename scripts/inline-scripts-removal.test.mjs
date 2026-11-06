/**
 * حارس السكربتات المنقولة من HTML المضمّن — يمنع «نقلًا صامتًا» يكسر السلوك.
 *
 * سياق: لإزالة `'unsafe-inline'` من CSP نُقلت أربع كتل مضمّنة إلى ملفات خارجية.
 * خطر هذا النوع من الترحيل أنه **يبدو** نظيفًا في HTML بينما الوظيفة لم تعد
 * تعمل: زر بلا معالج، سنة لا تتحدّث، قائمة لا تفتح. لا فحص ثابت يكشف ذلك،
 * ولذلك نُشغّل الملفات فعلًا في DOM حقيقي (jsdom) ونتحقق من الأثر.
 *
 * القيود المعلنة: هذه محاكاة DOM في Node، ليست متصفحًا. لا تُغني عن اختبار
 * Chromium في CI؛ لكنها تكشف فئة «الملف موجود ولا يفعل شيئًا».
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const root = new URL('../', import.meta.url);
const read = (p) => readFile(new URL(p, root), 'utf8');

/** يحمّل صفحة ثم ينفّذ سكربتًا خارجيًا بعد بناء DOM، ويعيد {window, document}. */
async function loadPage(page, scripts, { beforeScript } = {}) {
  const html = await read(page);
  // لا نشغّل موردات الشبكة: ننزع كل <script src> و<noscript> من المصدر.
  const stripped = html.replace(/<script\b[^>]*\bsrc=[^>]*>\s*<\/script>/gi, '');
  // origin حقيقي (http) لازم: js/sw-register.js لا يسجّل العامل على about: أو file:
  // وهذا سلوك مقصود — لا نريد للنسخة المفتوحة من القرص أن تثبّت عامل خدمة.
  const dom = new JSDOM(stripped, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://raawaa-store.pages.dev/serum' });
  for (const script of scripts) {
    const code = await read(script);
    const fn = new dom.window.Function(code);
    if (beforeScript) beforeScript(dom.window, dom.window.document);
    fn.call(dom.window);
  }
  return dom;
}

test('js/nav.js opens and closes the mobile menu through real clicks', async () => {
  const dom = await loadPage('index.html', ['js/nav.js'], {
    beforeScript(window) {
      // jsdom's window.Function runs in the page realm; run after DOM exists.
      window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
    }
  });
  const { document, Event } = dom.window;
  const toggle = document.getElementById('navToggle');
  const nav = document.getElementById('mobileNav');
  assert.ok(toggle, 'navToggle must exist');
  assert.ok(nav, 'mobileNav must exist');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');

  toggle.dispatchEvent(new Event('click', { bubbles: true }));
  assert.equal(nav.classList.contains('open'), true, 'menu opens on click');
  assert.equal(nav.hidden, false, 'menu is visible when open');
  assert.equal(toggle.getAttribute('aria-expanded'), 'true', 'aria-expanded tracks state');

  toggle.dispatchEvent(new Event('click', { bubbles: true }));
  assert.equal(nav.classList.contains('open'), false, 'menu closes on second click');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
});

test('js/page-meta.js writes the current year into the marked node', async () => {
  const dom = await loadPage('privacy.html', ['js/page-meta.js']);
  const node = dom.window.document.querySelector('[data-current-year]');
  assert.ok(node, 'privacy.html must keep a [data-current-year] hook');
  assert.equal(node.textContent, String(new Date().getFullYear()));
});

test('js/consent.js wires the consent buttons to the existing global handler', async () => {
  const dom = await loadPage('serum.html', ['js/consent.js'], {
    beforeScript(window) {
      window.__calls = [];
      window.rawaaConsent = (granted) => window.__calls.push(granted);
      window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
    }
  });
  const { document, Event, __calls: calls } = dom.window;
  const grant = document.querySelector('[data-consent-grant]');
  const deny = document.querySelector('[data-consent-deny]');
  assert.ok(grant, 'a consent-grant button must exist on the product page');
  assert.ok(deny, 'a consent-deny button must exist on the product page');

  grant.dispatchEvent(new Event('click', { bubbles: true }));
  deny.dispatchEvent(new Event('click', { bubbles: true }));
  assert.deepEqual(calls, [true, false], 'both consent paths reach the global handler');
});

test('js/sw-register.js registers the service worker without throwing', async () => {
  const registered = [];
  const dom = await loadPage('serum.html', ['js/sw-register.js'], {
    beforeScript(window) {
      Object.defineProperty(window.navigator, 'serviceWorker', {
        configurable: true,
        value: { register: (url) => { registered.push(url); return Promise.resolve(); } }
      });
    }
  });
  dom.window.dispatchEvent(new dom.window.Event('load'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(registered, ['sw.js'], 'the worker must be registered on load');
});

test('no inline script or inline handler survives on any published page', async () => {
  const pages = ['index.html', 'serum.html', 'campaign.html', 'hama.html', 'privacy.html', '404.html'];
  for (const page of pages) {
    const html = await read(page);
    const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*application\/ld\+json)[^>]*>[\s\S]*?<\/script>/gi)];
    assert.equal(inline.length, 0, `${page}: inline <script> would require 'unsafe-inline'`);
    assert.ok(!/(?:^|\s)on(?:click|load|error|change|submit|input)\s*=/i.test(html),
      `${page}: inline event handler would require 'unsafe-inline'`);
    assert.ok(!/\sstyle="/i.test(html), `${page}: inline style attribute would require style-src 'unsafe-inline'`);
  }
});
