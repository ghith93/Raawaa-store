import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const window = {};
vm.runInNewContext(readFileSync(new URL('../js/config.js', import.meta.url), 'utf8'), { window });
const config = window.RAWAA_CONFIG;
const strategy = readFileSync(new URL('../docs/BRAND-IDENTITY-AND-POSITIONING-AR.md', import.meta.url), 'utf8');
const concept = readFileSync(new URL('../docs/visual-drafts/rawaa-world-benchmark-labeled-concept.svg', import.meta.url), 'utf8');

test('brand work remains a disclosed draft and distinguishes inspiration from copying', () => {
  assert.match(strategy, /تصوّر استراتيجي وبصري/);
  assert.match(strategy, /لا نسخ شعار أو شكل محمي/);
  assert.match(strategy, /لم يُطبّق/);
  assert.match(strategy, /لا نشر ولا طباعة ولا شراء ولا تصنيع/);
  assert.match(concept, /ليس عبوة مُصنّعة ولا ملصقًا قانونيًا نهائيًا/);
  assert.match(concept, /\.\.\/\.\.\/assets\/brand\/logo-primary-v2\.svg/);
  assert.match(concept, /rawaa-world-benchmark-direction\.png/);
});

test('concept labels show only the real store sizes and avoid invented formula details', () => {
  for (const product of config.products) {
    assert.ok(concept.includes(`${product.sizeMl} mL`), `missing actual size ${product.sizeMl} mL`);
  }
  assert.match(concept, /سيروم زيوت للشعر/);
  assert.doesNotMatch(concept, /INCI|percentage|يوقف التساقط|يعالج/);
});
