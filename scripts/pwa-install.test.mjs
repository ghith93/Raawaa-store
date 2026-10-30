import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const source = await readFile(new URL('../js/pwa-install.js', import.meta.url), 'utf8');

function setup({ standalone = false } = {}) {
  const dom = new JSDOM(`<!doctype html><button data-pwa-install hidden>تثبيت رواء</button>
    <span data-pwa-install-status aria-live="polite"></span>
    <a href="#install-app">إرشادات التثبيت اليدوي</a>`, {
    runScripts: 'outside-only',
    url: 'https://raawaa-store.test/'
  });
  dom.window.matchMedia = () => ({ matches: standalone });
  dom.window.eval(source);
  return {
    dom,
    button: dom.window.document.querySelector('[data-pwa-install]'),
    status: dom.window.document.querySelector('[data-pwa-install-status]')
  };
}

function dispatchInstallPrompt(window, { outcome = 'accepted', reject = false } = {}) {
  let calls = 0;
  const event = new window.Event('beforeinstallprompt', { cancelable: true });
  event.prompt = () => {
    calls += 1;
    return reject ? Promise.reject(new Error('prompt unavailable')) : Promise.resolve();
  };
  event.userChoice = Promise.resolve({ outcome });
  window.dispatchEvent(event);
  return { event, calls: () => calls };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test('shows a native install button only after a browser prompt is available', () => {
  const { dom, button } = setup();
  assert.equal(button.hidden, true);
  const { event } = dispatchInstallPrompt(dom.window);
  assert.equal(event.defaultPrevented, true, 'the browser prompt waits for an explicit click');
  assert.equal(button.hidden, false);
  dom.window.close();
});

test('opens the deferred prompt once and hides the button after the choice', async () => {
  const { dom, button } = setup();
  const prompt = dispatchInstallPrompt(dom.window);
  button.click();
  assert.equal(button.hidden, true, 'do not leave a dead prompt button visible');
  assert.equal(button.disabled, true, 'prevent duplicate prompt calls');
  await flush();
  assert.equal(prompt.calls(), 1);
  assert.equal(button.disabled, false);
  dom.window.dispatchEvent(new dom.window.Event('appinstalled'));
  assert.equal(button.hidden, true);
  assert.match(dom.window.document.querySelector('[aria-live]').textContent, /أُضيف تطبيق رواء/);
  dom.window.close();
});

test('keeps the manual instructions available when the browser has no install prompt', () => {
  const { dom, button } = setup();
  assert.equal(button.hidden, true);
  assert.equal(dom.window.document.querySelector('a[href="#install-app"]').textContent, 'إرشادات التثبيت اليدوي');
  dom.window.close();
});

test('does not surface the prompt in an already-installed standalone app', () => {
  const { dom, button } = setup({ standalone: true });
  dispatchInstallPrompt(dom.window);
  assert.equal(button.hidden, true);
  dom.window.close();
});

test('announces a fallback when a browser fails to open its install prompt', async () => {
  const { dom, button, status } = setup();
  dispatchInstallPrompt(dom.window, { reject: true });
  button.click();
  await flush();
  assert.match(status.textContent, /تعذّر فتح نافذة التثبيت/);
  assert.equal(button.hidden, true);
  dom.window.close();
});
