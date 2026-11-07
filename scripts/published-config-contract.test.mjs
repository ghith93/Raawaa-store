/**
 * حارس العقد بين البناء والمراقبة.
 *
 * هذا الملف موجود لأن عطلًا حقيقيًا عاش ٥ دورات مراقبة دون اكتشاف:
 * البناء ينشر `config.js` بصياغة JSON، والمراقب يقرأه بتعبيرات نمطية تفترض
 * صياغة المصدر. كل الاختبارات كانت تفحص «دالة الاستخراج على نص المصدر» فقط،
 * فلم يلمس أي اختبار **مخرَج البناء** نفسه. الأمر ليس تفصيلًا نظريًا: كل دورة
 * فاشلة كانت تفتح تنبيهًا كاذبًا على `main`.
 *
 * القاعدة التي يحرسها هذا الملف:
 *   ١. نسخة النشر مقروءة بدالة المراقبة نفسها، لا بمنطق موازٍ.
 *   ٢. قيم الطلب الحرجة في نسخة النشر مطابقة للمصدر تمامًا.
 *   ٣. الحقول الداخلية غائبة، وأي حقل داخلي جديد غير مسجّل يفشل هنا.
 *   ٤. الصياغة الغريبة والملفات الضخمة تفشل مغلقًا، لا تُمرَّر بصمت.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile as read } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPublishedConfig, renderPublishedConfig, detectConfigFormat, MAX_PUBLISHED_BYTES } from './lib/public-config.mjs';
import { readOrderConfig, diffOrderConfig, extractOrderConfig, orderConfigFromObject } from './order-config-monitor.mjs';

const source = await readFile(new URL('../js/config.js', import.meta.url), 'utf8');
const built = renderPublishedConfig(source);

test('the published config is readable by the same monitor that reads the source', () => {
  const fromSource = readOrderConfig(source, { label: 'source' });
  const fromPublished = readOrderConfig(built.output, { label: 'published' });
  assert.deepEqual(fromPublished, fromSource);
});

test('published and source agree on every order-critical value', () => {
  assert.deepEqual(diffOrderConfig(readOrderConfig(source), readOrderConfig(built.output)), []);
});

test('format detection names the two shapes and refuses anything else', () => {
  assert.equal(detectConfigFormat(source), 'source');
  assert.equal(detectConfigFormat(built.output), 'published');
  for (const bogus of ['', '   ', '{"hello":"world"}', 'const x = 1;', 'products: [\n],']) {
    assert.throws(() => detectConfigFormat(bogus), /الإعدادات/);
  }
});

test('the old source-only regex would have failed here — proof the bug was real', () => {
  // This is the exact defect: strict source parsing on machine-generated JSON.
  assert.throws(() => extractOrderConfig(built.output), /whatsappNumber/);
  // ...while the contract reader succeeds on the same bytes.
  assert.doesNotThrow(() => readOrderConfig(built.output));
});

test('structural order data survives publishing unchanged', () => {
  // نتحقق من **البنية** لا من قيم السياسة. الأسعار والرسوم والخصومات ملك المالك
  // وتتغيّر بقراره (مثل تغيير رسم حماة)، فحارس العقد يجب أن يبقى أخضر وقتها.
  // قيم السياسة نفسها محروسة في scripts/order-config-monitor.test.mjs وصفحة الأسعار.
  const live = readPublishedConfig(built.output);
  assert.deepEqual(live.products.map(p => p.id), ['serum-30', 'serum-50', 'serum-100']);
  assert.deepEqual(live.products.map(p => p.sizeMl), [30, 50, 100]);
  assert.deepEqual(live.delivery.zones.map(z => z.id).sort(), ['hama', 'other']);
  assert.deepEqual(live.payment.methods.map(m => m.id).sort(), ['cod', 'shamcash']);
  assert.equal(typeof live.contact.whatsappNumber, 'string');
});

test('every policy value in the published file is identical to the source', () => {
  // البديل الصحيح عن تثبيت الأرقام: أي قيمة سياسة يقررها المالك يجب أن تصل
  // للنسخة المنشورة حرفيًا. هذا يبقى صحيحًا مهما تغيّرت الأرقام.
  const live = readPublishedConfig(built.output);
  const fromSource = JSON.parse(JSON.stringify(built.publicConfig));
  assert.deepEqual(live.products, fromSource.products);
  assert.deepEqual(live.delivery, fromSource.delivery);
  assert.deepEqual(live.payment, fromSource.payment);
});

test('internal cost and integration notes never reach the published file', () => {
  assert.ok(!built.output.includes('costing'), 'costing leaked into published config');
  assert.ok(!built.output.includes('apiNote'), 'apiNote leaked into published config');
  assert.ok(!built.output.includes('unitCost'), 'cost fields leaked into published config');
  assert.deepEqual(built.removed.sort(), ['costing', 'payment.methods[].apiNote']);
});

test('the published file is frozen against runtime mutation', () => {
  // deepFreeze is part of the contract: a public config that can be mutated at
  // runtime would let any injected script rewrite prices in the DOM.
  assert.match(built.output, /Object\.freeze/);
  assert.match(built.output, /deepFreeze/);
});

/**
 * يطبّق تعديلًا نصيًا على المصدر ويشترط أنه حدث فعلًا.
 *
 * السبب: الاختبارات كانت تبحث عن قيمة حرفية (`price: 16`). حين يغيّر المالك
 * السعر أو رسم حماة، لا يجد `.replace` شيئًا فيمرّ بلا تعديل ويصير الاختبار
 * أخضر كاذبًا أو أحمر بلا سبب. هنا نشتق القيمة من المصدر نفسه ونفشل إن لم نجدها.
 */
