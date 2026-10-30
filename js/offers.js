/**
 * RAWAA | رواء — محرّك العروض والتخفيضات.
 *
 * الخانات (slots) يعرّفها المالك في `CONFIG.offers.slots` داخل js/config.js فقط.
 * هذا الملف لا يحمل أي قيمة تسويقية بنفسه: إن كانت الخانات فارغة فلا يوجد عرض
 * ولا يتغيّر أي سعر. الغرض أن يضع المالك عرضه حسب خطة التسويق بلا لمس HTML.
 *
 * قواعد صريحة (لأنها تمسّ المال):
 *  - الخانة لا تعمل إلا إذا كتب المالك `enabled: true` صراحةً. النسيان = لا خصم.
 *  - التاريخ (startsAt / endsAt) بصيغة YYYY-MM-DD ويُقارن بتاريخ جهاز الزائرة.
 *    بعد endsAt يتوقف العرض وحده بلا أي تدخّل.
 *  - الأنواع المسموحة ثلاثة فقط:
 *      percent   : نسبة من سعر المنتجات — بسقف CONFIG.offers.maxPercent.
 *      amount    : مبلغ ثابت بالدولار يُخصم من قيمة المنتجات.
 *      sizePrice : سعر جديد لحجم واحد بعينه (يحتاج sizeId).
 *  - العرض المقيَّد بحجم (`sizeId`) يُطبَّق على سعره فقط. العرض غير المقيَّد
 *    يُطبَّق على قيمة المنتجات كلها (وليس على إضافة العطر ولا التوصيل).
 *  - لكل نطاق عرض واحد فقط: الأول في المصفوفة. والترتيب في المصفوفة = الأولوية.
 *  - أي خانة غير صالحة (نوع مجهول، رقم سالب، حجم غير موجود، سعر أعلى من الأصلي)
 *    تُهمَل بصمت آمن، وتظهر في `diagnose` كي يراها المطوّر في الاختبارات.
 *  - العرض يُطبَّق **قبل** خصم طريقة الدفع (شام كاش)، فيتراكم الخصمان:
 *    هذا ما يراه المالك ويوافق عليه، ويُشرح للزبونة في السلة والرسالة.
 *
 * لا يعتمد على DOM ولا على Date عند الاستدعاء: التاريخ يُمرَّر صريحًا،
 * ولهذا يمكن اختباره في Node بلا متصفح.
 */
