/*
 * حارس «المصدر الواحد» — سياسة التوصيل والخصم.
 *
 * الدافع: القاعدة نفسها كانت مكتوبة بأربع صيغ في js/cart.js و
 * order-system/order-pricing.js و order-system/order-core.mjs و js/campaign.js.
 * تغيير السياسة في ملف واحد كان يترك الثلاثة الأخرى على السياسة القديمة، وهذا هو
 * «التعارض المستقبلي» الذي طلب المالك ألا يحدث.
 *
 * هذا الاختبار يفحص ثلاثة أشياء:
 *   ١. لا حساب رسوم/خصم مكرَّر في أي ملف خارج js/pricing-policy.js.
 *   ٢. المحرّكات الثلاثة (السلة، order-pricing، order-core) تُنتج الأرقام نفسها.
 *   ٣. السياسة السارية فعلًا هي سياسة المالك: توصيل صفر + 10% شام كاش.
 *
 * الفحص (١) نصّي بـ«النمط السلبي»: يبحث عن الصيغة الحسابية لا عن كلمة. لو أعاد
 * أحد كتابة المعادلة بأي تسمية، يفشل الاختبار.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import pricingPolicy from '../js/pricing-policy.js';
import orderPricing from '../order-system/order-pricing.js';
import { prepareOrder } from '../order-system/order-core.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(resolve(ROOT, path), 'utf8');

/**
 * إزالة التعليقات قبل الفحص النصّي.
 *
 * بلا هذه الخطوة يقرأ الحارس الشرحَ الذي يوثّق الخطأ القديم فيظنّه الخطأ نفسه —
 * وهذا فشل كاذب يجعل الحارس غير قابل للثقة. نحن نفحص الكود المنفَّذ لا الوصف.
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function loadConfig() {
  const window = {};
  new Function('window', read('js/config.js'))(window);
  return window.RAWAA_CONFIG;
}

const config = loadConfig();

/* ── ١) لا تكرار للحساب ─────────────────────────────────────────────────── */

/** الملفات التي كانت تكرّر القاعدة، وملف السياسة الوحيد المسموح له بالحساب. */
const CONSUMERS = [
  'js/cart.js',
  'order-system/order-pricing.js',
  'order-system/order-core.mjs',
  'js/campaign.js'
];

/**
 * صيَغ الحساب المحرَّمة على المستهلكين.
 * الشروط متسامحة مع المسافات فقط، لا مع التسمية، حتى لا يفلت إعادةُ كتابةٍ بأسماء جديدة.
 */
const FORBIDDEN = [
  {
    // خصم = أساس × النسبة ÷ 100
    regex: /(discount|Discount)[A-Za-z]*\s*=\s*[^;\n]*\*\s*[^;\n]*\/\s*100/,
    why: 'حساب الخصم (أساس × نسبة ÷ 100) مكرَّر خارج js/pricing-policy.js — استخدم discountCentsFor'
  },
  {
    // رسوم = المنطقة × 100 (تحويل إلى سنتات)
    regex: /Number\s*\(\s*zone\s*\.\s*fee\s*\)/,
    why: 'قراءة zone.fee مباشرة مكرَّرة — استخدم deliveryCentsFor'
  },
  {
    // توصيل مجاني مشروط بمنطقة: freeDeliveryIn.includes(...)
    regex: /freeDeliveryIn/,
    why: 'freeDeliveryIn سياسة ملغاة؛ الحقيقة هي delivery.policy.alwaysFree عبر pricing-policy'
  }
];

test('لا ملف خارج js/pricing-policy.js يعيد كتابة معادلة الرسوم أو الخصم', () => {
  const violations = [];
  for (const file of CONSUMERS) {
    const source = stripComments(read(file));
    for (const rule of FORBIDDEN) {
      const match = rule.regex.exec(source);
      if (match) violations.push(`${file}: «${match[0].trim()}» — ${rule.why}`);
    }
  }
  assert.deepEqual(violations, [], `\n${violations.join('\n')}\n`);
});