function mutate(sourceText, pattern, replacer, label) {
  assert.match(sourceText, pattern, `تعذّر إيجاد ${label} في المصدر — حدّث النمط`);
  return sourceText.replace(pattern, replacer);
}

test('a price change in the source flows into the published file and is detected', () => {
  const current = readOrderConfig(source).products.find(p => p.id === 'serum-50').price;
  // استهدف كتلة المنتج المحدد لا أول `price:` في الملف (ترتيب الأحجام قابل للتغيير).
  const raised = mutate(
    source,
    /(id: 'serum-50',[\s\S]*?\bprice: )[\d.]+/,
    `$1${current + 1}`,
    'سعر 50 مل'
  );
  const published = readOrderConfig(renderPublishedConfig(raised).output);
  assert.deepEqual(diffOrderConfig(readOrderConfig(source), published), ['products']);
  assert.equal(published.products.find(p => p.id === 'serum-50').price, current + 1);
});

test('a delivery or payment change in the source is detected on the published side', () => {
  const sourceConfig = readOrderConfig(source);
  const otherFee = sourceConfig.zones.find(z => z.id === 'other').fee;
  const discount = sourceConfig.methods.find(m => m.id === 'shamcash').discount;
  const nonFreeZone = sourceConfig.methods.find(m => m.id === 'shamcash').freeDeliveryIn;

  const cases = [
    [mutate(source, /\{ id: 'other', label: '[^']+', fee: ([\d.]+),/, `{ id: 'other', label: 'X', fee: ${otherFee + 1},`, 'رسم باقي المحافظات'), 'zones'],
    [mutate(source, /\bdiscountPercent: ([\d.]+),/, `discountPercent: ${discount + 5},`, 'خصم شام كاش'), 'methods'],
    [mutate(source, /\bdefaultZone: '(hama|other)',/, "defaultZone: 'other',", 'المنطقة الافتراضية'), 'defaultZone'],
    [mutate(source, /\bwhatsappNumber: '(\d+)'/, "whatsappNumber: '963900000000'", 'رقم واتساب'), 'phone']
  ];
  for (const [changed, key] of cases) {
    assert.deepEqual(diffOrderConfig(readOrderConfig(source), readOrderConfig(renderPublishedConfig(changed).output)), [key]);
  }
  assert.ok(nonFreeZone.length <= 2);
});

test('the published reader rejects remote code, oversized files and junk', () => {
  assert.throws(() => readPublishedConfig('window.RAWAA_CONFIG = require("node:fs")().readFileSync("/etc/passwd","utf8");'), /تعذّر/);
  assert.throws(() => readPublishedConfig('fetch("https://example.invalid")'), /تعذّر/);
  assert.throws(() => readPublishedConfig('window.RAWAA_CONFIG = {products: []}'), /لا كائن إعدادات/);
  assert.throws(() => readPublishedConfig('x'.repeat(MAX_PUBLISHED_BYTES + 1)), /يتجاوز السقف/);
  assert.throws(() => readPublishedConfig(42), /ليس نصًا/);
});

test('published structures with missing or duplicated methods fail closed', () => {
  const oneMethod = structuredClone(built.publicConfig);
  oneMethod.payment.methods = oneMethod.payment.methods.slice(0, 1);
  assert.throws(() => orderConfigFromObject(oneMethod), /expected two/);

  const twoZones = structuredClone(built.publicConfig);
  twoZones.delivery.zones = twoZones.delivery.zones.filter(z => z.id !== 'other');
  assert.throws(() => orderConfigFromObject(twoZones), /expected two zones/);

  const badPhone = structuredClone(built.publicConfig);
  badPhone.contact.whatsappNumber = 'not-a-number';
  assert.throws(() => orderConfigFromObject(badPhone), /whatsappNumber/);
});

test('the build command writes exactly what the contract renders (end to end)', async () => {
  // Runs the real CLI the deploy script uses, not just the library function.
  // A library-only test is how the original defect slipped through.
  const dir = await mkdtemp(path.join(tmpdir(), 'rawaa-config-'));
  const target = path.join(dir, 'config.js');
  execFileSync(process.execPath, [fileURLToPath(new URL('./strip-internal-config.mjs', import.meta.url)), target]);
  const written = await read(target, 'utf8');
  assert.equal(written, built.output);
  assert.deepEqual(readOrderConfig(written, { label: 'built' }), readOrderConfig(source));
});

test('the live comparison passes against a server that serves the real build output', async () => {
  // كامل مسار الفشل الأصلي: شبكة حقيقية + نص منشور حقيقي. الاختبارات السابقة
  // كانت تقارن نصًا محليًا بنص محلي، فلا تلمس هذا المسار أبدًا.
  const { createServer } = await import('node:http');
  const { compareLiveOrderConfig } = await import('./order-config-monitor.mjs');
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/javascript' });
    res.end(built.output);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/js/config.js`;
  try {
    assert.deepEqual(await compareLiveOrderConfig({ sourceText: source, url }), []);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('the live comparison reports drift instead of passing a stale published file', async () => {
  const { createServer } = await import('node:http');
  const { compareLiveOrderConfig } = await import('./order-config-monitor.mjs');
  const stale = renderPublishedConfig(mutate(source, /(id: 'serum-50',[\s\S]*?\bprice: )[\d.]+/, '$170', 'سعر 50 مل')).output;
  const server = createServer((req, res) => res.end(stale));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/js/config.js`;
  try {
    assert.deepEqual(await compareLiveOrderConfig({ sourceText: source, url }), ['products']);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('the live comparison fails loudly on HTTP errors and oversized payloads', async () => {
  const { createServer } = await import('node:http');
  const { compareLiveOrderConfig } = await import('./order-config-monitor.mjs');
  let mode = 'error';
  const server = createServer((req, res) => {
    if (mode === 'error') { res.writeHead(500); res.end('boom'); return; }
    res.writeHead(200, { 'content-length': String(MAX_PUBLISHED_BYTES + 1) });
    res.end(built.output.padEnd(MAX_PUBLISHED_BYTES + 1, ' '));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/js/config.js`;
  try {
    await assert.rejects(compareLiveOrderConfig({ sourceText: source, url }), /HTTP 500/);
    mode = 'huge';
    await assert.rejects(compareLiveOrderConfig({ sourceText: source, url }), /too large/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
