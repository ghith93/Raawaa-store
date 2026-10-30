import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

/**
 * Loads the store config from js/config.js — the single source of truth for prices,
 * zones, payment methods and contact data. Used by the order-entry build and by
 * tests that must catch a bundle built from stale prices. Never invents values.
 */
export async function loadStoreConfig() {
  const source = await readFile(new URL('../js/config.js', import.meta.url), 'utf8');
  const sandbox = { window: {} };
  vm.runInNewContext(source, sandbox);
  const config = sandbox.window.RAWAA_CONFIG;
  if (!config || !Array.isArray(config.products) || config.products.length < 1) throw new Error('INVALID_CONFIG');
  return config;
}
