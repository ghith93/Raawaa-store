import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extractOrderConfig } from './order-config-monitor.mjs';

const source = await readFile(new URL('../js/config.js', import.meta.url), 'utf8');

test('reads size and price as a pair, phone and both delivery zones', () => {
  const result = extractOrderConfig(source);
  assert.deepEqual(result.products.map(p => [p.id, p.size, p.price]), [
    ['serum-100', 100, 15], ['serum-30', 30, 10], ['serum-50', 50, 12]
  ]);
  assert.deepEqual(result.zones.map(z => [z.id, z.fee, z.freeWithShamCash]), [
    ['hama', 2, true], ['other', 4, false]
  ]);
  assert.match(result.phone, /^\d+$/);
});

test('detects swapped prices even though all three prices still appear', () => {
  const changed = source.replace('price: 10,', 'price: TEMP,').replace('price: 12,', 'price: 10,').replace('price: TEMP,', 'price: 12,');
  assert.notDeepEqual(extractOrderConfig(changed).products, extractOrderConfig(source).products);
});

test('fails closed for missing products, duplicated phone, or missing zone', () => {
  assert.throws(() => extractOrderConfig(source.replace("id: 'serum-30'", "id: 'unknown'")));
  assert.throws(() => extractOrderConfig(source + "\nwhatsappNumber: '123',\n"));
  assert.throws(() => extractOrderConfig(source.replace("id: 'other', label:", "id: 'unknown', label:")));
});

test('detects delivery charge drift', () => {
  assert.notDeepEqual(extractOrderConfig(source.replace("fee: 4, freeWithShamCash: false", "fee: 5, freeWithShamCash: false")).zones, extractOrderConfig(source).zones);
});
