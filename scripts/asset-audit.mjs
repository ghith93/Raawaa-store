#!/usr/bin/env node
/**
 * تدقيق الأصول على الموقع الحيّ — عند الزبون، لا عندنا.
 *
 * لماذا ملف منفصل؟ لأن الأخطاء التي حدثت فعلًا (خطوط لا تُنشر، تحويل يلطش الصور
 * الجديدة) لم تكشفها البوابات المحلية: الملف موجود محليًا لكنه غير منشور.
 * هذا الفحص يطلب الموقع الحيّ نفسه ويعتبر أي 4xx/5xx عيبًا.
 */
const BASE = process.argv[2] || 'https://raawaa-store.pages.dev';
const targets = ['', '/serum', '/css/styles.css', '/css/serum.css', '/js/config.js', '/js/cart.js', '/js/marketing.js'];
const seen = new Set();
let bad = 0, total = 0;

async function text(path) {
  const r = await fetch(BASE + path, { headers: { 'user-agent': 'raawaa-asset-audit' } });
  return r.ok ? r.text() : '';
}

const blobs = await Promise.all(targets.map(text));
for (const blob of blobs) {
  for (const m of blob.matchAll(/(assets\/[A-Za-z0-9._/-]+\.(?:avif|webp|jpg|jpeg|png|svg|woff2))/g)) {
    seen.add(m[1]);
  }
}

const results = await Promise.all([...seen].sort().map(async (p) => {
  try {
    const r = await fetch(`${BASE}/${p}`, { method: 'GET', headers: { 'user-agent': 'raawaa-asset-audit' } });
    return { p, status: r.status };
  } catch (e) { return { p, status: 'ERR' }; }
}));

total = results.length;
for (const r of results) {
  if (r.status !== 200) { bad++; console.log(`  ✗ ${r.status}  ${r.p}`); }
}

console.log(`\n  أصول مُشار إليها: ${total} · سليمة: ${total - bad} · معطوبة: ${bad}`);
if (bad > 0) { console.error('\n✗ أصول معطوبة على الموقع الحيّ'); process.exit(1); }
console.log('✓ كل الأصول تُفتح على الموقع الحيّ');