(function (root) {
  'use strict';

  var TYPES = ['percent', 'amount', 'sizePrice'];
  var DEFAULT_MAX_PERCENT = 30;
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  function toCents(value) { return Math.round(Number(value) * 100); }

  /** تاريخ محلي بصيغة YYYY-MM-DD — لا UTC، كي لا يتقدّم/يتأخر يوم في سوريا. */
  function todayISO(now) {
    var d = now ? new Date(now) : new Date();
    var m = d.getMonth() + 1;
    var day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }

  function validDate(value) {
    return typeof value === 'string' && DATE_RE.test(value);
  }

  function maxPercent(cfg) {
    var cap = cfg && Number(cfg.maxPercent);
    return (isFinite(cap) && cap > 0 && cap <= 100) ? cap : DEFAULT_MAX_PERCENT;
  }

  /** سبب رفض الخانة، أو null إن كانت صالحة. */
  function rejectReason(slot, cfg, priceById) {
    if (!slot || typeof slot !== 'object') return 'not-an-object';
    if (slot.enabled !== true) return 'not-enabled';
    if (!slot.label || typeof slot.label !== 'string') return 'missing-label';
    if (TYPES.indexOf(slot.type) === -1) return 'unknown-type';
    var value = Number(slot.value);
    if (!isFinite(value) || value <= 0) return 'bad-value';
    if (slot.type === 'percent' && value > maxPercent(cfg)) return 'over-cap';
    if (slot.startsAt && !validDate(slot.startsAt)) return 'bad-startsAt';
    if (slot.endsAt && !validDate(slot.endsAt)) return 'bad-endsAt';
    if (slot.startsAt && slot.endsAt && slot.endsAt < slot.startsAt) return 'ends-before-start';
    if (slot.type === 'sizePrice') {
      if (!slot.sizeId || !(slot.sizeId in priceById)) return 'bad-size';
      if (toCents(value) >= priceById[slot.sizeId]) return 'not-a-discount';
    }
    if (slot.sizeId && !(slot.sizeId in priceById)) return 'bad-size';
    return null;
  }

  /**
   * يُرجع الخانات الصالحة حاليًا مع سبب استبعاد الباقي.
   * @param {object} cfg    CONFIG.offers
   * @param {object} priceById  { 'serum-30': 1900, ... } بالسنتات
   * @param {string} today  YYYY-MM-DD
   */
  function evaluate(cfg, priceById, today) {
    var slots = (cfg && Array.isArray(cfg.slots)) ? cfg.slots : [];
    var day = today || todayISO();
    var live = [];
    var skipped = [];

    slots.forEach(function (slot, index) {
      var reason = rejectReason(slot, cfg, priceById);
      if (!reason) {
        if (slot.startsAt && day < slot.startsAt) reason = 'not-started';
        else if (slot.endsAt && day > slot.endsAt) reason = 'expired';
      }
      if (reason) {
        skipped.push({ index: index, id: (slot && slot.id) || null, reason: reason });
        return;
      }
      live.push(slot);
    });

    return { today: day, slots: live, skipped: skipped };
  }

  /** أول عرض يعمل، مقيَّدًا بحجم أو غير مقيَّد — بحسب الطلب. */
  function pick(live, sizeId) {
    for (var i = 0; i < live.length; i += 1) {
      var slot = live[i];
      if (sizeId) {
        if (slot.sizeId === sizeId) return slot;
      } else if (!slot.sizeId) {
        return slot;
      }
    }
    return null;
  }

  /** خصم النسبة/الحجم على سعر منتج واحد. يعيد السنتات. */
  function cutForUnit(slot, priceCents) {
    if (!slot) return 0;
    if (slot.type === 'sizePrice') return Math.max(0, priceCents - toCents(slot.value));
    if (slot.type === 'percent') return Math.round(priceCents * Number(slot.value) / 100);
    return 0; // amount يعمل على قيمة المنتجات كلها لا على وحدة
  }

  /**
   * سعر وحدة واحدة بعد العرض.
   * @returns {{listCents:number, cents:number, cutCents:number, slot:object|null}}
   */
  function unitPrice(slot, priceCents) {
    var cut = cutForUnit(slot, priceCents);
    return { listCents: priceCents, cents: priceCents - cut, cutCents: cut, slot: slot || null };
  }

  /** خصم العرض الكلي (غير المقيَّد بحجم) على قيمة المنتجات بعد عروض الأحجام. */
  function orderCut(slot, baseCents) {
    if (!slot || baseCents <= 0) return 0;
    if (slot.type === 'percent') return Math.round(baseCents * Number(slot.value) / 100);
    if (slot.type === 'amount') return Math.min(baseCents, toCents(slot.value));
    return 0;
  }

  /** شارة قصيرة تُعرض بجانب السعر — من الخانة إن كُتبت، وإلا تُحسب. */
  function badge(slot, currencySymbol) {
    if (!slot) return '';
    if (slot.badge) return slot.badge;
    var symbol = currencySymbol || '$';
    if (slot.type === 'percent') return '−' + Number(slot.value) + '%';
    if (slot.type === 'amount') return '−' + symbol + Number(slot.value);
    return 'سعر خاص';
  }

  root.RawaaOffers = {
    TYPES: TYPES,
    todayISO: todayISO,
    evaluate: evaluate,
    pick: pick,
    unitPrice: unitPrice,
    orderCut: orderCut,
    badge: badge,
    toCents: toCents
  };
}(typeof window !== 'undefined' ? window : globalThis));
