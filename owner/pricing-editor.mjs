/**
 * RAWAA | رواء — محرّر التسعير والعروض للمالك.
 *
 * الغرض: أن يغيّر المالك السعر والرسم والعرض بنفسه بلا أن يلمس كودًا وبلا أن
 * يعتمد على أحد. هذا الملف **منطق خالص** يعمل في Node وفي المتصفح:
 *   • يقرأ الإعدادات الحالية ويتحقق من صحة أي تعديل قبل قبوله.
 *   • يحسب أثر التعديل على المبالغ الفعلية لكل منطقة وطريقة دفع (بالتفصيل).
 *   • يُنتج كتلة `js/config.js` الجديدة جاهزة للالتزام، بدل تعديل يدوي يُخطئ.
 *
 * ⚠ حدود صريحة: الموقع ثابت (Static Assets) بلا قاعدة أسعار حيّة، فالتعديل
 * هنا **يُنتج ملفًا** يُلتزم ويُنشر، ولا يغيّر الإنتاج لحظيًا. ادّعاء غير ذلك
 * كذب على المالك. التحرير اللحظي يحتاج جدول Supabase + دالة مملوكة، وهو غير مفعّل.
 *
 * لا يعتمد على DOM ولا على Date: التاريخ يُمرَّر صريحًا، فيُختبر كاملًا في Node.
 */
