#!/usr/bin/env node
/**
 * يقارن إعدادات الطلب الحرجة بين المستودع والموقع المنشور — بلا تنفيذ جافاسكربت بعيد.
 *
 * التاريخ المهم: هذا الفحص كان يفشل ٧ مرات متتالية (٤–٦ نوفمبر ٢٠٢٦) لا لأن الموقع
 * تعطّل، بل لأن `js/config.js` المنشور يُعاد بناؤه كـJSON بينما كان هذا الملف يقرأه
 * بتعبيرات نمطية تفترض صياغة المصدر. الإنذار الكاذب المزمن أخطر من غياب الإنذار.
 *
 * الحل: مصدران لقراءة واحدة.
 *   • نص المصدر (كما في المستودع) ← الاستخراج النصي الصارم أدناه.
 *   • نص منشور (نسخة البناء)      ← تقييم معزول في `node:vm` عبر scripts/lib/public-config.mjs.
 *
 * قواعد السلامة:
 *   • لا يُنفَّذ أي كود من الشبكة بصلاحيات: `vm` بسياق فارغ، بلا `require`/`fetch`/`process`.
 *   • الملف البعيد محدود الحجم.
 *   • الصياغة غير المتوقعة تفشل مغلقًا، وتُطلب مراجعة هذا الملف واختباراته.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readPublishedConfig } from './lib/public-config.mjs';

/** سقف الحجم: ملف الإعدادات نحو ٦–٨ KB؛ أي شيء أكبر بكثير ليس إعداداتنا. */
const MAX_REMOTE_BYTES = 512 * 1024;

function exactlyOne(text, pattern, label) {
  const matches = [...text.matchAll(pattern)];
  if (matches.length !== 1) throw new Error(`${label}: expected one match, got ${matches.length}`);
  return matches[0];
}

/** يستخرج إعدادات الطلب الحرجة من نص المصدر (صياغة JavaScript الملتزمة). */
export function extractOrderConfig(text) {
  const phone = exactlyOne(text, /^\s*whatsappNumber:\s*'([0-9]+)'\s*,/gm, 'whatsappNumber')[1];
  const productsBlock = exactlyOne(text, /\bproducts:\s*\[([\s\S]*?)\n\s*\],\s*\n\s*\/\*\*/g, 'products')[1];
  const entries = [...productsBlock.matchAll(/\bid:\s*'(serum-\d+)'\s*,[\s\S]*?\bsizeMl:\s*(\d+)\s*,[\s\S]*?\bprice:\s*(\d+(?:\.\d+)?)\s*,/g)];
  if (entries.length !== 3 || new Set(entries.map(m => m[1])).size !== 3) throw new Error('products: expected three distinct products');
  const products = entries.map(m => ({ id: m[1], size: Number(m[2]), price: Number(m[3]) })).sort((a, b) => a.id.localeCompare(b.id));
  const zoneMatches = [...text.matchAll(/\{\s*id:\s*'(hama|other)'\s*,\s*label:\s*'[^']+'\s*,\s*fee:\s*(\d+(?:\.\d+)?)\s*,\s*freeWithShamCash:\s*(true|false)\s*\}/g)];
  if (zoneMatches.length !== 2 || new Set(zoneMatches.map(m => m[1])).size !== 2) throw new Error('delivery: expected two distinct zones');
  const zones = zoneMatches.map(m => ({ id: m[1], fee: Number(m[2]), freeWithShamCash: m[3] === 'true' })).sort((a, b) => a.id.localeCompare(b.id));
  const defaultZone = exactlyOne(text, /^\s*defaultZone:\s*'(hama|other)'\s*,/gm, 'defaultZone')[1];
  // The cart calculates discounts and free shipping from payment.methods, not
  // from the descriptive freeWithShamCash flag on a delivery zone.
  const methodsBlock = exactlyOne(text, /\bmethods:\s*\[([\s\S]*?)\n\s*\]\s*\n\s*\},/g, 'payment methods')[1];
  const methodIds = [...methodsBlock.matchAll(/^\s*id:\s*'([^']+)'\s*,/gm)];
  if (methodIds.length !== 2 || methodIds.some(m => !['shamcash', 'cod'].includes(m[1]))) throw new Error('payment methods: unsupported method list');
  const methods = [...methodsBlock.matchAll(/\{\s*\n\s*id:\s*'(shamcash|cod)'\s*,([\s\S]*?)\n\s*\}/g)].map(m => {
    const body = m[2];
    const discount = Number(exactlyOne(body, /^\s*discountPercent:\s*(\d+(?:\.\d+)?)\s*,/gm, `${m[1]} discount`)[1]);
    const delivery = exactlyOne(body, /^\s*freeDeliveryIn:\s*\[([^\]]*)\]\s*,/gm, `${m[1]} freeDeliveryIn`)[1].trim();
    if (delivery && !/^'(?:hama|other)'(?:\s*,\s*'(?:hama|other)')*$/.test(delivery)) throw new Error(`${m[1]}: invalid freeDeliveryIn`);
    const freeDeliveryIn = delivery ? delivery.split(',').map(s => s.trim().slice(1, -1)).sort() : [];
    if (new Set(freeDeliveryIn).size !== freeDeliveryIn.length) throw new Error(`${m[1]}: duplicate free-delivery zone`);
    const available = exactlyOne(body, /^\s*available:\s*(true|false)\s*,/gm, `${m[1]} available`)[1] === 'true';
    return { id: m[1], discount, freeDeliveryIn, available };
  }).sort((a, b) => a.id.localeCompare(b.id));
  if (methods.length !== 2 || new Set(methods.map(m => m.id)).size !== 2) throw new Error('payment methods: expected two distinct methods');
  return { phone, products, zones, defaultZone, methods };
}

