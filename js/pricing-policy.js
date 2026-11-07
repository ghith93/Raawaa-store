/**
 * RAWAA | رواء — سياسة التوصيل والخصم. **المصدر الوحيد للحساب.**
 *
 * لماذا هذا الملف؟ لأن القاعدة الواحدة كانت مكتوبة بأربع صيغ مختلفة في:
 *   js/cart.js · order-system/order-pricing.js · order-system/order-core.mjs · js/campaign.js
 * فتغيّرت السياسة يومًا وتغيّر معها سلوك السلة دون آخر، وهو بالضبط ما يُنتج
 * «تعارضًا مستقبلًا»: رقم صحيح في مكان ورقم قديم في مكان آخر.
 *
 * القاعدة الآن: لا أحد يعيد كتابة هذه المعادلة. الجميع يستدعي:
 *   deliveryCentsFor(method, zone)   ← كم يدفع الزبون توصيلًا
 *   discountCentsFor(method, baseCents) ← كم يُخصم
 *
 * القيم نفسها (النسبة، الرسوم) تبقى في js/config.js وحدها. هذا الملف منطق لا أرقام.
 *
 * يعمل في المتصفح (window.RawaaPricingPolicy) وفي Node (module.exports) كليهما،
 * بلا تبعيات، ليستطيع الخادم والواجهة والاختبارات مشاركة الحكم نفسه حرفيًا.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RawaaPricingPolicy = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function toCents(value) {
    var n = Number(value);
    return Number.isFinite(n) ? Math.round(n * 100) : 0;
  }

  /**
   * رسوم التوصيل الفعلية بالدولار.
   *
   * السياسة المعتمدة: التوصيل مجاني دائمًا، لكل منطقة ولكل طريقة دفع.
   * `freeDeliveryIn` و`freeWithShamCash` بقيتا في الإعدادات للتوافق الخلفي فقط
   * ولا تُقرآن هنا — لتفادي بقاء سلوك قديم حيًّا في مكان لا يتوقعه أحد.
   * إن عاد المالك يومًا إلى رسوم، يكفي أن يضع رقمًا في `zone.fee` هنا وحده.
   */
  function deliveryFeeFor(method, zone, delivery) {
    if (!zone) return 0;
    // بوابة صريحة: توصيل مجاني دائمًا ما لم يُلغِ المالك `alwaysFree`.
    var policy = delivery && delivery.policy;
    if (!policy || policy.alwaysFree !== false) return 0;
    return Number(zone.fee) || 0;
  }

  function deliveryCentsFor(method, zone, delivery) {
    return toCents(deliveryFeeFor(method, zone, delivery));
  }

  /** نسبة خصم طريقة الدفع (شام كاش ١٠٪). صفر لأي طريقة أخرى أو غير متاحة. */
  function discountPercentFor(method) {
    if (!method || method.available === false) return 0;
    var percent = Number(method.discountPercent);
    if (!Number.isFinite(percent) || percent <= 0) return 0;
    return percent;
  }

  /** مبلغ الخصم بالدولار على أساس محدد (قيمة المنتجات بعد العروض، بلا عطر ولا توصيل). */
  function discountCentsFor(method, baseCents) {
    var base = toCents(baseCents);
    if (base <= 0) return 0;
    return Math.round(base * discountPercentFor(method) / 100);
  }

  /** هل هذا الخيار مجاني التوصيل؟ للاستخدام في النصوص وليس في الحساب. */
  function isFreeDelivery(method, zone, delivery) {
    return deliveryFeeFor(method, zone, delivery) === 0;
  }

  /** الحساب الكامل — يستخدمه المتجر والطلبات كليهما لضمان تطابق دقيق. */
  function totalsFor(input) {
    var method = input.method;
    var zone = input.zone;
    var delivery = input.delivery;
    var productCents = toCents(input.productCents);
    var scentCents = toCents(input.scentCents);
    var discountCents = discountCentsFor(method, productCents);
    var deliveryCents = deliveryCentsFor(method, zone, delivery);
    var subtotalCents = productCents + scentCents;
    return {
      subtotalCents: subtotalCents,
      discountCents: discountCents,
      deliveryCents: deliveryCents,
      totalCents: subtotalCents - discountCents + deliveryCents
    };
  }

  return {
    toCents: toCents,
    deliveryFeeFor: deliveryFeeFor,
    deliveryCentsFor: deliveryCentsFor,
    discountPercentFor: discountPercentFor,
    discountCentsFor: discountCentsFor,
    isFreeDelivery: isFreeDelivery,
    totalsFor: totalsFor
  };
}));
