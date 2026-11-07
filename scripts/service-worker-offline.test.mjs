/**
 * Offline regression tests for the native service worker.
 * Runs the real sw.js in a tiny Cache API harness; it makes no network requests.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const swSource = await readFile(new URL('sw.js', root), 'utf8');
const origin = 'https://store.test';
const swUrl = `${origin}/sw.js`;
const cacheStores = new Map();
const listeners = new Map();
const keyOf = (request) => new URL(typeof request === 'string' ? request : request.url, swUrl).href;

function createCache() {
  const entries = new Map();
  return {
    entries,
    async add(request) {
      entries.set(keyOf(request), new Response(`cached:${request}`));
    },
    async match(request) {
      return entries.get(keyOf(request))?.clone();
    },
    async put(request, response) {
      entries.set(keyOf(request), response);
    }
  };
}

const caches = {
  async open(name) {
    if (!cacheStores.has(name)) cacheStores.set(name, createCache());
    return cacheStores.get(name);
  },
  async match(request) {
    for (const cache of cacheStores.values()) {
      const response = await cache.match(request);
      if (response) return response;
    }
    return undefined;
  },
  async keys() { return [...cacheStores.keys()]; },
  async delete(name) { return cacheStores.delete(name); }
};

const self = {
  location: new URL(swUrl),
  clients: { async claim() {} },
  addEventListener(type, handler) { listeners.set(type, handler); },
  async skipWaiting() {}
};

vm.runInNewContext(swSource, {
  self,
  caches,
  URL,
  Response,
  Promise,
  fetch: async () => { throw new TypeError('offline test: network disabled'); }
});

async function installWorker() {
  let task;
  listeners.get('install')({ waitUntil(promise) { task = promise; } });
  await task;
  return [...cacheStores.values()][0];
}

async function offlineRequest(path, mode = 'no-cors') {
  let responsePromise;
  const request = { method: 'GET', mode, url: `${origin}${path}` };
  listeners.get('fetch')({ request, respondWith(promise) { responsePromise = promise; } });
  return responsePromise;
}

test('install precaches only the compact offline shell and required small image fallbacks', async () => {
  const cache = await installWorker();
  const paths = [...cache.entries.keys()].map((key) => new URL(key).pathname);
  const imagePaths = paths.filter((path) => /\.(?:avif|webp|jpe?g)$/i.test(path));
  const allPaths = paths.join('\n');

  // العدد ثابت عمدًا: الزيادة تعني أصلًا جديدًا يُخزَّن لكل زيارة، وهذا قرار
  // واعٍ لا أثر جانبي. 43 ← 50 عند إضافة أصول الصفحات المستخرجة (7 نوفمبر 2026).
  assert.equal(paths.length, 50, '50 shell resources include the canonical root route, Hama landing page, and active logo');
  assert.ok(paths.includes('/'), 'canonical root is cached for offline reload after Pages redirects /index.html');
  assert.ok(paths.includes('/privacy'), 'canonical clean privacy route is cached for Pages .html redirects');
  assert.ok(!paths.includes('/privacy.html'), 'the redirected privacy alias is not relied on as a cache key');
  assert.ok(!paths.includes('/index.html'), 'the redirected index response is not duplicated in the offline shell');
  assert.equal(imagePaths.length, 15, 'three formats for each of four product images plus the ritual scene');
  assert.ok(paths.includes('/assets/brand/logo-primary-v2-dark.svg'), 'the active dark homepage logo is cached offline');
  assert.ok(!paths.some((path) => path.startsWith('/assets/brand/') && path !== '/assets/brand/logo-primary-v2-dark.svg'), 'unused brand SVGs are not pre-cached');
  assert.ok(!imagePaths.some((path) => /-(?:720|900|1080)\./.test(path) && !path.endsWith('/ritual-v5-720.jpg')),
    'large responsive variants are fetched and cached on demand');

  const coreBytes = await Promise.all(paths.map(async (path) => {
    try {
      const sourcePath = path === '/' ? './index.html' : `.${path}`;
      return (await stat(new URL(sourcePath, root))).size;
    } catch { return 0; } // Pages routes are not all physical source files.
  }));
  assert.ok(coreBytes.reduce((sum, bytes) => sum + bytes, 0) < 700_000,
    'the full precache stays below the 700 KB source-size budget');
  const imageBytes = await Promise.all(imagePaths.map(async (path) =>
    stat(new URL(`.${path}`, root)).then((file) => file.size)));
  assert.ok(imageBytes.reduce((sum, bytes) => sum + bytes, 0) < 250_000,
    'pre-cached image payload stays below 250 KB');
});

test('offline canonical root and query-bearing root use the root cache entry', async () => {
  await installWorker();
  const home = await offlineRequest('/', 'navigate');
  assert.equal(await home.text(), 'cached:./', 'canonical root is served from its exact pre-cached route');
  const campaignHome = await offlineRequest('/?utm_campaign=offline-probe', 'navigate');
  assert.equal(await campaignHome.text(), 'cached:./', 'query-bearing root resolves to the clean cached root');
  const index = await offlineRequest('/index.html', 'navigate');
  assert.equal(await index.text(), 'cached:./', 'direct index path falls back to the canonical offline root');

  const product = await offlineRequest('/serum', 'navigate');
  assert.equal(await product.text(), 'cached:./serum');

  const queried = await offlineRequest('/serum?utm_campaign=offline-probe', 'navigate');
  assert.equal(await queried.text(), 'cached:./serum', 'campaign query is not required for the cached page');

  const campaign = await offlineRequest('/campaign', 'navigate');
  assert.equal(await campaign.text(), 'cached:./campaign');
  const queriedCampaign = await offlineRequest('/campaign?utm_campaign=offline-probe', 'navigate');
  assert.equal(await queriedCampaign.text(), 'cached:./campaign', 'campaign route ignores tracking query when finding its cached shell');

  const privacy = await offlineRequest('/privacy.html', 'navigate');
  assert.equal(await privacy.text(), 'cached:./privacy', 'the .html alias falls back to the canonical clean privacy cache entry');
  const queriedPrivacy = await offlineRequest('/privacy.html?utm_campaign=offline-probe', 'navigate');
  assert.equal(await queriedPrivacy.text(), 'cached:./privacy', 'campaign queries do not prevent offline privacy fallback');
});

test('offline high-density images fall back to the cached small equivalent', async () => {
  await installWorker();
  const cases = [
    ['/assets/img/products/size-50-v6-900.jpg', '/assets/img/products/size-50-v6-480.jpg'],
    ['/assets/img/products/trio-v6-1080.avif', '/assets/img/products/trio-v6-480.avif'],
    ['/assets/img/products/ritual-v5-1080.jpg', '/assets/img/products/ritual-v5-720.jpg']
  ];

  for (const [requested, fallback] of cases) {
    const response = await offlineRequest(requested);
    assert.ok(response, `${requested} returns an offline response`);
    assert.equal(await response.text(), `cached:./${fallback.slice(1)}`, `${requested} uses ${fallback}`);
  }
});

/* ── تغطية: كل صفحة مخزّنة يجب أن تكون أصولها المخزّنة كاملة ──────────────────
 *
 * العطل الذي أوجب هذا الحارس (7 نوفمبر 2026): بعد إخراج <style> و<script> من
 * الصفحات إلى ملفات، بقيت قائمة CORE كما هي. النتيجة أن الزائرة التي تحفظ
 * الموقع — أو تنقط�� عنها الشبكة — تحصل على صفحة مخزّنة **بلا تنسيق وبلا
 * سكربت**، وصفحة المنتج بلا `js/pricing-policy.js`: أي أن حساب التوصيل
 * والخصم يسقط على الرفض الآلي بلا أي رسالة خطأ.
 *
 * الحارس كان يفحص **وجود** ما في القائمة، لا **تغطية** ما تحتاجه الصفحات.
 * الوجود لا يكفي: قائمة صحيحة تمامًا لصفحات تغيّرت أصولها.
 */