function createPricingEditor() {
  'use strict';

  var MAX_PERCENT_FLOOR = 1;
  var MAX_PERCENT_CEILING = 90;

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  /** أرقام صحيحة أو بمنزلة عشرية واحدة على الأكثر (سنتات لا أكثر). */
  function hasAtMostTwoDecimals(value) {
    return Math.abs(value * 100 - Math.round(value * 100)) < 1e-9;
  }

  /* --------------------------- التحقق من الأسعار --------------------------- */

  /**
   * يتحقق من أسعار الأحجام.
   * القاعدة المالية: لا سعر صفرًا أو سالبًا، ولا أكثر من منزلتين عشريتين،
   * ولا ترتيب مقلوب (الحجم الأكبر يجب ألا يكون أرخص من الأصغر) — تحذيرًا لا منعًا.
   */
  function validatePrices(products, nextPrices) {
    var errors = [];
    var warnings = [];
    var byId = {};
    (products || []).forEach(function (p) { byId[p.id] = p; });

    Object.keys(nextPrices || {}).forEach(function (id) {
      var price = Number(nextPrices[id]);
      if (!byId[id]) { errors.push('حجم غير معروف: ' + id); return; }
      if (!isFiniteNumber(price) || price <= 0) {
        errors.push('سعر ' + byId[id].sizeLabel + ' يجب أن يكون رقمًا أكبر من صفر');
        return;
      }
      if (!hasAtMostTwoDecimals(price)) {
        errors.push('سعر ' + byId[id].sizeLabel + ' لا يقبل أكثر من منزلتين عشريتين');
        return;
      }
      if (price > 10000) errors.push('سعر ' + byId[id].sizeLabel + ' أكبر من الحد المعقول');
    });

    // ترتيب منطقي: 30 ≤ 50 ≤ 100 مل. مخالفته ليست خطأً يمنع، لكنها غالبًا سهو.
    var ordered = (products || []).slice().sort(function (a, b) { return a.sizeMl - b.sizeMl; });
    for (var i = 1; i < ordered.length; i += 1) {
      var prev = ordered[i - 1];
      var cur = ordered[i];
      var prevPrice = order(prev.id, nextPrices, byId, prev.price);
      var curPrice = order(cur.id, nextPrices, byId, cur.price);
      if (curPrice < prevPrice) {
        warnings.push('سعر ' + cur.sizeLabel + ' (' + curPrice + ') أرخص من ' + prev.sizeLabel + ' (' + prevPrice + ')');
      }
    }
    return { errors: errors, warnings: warnings };
  }

  function order(id, nextPrices, byId, fallback) {
    var raw = nextPrices && Object.prototype.hasOwnProperty.call(nextPrices, id) ? nextPrices[id] : fallback;
    var n = Number(raw);
    return isFiniteNumber(n) ? n : fallback;
  }

  /* -------------------------- التحقق من التوصيل والخصم -------------------------- */

  function validateDelivery(next) {
    var errors = [];
    var zones = (next && next.zones) || [];
    if (!Array.isArray(zones) || zones.length < 1) errors.push('يجب وجود منطقة توصيل واحدة على الأقل');
    zones.forEach(function (zone) {
      var fee = Number(zone.fee);
      if (!isFiniteNumber(fee) || fee < 0) errors.push('رسم «' + zone.label + '» يجب أن يكون صفرًا أو أكثر');
      else if (!hasAtMostTwoDecimals(fee)) errors.push('رسم «' + zone.label + '» لا يقبل أكثر من منزلتين عشريتين');
    });
    if (next && next.defaultZone && !zones.some(function (z) { return z.id === next.defaultZone; })) {
      errors.push('المنطقة الافتراضية غير موجودة في القائمة');
    }
    return { errors: errors, warnings: [] };
  }

  function validateDiscount(percent) {
    var errors = [];
    var value = Number(percent);
    if (!isFiniteNumber(value) || value < 0) errors.push('نسبة الخصم يجب أن تكون صفرًا أو أكثر');
    else if (value > 90) errors.push('نسبة الخصم تتجاوز 90% — راجعها قبل الحفظ');
    else if (!hasAtMostTwoDecimals(value)) errors.push('نسبة الخصم لا تقبل أكثر من منزلتين عشريتين');
    return { errors: errors, warnings: [] };
  }

  /* ---------------------------- التحقق من العروض ---------------------------- */

  /**
   * يماثل قواعد محرّك العروض الحقيقي في js/offers.js حتى لا يقبل المحرّر
   * عرضًا سيرفضه المتجر بصمت. أي تشدّد هنا يوفر على المالك خيبة أمل لاحقًا.
   */
  function validateOffer(offer, products, offersConfig) {
    var errors = [];
    var base = {};
    (products || []).forEach(function (p) { base[p.id] = Math.round(Number(p.price) * 100); });

    if (!offer || typeof offer !== 'object') return { errors: ['العرض غير صالح'] };
    if (!offer.id || !/^[a-z0-9][a-z0-9-]{1,40}$/.test(String(offer.id))) {
      errors.push('المعرّف الداخلي يجب أن يكون أحرفًا إنجليزية صغيرة وأرقامًا وشرطات');
    }
    // نفس حكم المتجر: الاسم يجب أن يكون نصًا غير فارغ. نرفض المسافات وحدها
    // أيضًا لأن الاسم الأبيض يظهر فراغًا في السلة حتى لو قبله المحرّك.
    if (!offer.label || typeof offer.label !== 'string' || offer.label.trim().length < 2) {
      errors.push('اسم العرض مطلوب ليظهر للزبونة');
    }

    var type = offer.type;
    if (['percent', 'amount', 'sizePrice', 'bundle'].indexOf(type) === -1) {
      errors.push('نوع العرض غير مدعوم');
      return { errors: errors };
    }

    var value = Number(offer.value);
    if (!isFiniteNumber(value) || value <= 0) {
      errors.push('قيمة العرض يجب أن تكون رقمًا أكبر من صفر');
      return { errors: errors };
    }

    var cap = Number(offersConfig && offersConfig.maxPercent);
    if (!isFiniteNumber(cap) || cap < MAX_PERCENT_FLOOR) cap = 30;
    if (cap > MAX_PERCENT_CEILING) cap = MAX_PERCENT_CEILING;

    if (type === 'percent') {
      if (value > cap) errors.push('النسبة ' + value + '% تتجاوز السقف المسموح ' + cap + '%');
    }

    if (type === 'sizePrice') {
      if (!offer.sizeId || !base[offer.sizeId]) errors.push('عرض سعر الحجم يحتاج حجمًا موجودًا');
      else if (Math.round(value * 100) >= base[offer.sizeId]) {
        errors.push('السعر الجديد يجب أن يكون أقل من السعر الحالي — هذا ليس خصمًا');
      }
    }

    if (type === 'bundle') {
      var qty = Number(offer.qty);
      if (!isFiniteNumber(qty) || qty !== Math.floor(qty) || qty < 1 || qty > 10) {
        errors.push('عدد العبوات في العرض يجب أن يكون صحيحًا بين ١ و١٠');
      } else {
        var targets = offer.sizeId ? [offer.sizeId] : Object.keys(base);
        if (offer.sizeId && !base[offer.sizeId]) errors.push('حجم العرض غير موجود');
        else {
          // يجب أن يكون أرخص فعلًا لحجم واحد على الأقل، وإلا أسقطه المحرّك.
          var cheaper = targets.some(function (id) {
            return Math.round(value * 100) < base[id] * qty;
          });
          if (!cheaper) errors.push('سعر العبوة يجب أن يكون أقل من سعر العبوات مفردة');
        }
      }
    }

    var dateRe = /^\d{4}-\d{2}-\d{2}$/;
    if (offer.startsAt && !dateRe.test(offer.startsAt)) errors.push('تاريخ البداية بصيغة YYYY-MM-DD');
    if (offer.endsAt && !dateRe.test(offer.endsAt)) errors.push('تاريخ النهاية بصيغة YYYY-MM-DD');
    if (offer.startsAt && offer.endsAt && offer.endsAt < offer.startsAt) {
      errors.push('تاريخ النهاية قبل تاريخ البداية');
    }
    return { errors: errors };
  }

  function validateOffers(slots, products, offersConfig) {
    var errors = [];
    var warnings = [];
    var seen = {};
    (slots || []).forEach(function (offer, index) {
      var result = validateOffer(offer, products, offersConfig);
      result.errors.forEach(function (message) {
        errors.push('عرض ' + (index + 1) + ': ' + message);
      });
      if (offer && offer.id) {
        if (seen[offer.id]) warnings.push('المعرّف «' + offer.id + '» مكرر — سيُستخدم الأول فقط');
        seen[offer.id] = true;
      }
    });
    return { errors: errors, warnings: warnings };
  }

  /* ------------------------- أثر التعديل على المبالغ ------------------------- */

  /**
   * أثر التعديل على الزبونة، لمنتج واحد وكل تركيبة منطقة×طريقة.
   * هذا ما يهم المالك فعلًا: لا «صحة الصياغة» بل «كم ستدفع الزبونة».
   */
  function priceMatrix(config, nextPrices) {
    var products = (config.products || []).map(function (p) {
      var price = order(p.id, nextPrices, null, p.price);
      return { id: p.id, label: p.sizeLabel, price: price };
    });
    var zones = (config.delivery && config.delivery.zones) || [];
    var methods = (config.payment && config.payment.methods) || [];
    var alwaysFree = !(config.delivery && config.delivery.policy && config.delivery.policy.alwaysFree === false);
    var rows = [];
    products.forEach(function (product) {
      zones.forEach(function (zone) {
        methods.forEach(function (method) {
          var percent = method.available === false ? 0 : (Number(method.discountPercent) || 0);
          var discount = Math.round(product.price * 100 * percent / 100);
          var delivery = alwaysFree ? 0 : Math.round((Number(zone.fee) || 0) * 100);
          rows.push({
            productId: product.id,
            productLabel: product.label,
            zoneId: zone.id,
            zoneLabel: zone.label,
            methodId: method.id,
            methodLabel: method.label,
            subtotal: product.price,
            discountCents: discount,
            deliveryCents: delivery,
            total: Math.round((product.price * 100 - discount + delivery)) / 100
          });
        });
      });
    });
    return rows;
  }

  /* --------------------------- إنتاج ملف الإعدادات --------------------------- */

  /**
   * ينتج أسعار الأحجام كأسطر `price: X,` بنفس مواضع المصدر.
   * نعمل على النص لا على الكائن: إعادة كتابة الملف كاملًا تُفقد التعليقات
   * وتُنتج diffًا ضخمًا يصعب على المالك مراجعته.
   */
  function applyPricesToSource(source, nextPrices) {
    var applied = [];
    var output = String(source).replace(/(\bid:\s*'(serum-\d+)'[\s\S]*?)(\bprice:\s*)(\d+(?:\.\d+)?)/g, function (match, prefix, id, key, oldPrice) {
      if (!Object.prototype.hasOwnProperty.call(nextPrices || {}, id)) return match;
      var next = Number(nextPrices[id]);
      applied.push({ id: id, from: Number(oldPrice), to: next });
      return prefix + key + next;
    });
    return { source: output, applied: applied };
  }

  /** ينتج كائن العرض ناقصًا الحقول الفارغة ليُكتب في config.js بأقل ضجيج. */
  function normalizeOffer(offer) {
    var out = {
      id: String(offer.id).trim(),
      label: String(offer.label).trim(),
      type: offer.type,
      value: Number(offer.value),
      enabled: offer.enabled === true
    };
    if (offer.sizeId) out.sizeId = offer.sizeId;
    if (offer.type === 'bundle') out.qty = Number(offer.qty);
    if (offer.startsAt) out.startsAt = offer.startsAt;
    if (offer.endsAt) out.endsAt = offer.endsAt;
    if (offer.badge) out.badge = String(offer.badge).trim();
    return out;
  }

  /** أسطر JavaScript لعرض واحد، بنفس نمط المصدر — تُلصق في offers.slots. */
  function renderOfferLine(offer) {
    var normalized = normalizeOffer(offer);
    var parts = [];
    Object.keys(normalized).forEach(function (key) {
      var value = normalized[key];
      parts.push(key + ': ' + (typeof value === 'string' ? "'" + value.replace(/'/g, "\\'") + "'" : String(value)));
    });
    return '        { ' + parts.join(', ') + ' }';
  }

  /**
   * يحسب ملخصًا يقرأه المالك قبل الحفظ: ماذا سيتغير بالضبط.
   * لا يكتب أي ملف — القرار يبقى للمالك.
   */
  function summarizeChange(config, draft) {
    var lines = [];
    var nextPrices = (draft && draft.prices) || {};
    (config.products || []).forEach(function (p) {
      if (!Object.prototype.hasOwnProperty.call(nextPrices, p.id)) return;
      var to = Number(nextPrices[p.id]);
      if (to === p.price) return;
      var direction = to > p.price ? 'زيادة' : 'تخفيض';
      lines.push(p.sizeLabel + ': ' + direction + ' من $' + p.price + ' إلى $' + to);
    });
    if (draft && typeof draft.shamCashPercent === 'number') {
      var current = (config.payment.methods.filter(function (m) { return m.id === 'shamcash'; })[0] || {}).discountPercent;
      if (draft.shamCashPercent !== current) {
        lines.push('خصم شام كاش: من ' + current + '% إلى ' + draft.shamCashPercent + '%');
      }
    }
    if (draft && draft.alwaysFree !== undefined) {
      var nowFree = !(config.delivery.policy && config.delivery.policy.alwaysFree === false);
      if (draft.alwaysFree !== nowFree) {
        lines.push('سياسة التوصيل: ' + (draft.alwaysFree ? 'مجاني دائمًا' : 'رسوم حسب المنطقة'));
      }
    }
    if (draft && Array.isArray(draft.offers)) {
      var enabledNow = (config.offers.slots || []).filter(function (s) { return s.enabled === true; }).length;
      var enabledNext = draft.offers.filter(function (s) { return s.enabled === true; }).length;
      if (enabledNow !== enabledNext) lines.push('عدد العروض المفعّلة: من ' + enabledNow + ' إلى ' + enabledNext);
    }
    return lines;
  }

  return {
    validatePrices: validatePrices,
    validateDelivery: validateDelivery,
    validateDiscount: validateDiscount,
    validateOffer: validateOffer,
    validateOffers: validateOffers,
    priceMatrix: priceMatrix,
    applyPricesToSource: applyPricesToSource,
    normalizeOffer: normalizeOffer,
    renderOfferLine: renderOfferLine,
    summarizeChange: summarizeChange
  };
}

/**
 * يعمل في Node (استيراد ESM) وفي المتصفح عبر <script type="module">.
 * الواجهة على window اختيارية لتسهيل الاستخدام من أدوات لا تستورد وحدات.
 */
const pricingEditor = createPricingEditor();
if (typeof window !== 'undefined') window.RawaaPricingEditor = pricingEditor;
export default pricingEditor;
export { createPricingEditor };