test('ملف السياسة نفسه يقرأ fee — أي أنه الحساب الوحيد المسموح', () => {
  // فحص موجب: لو حُذف الحساب من المصدر الوحيد صار الحارس أعمى.
  assert.match(read('js/pricing-policy.js'), /Number\s*\(\s*zone\s*\.\s*fee\s*\)/);
});

test('كل مستهلك ينادي وحدة السياسة بدل أن يحسب بنفسه', () => {
  const calls = {
    'js/cart.js': /RawaaPricingPolicy|deliveryFeeFor|discountCentsFor/,
    'order-system/order-pricing.js': /pricing-policy/,
    'order-system/order-core.mjs': /pricingPolicy\./,
    'js/campaign.js': /RawaaPricingPolicy/
  };
  for (const [file, regex] of Object.entries(calls)) {
    assert.match(read(file), regex, `${file} لا يستدعي وحدة السياسة`);
  }
});

/* ── ٢) المحرّكات الثلاثة تُنتج الرقم نفسه ─────────────────────────────── */

const methods = config.payment.methods.map(method => method.id);
const zones = config.delivery.zones.map(zone => zone.id);

function cartTotal({ productCents, scentCents, methodId, zoneId }) {
  const method = config.payment.methods.find(m => m.id === methodId);
  const zone = config.delivery.zones.find(z => z.id === zoneId);
  return pricingPolicy.totalsFor({
    productCents,
    scentCents,
    method,
    zone,
    delivery: config.delivery
  }).totalCents;
}

test('السلة والسياسة يتفقان على كل تركيبة حجم×طريقة دفع×منطقة', () => {
  for (const product of config.products) {
    for (const methodId of methods) {
      for (const zoneId of zones) {
        const total = cartTotal({
          productCents: Math.round(product.price * 100),
          scentCents: 0,
          methodId,
          zoneId
        });
        const expected = Math.round(product.price * 100)
          - pricingPolicy.discountCentsFor(
            config.payment.methods.find(m => m.id === methodId),
            Math.round(product.price * 100)
          );
        assert.equal(total, expected, `${product.id}/${methodId}/${zoneId}`);
      }
    }
  }
});

test('order-pricing و order-core و السياسة يُنتجون الإجمالي نفسه', () => {
  for (const product of config.products) {
    for (const methodId of methods) {
      for (const zoneId of zones) {
        const input = { items: [{ id: product.id, qty: 1 }], method: methodId, zone: zoneId };
        const viaPricing = orderPricing.calculateOrderEstimate(input, config, null);
        const viaCore = prepareOrder({
          ...input,
          name: 'زبونة تجريبية',
          phone: '0991234567',
          address: 'حماة'
        }, config);

        const viaPolicy = cartTotal({
          productCents: Math.round(product.price * 100),
          scentCents: 0,
          methodId,
          zoneId
        });

        assert.equal(viaPricing.totalCents, viaPolicy, `order-pricing ${product.id}/${methodId}/${zoneId}`);
        assert.equal(viaCore.totalCents, viaPolicy, `order-core ${product.id}/${methodId}/${zoneId}`);
        assert.equal(viaPricing.deliveryCents, 0, 'التوصيل صفر في كل الحالات');
        assert.equal(viaCore.deliveryCents, 0, 'التوصيل صفر في كل الحالات');
      }
    }
  }
});

/* ── ٣) السياسة السارية هي سياسة المالك ────────────────────────────────── */

test('السياسة السارية: توصيل صفر لكل منطقة ولكل طريقة دفع', () => {
  assert.equal(config.delivery.policy.alwaysFree, true, 'delivery.policy.alwaysFree يجب أن يكون true');
  for (const zone of config.delivery.zones) {
    for (const method of config.payment.methods) {
      assert.equal(
        pricingPolicy.deliveryFeeFor(method, zone, config.delivery),
        0,
        `${method.id}/${zone.id} يجب أن يكون مجانيًا`
      );
    }
  }
});

