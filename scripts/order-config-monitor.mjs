#!/usr/bin/env node
// Compare a small set of order-critical settings without executing remote JavaScript.
// Unexpected formatting fails closed: update the parser and its tests when config changes.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

function exactlyOne(text, pattern, label) {
  const matches = [...text.matchAll(pattern)];
  if (matches.length !== 1) throw new Error(`${label}: expected one match, got ${matches.length}`);
  return matches[0];
}

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

async function main() {
  const configPath = new URL('../js/config.js', import.meta.url);
  const local = extractOrderConfig(await readFile(configPath, 'utf8'));
  const url = 'https://raawaa-store.pages.dev/js/config.js';
  const response = await fetch(url, { signal: AbortSignal.timeout(25000), cache: 'no-store', redirect: 'error' });
  if (!response.ok) throw new Error(`live config HTTP ${response.status}`);
  const live = extractOrderConfig(await response.text());
  if (JSON.stringify(local) !== JSON.stringify(live)) {
    // Do not log phone numbers or any remote content.
    for (const key of ['phone', 'products', 'zones', 'defaultZone', 'methods']) {
      if (JSON.stringify(local[key]) !== JSON.stringify(live[key])) console.error(`Mismatch in ${key}`);
    }
    throw new Error('Live order configuration differs from the checked-out source');
  }
  console.log('Live phone, product prices, delivery zones and payment rules match the source.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
