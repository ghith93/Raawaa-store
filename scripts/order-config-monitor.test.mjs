import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extractOrderConfig } from './order-config-monitor.mjs';

const source = await readFile(new URL('../js/config.js', import.meta.url), 'utf8');

test('reads size and price as a pair, phone and both delivery zones', () => {
  const result = extractOrderConfig(source);
  assert.deepEqual(result.products.map(p => [p.id, p.size, p.price]), [
    ['serum-100', 100, 25], ['serum-30', 30, 13], ['serum-50', 50, 16]
  ]);
  assert.deepEqual(result.zones.map(z => [z.id, z.fee, z.freeWithShamCash]), [
    ['hama', 0, true], ['other', 2, false]
  ]);
  assert.match(result.phone, /^\d+$/);
  assert.equal(result.defaultZone, 'hama');
  assert.deepEqual(result.methods, [
    { id: 'cod', discount: 0, freeDeliveryIn: ['hama'], available: true },
    { id: 'shamcash', discount: 10, freeDeliveryIn: ['hama'], available: true }
  ]);
});

test('detects swapped prices even though all three prices still appear', () => {
  const changed = source.replace('price: 13,', 'price: TEMP,').replace('price: 16,', 'price: 13,').replace('price: TEMP,', 'price: 16,');
  assert.notDeepEqual(extractOrderConfig(changed).products, extractOrderConfig(source).products);
});

test('fails closed for missing products, duplicated phone, or missing zone', () => {
  assert.throws(() => extractOrderConfig(source.replace("id: 'serum-30'", "id: 'unknown'")));
  assert.throws(() => extractOrderConfig(source + "\nwhatsappNumber: '123',\n"));
  assert.throws(() => extractOrderConfig(source.replace("id: 'other', label:", "id: 'unknown', label:")));
});

test('detects delivery charge drift', () => {
  assert.notDeepEqual(extractOrderConfig(source.replace("fee: 2, freeWithShamCash: false", "fee: 3, freeWithShamCash: false")).zones, extractOrderConfig(source).zones);
});

test('detects payment discount, free-shipping and availability drift', () => {
  const original = extractOrderConfig(source);
  for (const changed of [
    source.replace('discountPercent: 10,', 'discountPercent: 15,'),
    source.replace("freeDeliveryIn: ['hama'],", "freeDeliveryIn: ['other'],"),
    source.replace('available: true,', 'available: false,'),
    source.replace("defaultZone: 'hama',", "defaultZone: 'other',")
  ]) assert.notDeepEqual(extractOrderConfig(changed), original);
});

test('fails closed if payment rules cannot be safely extracted', () => {
  assert.throws(() => extractOrderConfig(source.replace("freeDeliveryIn: ['hama'],", "freeDeliveryIn: [externalValue],")));
  assert.throws(() => extractOrderConfig(source.replace('discountPercent: 10,', 'discountPercent: calculation(),')));
  assert.throws(() => extractOrderConfig(source.replace("id: 'cod',", "id: 'other-method',")));
  assert.throws(() => extractOrderConfig(source.replace("freeDeliveryIn: ['hama'],", "freeDeliveryIn: ['hama', 'hama'],")));
});
