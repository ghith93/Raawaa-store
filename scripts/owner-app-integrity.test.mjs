/**
 * حارس تكامل لوحة المالك — يمنع عودة النسخ المتباعدة.
 *
 * التاريخ: كان للمالك ثلاث نسخ من نفس التطبيق:
 *   owner/                    ← المنشورة فعلًا
 *   order-system/owner-app/   ← نسخة قريبة لكنها **بلا تحقق من original**
 *   order-system/owner-preview/ ← نسخة ثالثة لا يعرفها التوثيق
 * الفرق الأخطر: نسخة `order-system` لم تكن تتحقق من `location.origin`، فلو
 * نُشرت من أي نطاق لعملت. حُذفت النسختان في ٦ نوفمبر ٢٠٢٦، وهذا الملف يضمن
 * ألا تعودا صامتتين، وأن الملف المنشور يبقى محميًا.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, access } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (p) => readFile(new URL(p, root), 'utf8');
const exists = async (p) => { try { await access(new URL(p, root)); return true; } catch { return false; } };

test('only one owner application exists in the repository', async () => {
  assert.equal(await exists('order-system/owner-app'), false, 'duplicate owner app reappeared');
  assert.equal(await exists('order-system/owner-preview'), false, 'owner preview reappeared');
});

test('the published owner app fails closed on any origin but its own', async () => {
  const app = await read('owner/app.mjs');
  assert.match(app, /location\.origin\s*===\s*settings\.ownerOrigin/,
    'owner/app.mjs must compare the runtime origin before creating a client');
  assert.match(app, /catch\s*\{\s*\/\*[^*]*\*\/\s*\}/, 'configuration must fail closed in a try/catch');
});

test('the order-system client stays a re-export so the two cannot drift', async () => {
  const shim = await read('order-system/owner-client.mjs');
  assert.match(shim, /export\s*\{\s*createOwnerClient\s*\}\s*from\s*'\.\.\/owner\/owner-client\.mjs'/,
    'order-system/owner-client.mjs must re-export the single implementation');
  const implementations = (await readdir(new URL('order-system/', root)))
    .filter((f) => /owner-client\.mjs$/.test(f));
  assert.deepEqual(implementations, ['owner-client.mjs']);
});

test('the owner settings file carries no secret material', async () => {
  const settings = await read('owner/settings.mjs');
  assert.match(settings, /publishableKey/, 'expected a publishable (public) key only');

  // نفحص قيمة المفتاح لا تعليق الملف: التعليق يشرح «لا أسرار هنا» فيذكر الكلمة.
  const keys = [...settings.matchAll(/(?:publishableKey|serviceRoleKey|anonKey|secret|token)\s*:\s*'([^']*)'/gi)]
    .map((m) => m[1]);
  for (const key of keys) {
    assert.ok(!/^eyJhbGciOiJ/.test(key) || key.length < 200,
      'a raw JWT (possibly a service role) must never be committed');
    assert.ok(!/^sb_secret_/.test(key), 'a secret Supabase key must never be committed');
  }
  assert.ok(!/service_role/i.test(settings), 'no service role key reference in client code');
});

test('the owner page is excluded from indexing and caching at the edge', async () => {
  const headers = await read('_headers');
  const ownerBlock = headers.split('/owner/*')[1] || '';
  assert.match(ownerBlock, /X-Robots-Tag:\s*noindex/, 'owner routes must stay noindex');
  assert.match(ownerBlock, /Cache-Control:\s*no-store/, 'owner routes must not be cached');
  assert.match(ownerBlock, /frame-ancestors 'none'/, 'owner page must not be frameable');
});

test('the service worker never caches the owner dashboard', async () => {
  const sw = await read('sw.js');
  assert.match(sw, /startsWith\('\/owner\/'\)/, 'service worker must skip /owner/ paths');
  assert.match(sw, /startsWith\('\/api\/'\)/, 'service worker must skip /api/ paths');
});