test('السياسة السارية: 10% على شام كاش، صفر على الاستلام', () => {
  const shamcash = config.payment.methods.find(m => m.id === 'shamcash');
  const cod = config.payment.methods.find(m => m.id === 'cod');
  assert.equal(pricingPolicy.discountPercentFor(shamcash), 10);
  assert.equal(pricingPolicy.discountPercentFor(cod), 0);
  // الخصم على المنتجات وحدها: العطر لا يُخصم.
  assert.equal(pricingPolicy.discountCentsFor(shamcash, 1000), 100);
});

test('الإجماليات المنشورة تطابق الحساب الفعلي', () => {
  const expected = [
    { id: 'serum-30', shamcash: 1170, cod: 1300 },
    { id: 'serum-50', shamcash: 1440, cod: 1600 },
    { id: 'serum-100', shamcash: 2250, cod: 2500 }
  ];
  for (const row of expected) {
    const product = config.products.find(p => p.id === row.id);
    assert.ok(product, `المنتج ${row.id} مفقود`);
    for (const zoneId of zones) {
      assert.equal(
        cartTotal({ productCents: Math.round(product.price * 100), scentCents: 0, methodId: 'shamcash', zoneId }),
        row.shamcash,
        `${row.id}/shamcash/${zoneId}`
      );
      assert.equal(
        cartTotal({ productCents: Math.round(product.price * 100), scentCents: 0, methodId: 'cod', zoneId }),
        row.cod,
        `${row.id}/cod/${zoneId}`
      );
    }
  }
});

test('العطر لا يدخل في وعاء الخصم', () => {
  const shamcash = config.payment.methods.find(m => m.id === 'shamcash');
  const withScent = pricingPolicy.totalsFor({
    productCents: 1600,
    scentCents: 400,
    method: shamcash,
    zone: config.delivery.zones[0],
    delivery: config.delivery
  });
  assert.equal(withScent.discountCents, 160, 'الخصم على المنتج 1600 فقط');
  assert.equal(withScent.totalCents, 1600 + 400 - 160);
});

/* ── ٤) لا صفحة تحمّل js/cart.js بلا وحدة السياسة ───────────────────────── */

test('كل صفحة تحمّل cart.js تحمّل pricing-policy.js قبله', async () => {
  const { readdirSync } = await import('node:fs');
  const pages = readdirSync(ROOT)
    .filter(name => name.endsWith('.html'))
    .filter(name => /<script[^>]+src=["']js\/cart\.js/.test(read(name)));

  assert.ok(pages.length > 0, 'لم تُعثر على أي صفحة تحمّل cart.js — الحارس أعمى');
  for (const page of pages) {
    const source = read(page);
    const policyAt = source.search(/<script[^>]+src=["']js\/pricing-policy\.js/);
    const cartAt = source.search(/<script[^>]+src=["']js\/cart\.js/);
    assert.ok(policyAt !== -1, `${page}: يحمّل cart.js بلا js/pricing-policy.js — السلة ستفقد الخصم والتوصيل`);
    assert.ok(policyAt < cartAt, `${page}: pricing-policy.js يجب أن يُحمَّل قبل cart.js`);
  }
});

test('الترتيب نفسه محفوظ في نسخة النشر', () => {
  // dist غير موجود دائمًا في الشجرة (مُستبعَد من git) — نفحصه إن وُجد فقط.
  let distPage;
  try {
    distPage = read('dist/site/serum.html');
  } catch {
    return; // لا نسخة بناء: البناء نفسه يشغّل هذا الحارس عبر gates
  }
  const policyAt = distPage.search(/<script[^>]+src=["']js\/pricing-policy\.js/);
  const cartAt = distPage.search(/<script[^>]+src=["']js\/cart\.js/);
  assert.ok(policyAt !== -1 && policyAt < cartAt, 'نسخة النشر تفقد وحدة السياسة أو ترتيبها');
});