test('كل صفحة في CORE مخزّنة مع كل ملفات CSS/JS التي تطلبها', async () => {
  const cache = await installWorker();
  const cached = new Set([...cache.entries.keys()].map((key) => new URL(key).pathname));
  const pageFiles = { '/': './index.html', '/serum': './serum.html', '/campaign': './campaign.html',
    '/hama': './hama.html', '/privacy': './privacy.html', '/404.html': './404.html' };
  const missing = [];
  for (const [route, file] of Object.entries(pageFiles)) {
    assert.ok(cached.has(route), `${route} يجب أن تكون في الذاكرة أولًا`);
    const html = await readFile(new URL(file, root), 'utf8');
    const refs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)]
      .map((m) => m[1].split('?')[0])
      .filter((ref) => /\.(?:css|js)$/.test(ref) && !/^(?:https?:|\/\/)/.test(ref))
      .map((ref) => new URL(ref, `${origin}${route}`).pathname);
    for (const ref of new Set(refs)) {
      if (!cached.has(ref)) missing.push(`${route} → ${ref}`);
    }
  }
  assert.deepEqual(missing, [],
    `صفحات مخزّنة تعتمد ملفات غير مخزّنة (ستظهر بلا تنسيق أو بلا وظيفة بلا إنترنت):\n${missing.join('\n')}`);
});

test('كل ملف في CORE موجود فعلًا على القرص', async () => {
  const cache = await installWorker();
  const gone = [];
  for (const key of cache.entries.keys()) {
    const path = new URL(key).pathname;
    if (!/\.(?:css|js|svg|png|woff2)$/.test(path)) continue; // مسارات الصفحات تُعاد توجيهها في Pages
    try {
      const info = await stat(new URL(`.${path}`, root));
      assert.ok(info.size > 0);
    } catch { gone.push(path); }
  }
  assert.deepEqual(gone, [], `CORE يشير إلى ملفات غير موجودة أو فارغة:\n${gone.join('\n')}`);
});
