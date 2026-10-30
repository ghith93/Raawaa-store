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

  assert.equal(paths.length, 41, '41 required shell resources are pre-cached');
  assert.ok(!paths.includes('/'), 'the root is not cached separately from index.html');
  assert.equal(imagePaths.length, 15, 'three formats for each of four product images plus the ritual scene');
  assert.ok(!allPaths.includes('/assets/brand/logo-'), 'unused brand SVGs are not pre-cached');
  assert.ok(!imagePaths.some((path) => /-(?:720|900|1080)\./.test(path) && !path.endsWith('/ritual-v5-720.jpg')),
    'large responsive variants are fetched and cached on demand');

  const coreBytes = await Promise.all(paths.map(async (path) => {
    try { return (await stat(new URL(`.${path}`, root))).size; }
    catch { return 0; } // /serum is a platform route, not a physical source file.
  }));
  assert.ok(coreBytes.reduce((sum, bytes) => sum + bytes, 0) < 700_000,
    'the full precache stays below the 700 KB source-size budget');
  const imageBytes = await Promise.all(imagePaths.map(async (path) =>
    stat(new URL(`.${path}`, root)).then((file) => file.size)));
  assert.ok(imageBytes.reduce((sum, bytes) => sum + bytes, 0) < 250_000,
    'pre-cached image payload stays below 250 KB');
});

test('offline root uses cached index.html while product and privacy routes remain cached', async () => {
  await installWorker();
  const home = await offlineRequest('/', 'navigate');
  assert.equal(await home.text(), 'cached:./index.html', 'root page resolves to the cached index without a duplicate root entry');
  const campaignHome = await offlineRequest('/?utm_campaign=offline-probe', 'navigate');
  assert.equal(await campaignHome.text(), 'cached:./index.html', 'query-bearing root also uses the clean cached index');

  const product = await offlineRequest('/serum', 'navigate');
  assert.equal(await product.text(), 'cached:./serum');

  const queried = await offlineRequest('/serum?utm_campaign=offline-probe', 'navigate');
  assert.equal(await queried.text(), 'cached:./serum', 'campaign query is not required for the cached page');

  const campaign = await offlineRequest('/campaign', 'navigate');
  assert.equal(await campaign.text(), 'cached:./campaign');
  const queriedCampaign = await offlineRequest('/campaign?utm_campaign=offline-probe', 'navigate');
  assert.equal(await queriedCampaign.text(), 'cached:./campaign', 'campaign route ignores tracking query when finding its cached shell');

  const privacy = await offlineRequest('/privacy.html', 'navigate');
  assert.equal(await privacy.text(), 'cached:./privacy.html');
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