/**
 * يستخرج الإعدادات الحرجة من كائن إعدادات مُقيَّم (نسخة النشر).
 * نفس الشكل الناتج تمامًا، وبالتالي نفس المقارنة.
 */
export function orderConfigFromObject(config) {
  const methods = (config.payment?.methods ?? [])
    .filter(m => ['shamcash', 'cod'].includes(m.id))
    .map(m => ({
      id: m.id,
      discount: Number(m.discountPercent),
      freeDeliveryIn: [...(m.freeDeliveryIn ?? [])].sort(),
      available: m.available !== false
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  if (methods.length !== 2) throw new Error('published payment methods: expected two');

  const zones = (config.delivery?.zones ?? [])
    .filter(z => ['hama', 'other'].includes(z.id))
    .map(z => ({ id: z.id, fee: Number(z.fee), freeWithShamCash: z.freeWithShamCash === true }))
    .sort((a, b) => a.id.localeCompare(b.id));
  if (zones.length !== 2) throw new Error('published delivery: expected two zones');

  const products = (config.products ?? [])
    .map(p => ({ id: p.id, size: Number(p.sizeMl), price: Number(p.price) }))
    .sort((a, b) => a.id.localeCompare(b.id));
  if (products.length !== 3) throw new Error('published products: expected three');

  return {
    phone: String(config.contact?.whatsappNumber ?? ''),
    products,
    zones,
    defaultZone: config.delivery?.defaultZone,
    methods
  };
}

/**
 * يقرأ أي نص إعدادات — مصدرًا كان أو منشورًا — ويعيد الشكل الحرجة الموحّد.
 * هذا هو المدخل الوحيد الذي يجب أن يستخدمه البناء والمراقبة والاختبارات.
 */
export function readOrderConfig(text, { label = 'config' } = {}) {
  // الصياغة المنشورة تُقيَّم أولًا: هي الأكثر تحديدًا.
  let publishedError = null;
  try {
    return orderConfigFromObject(readPublishedConfig(text));
  } catch (error) {
    publishedError = error;
  }
  // ليست صياغة نشر (أو نشر ناقص) — جرّب صياغة المصدر.
  try {
    return extractOrderConfig(text);
  } catch (sourceError) {
    throw new Error(
      `${label}: unrecognised config format (published: ${publishedError.message}; source: ${sourceError.message})`
    );
  }
}

/** يقارن الشكلين ويعيد قائمة المفاتيح المختلفة. لا يطبع أي رقم هاتف. */
export function diffOrderConfig(local, live) {
  return ['phone', 'products', 'zones', 'defaultZone', 'methods']
    .filter(key => JSON.stringify(local[key]) !== JSON.stringify(live[key]));
}

async function main() {
  const configPath = new URL('../js/config.js', import.meta.url);
  const local = readOrderConfig(await readFile(configPath, 'utf8'), { label: 'source' });

  const url = 'https://raawaa-store.pages.dev/js/config.js';
  const response = await fetch(url, { signal: AbortSignal.timeout(25000), cache: 'no-store', redirect: 'error' });
  if (!response.ok) throw new Error(`live config HTTP ${response.status}`);
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_REMOTE_BYTES) throw new Error('live config larger than expected');

  const live = readOrderConfig(text, { label: 'live' });
  const mismatch = diffOrderConfig(local, live);
  if (mismatch.length) {
    // Do not log phone numbers or any remote content.
    for (const key of mismatch) console.error(`Mismatch in ${key}`);
    throw new Error('Live order configuration differs from the checked-out source');
  }
  console.log('Live phone, product prices, delivery zones and payment rules match the source.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
