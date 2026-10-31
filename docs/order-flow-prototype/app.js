(function () {
  'use strict';

  var config = window.RAWAA_CONFIG;
  var pricing = window.RawaaOrderPricing;
  var withdrawalText = 'أرغب بإلغاء موافقتي على الرسائل التسويقية من رواء';

  function formatPrice(product, storeConfig) {
    return storeConfig.currency.symbol + Number(product.price).toFixed(Number.isInteger(Number(product.price)) ? 0 : 2);
  }
  function formatAmount(valueInCents, storeConfig) {
    var value = Number(valueInCents) / 100;
    var formatted = Number.isInteger(value) ? value.toFixed(0) : value.toFixed(2);
    return storeConfig.currency.symbol + formatted;
  }
  function buildWithdrawalUrl(number) {
    var digits = String(number || '');
    if (!/^\d{8,15}$/.test(digits)) return '';
    var url = new URL('https://wa.me/' + digits);
    url.searchParams.set('text', withdrawalText);
    return url.href;
  }
  function validPhone(value) {
    return /^\+?[0-9٠-٩ ()-]+$/.test(value) && (value.match(/[0-9٠-٩]/g) || []).length >= 7;
  }

  window.RawaaOrderPreview = Object.freeze({
    formatPrice: formatPrice,
    formatAmount: formatAmount,
    buildWithdrawalUrl: buildWithdrawalUrl,
    validPhone: validPhone
  });

  function init() {
    var form = document.getElementById('order-form');
    var select = document.getElementById('product');
    var quantityInput = document.getElementById('quantity');
    var summary = document.getElementById('product-reference');
    var status = document.getElementById('form-status');
    var zoneSelect = document.getElementById('delivery-zone');
    var methodSelect = document.getElementById('payment-method');
    var scentSelect = document.getElementById('scent-option');
    var oilSelect = document.getElementById('oil-option');
    var withdrawalLink = document.getElementById('withdraw-link');
    if (!config || !Array.isArray(config.products) || !form || !select || !quantityInput || !pricing) {
      if (status) status.textContent = 'تعذّر تحميل إعدادات المعاينة. لم يتم إرسال أي بيانات.';
      return;
    }

    quantityInput.min = String(config.cart.minQuantityPerItem || 1);
    quantityInput.max = String(config.cart.maxQuantityPerItem);

    function appendOptions(target, values, getValue, getLabel) {
      values.forEach(function (item) {
        var option = document.createElement('option');
        option.value = getValue(item);
        option.textContent = getLabel(item);
        target.append(option);
      });
    }
    appendOptions(select, config.products, function (item) { return item.id; }, function (item) {
      return item.sizeLabel + ' — ' + formatPrice(item, config) + ' (سعر مرجعي)';
    });
    appendOptions(zoneSelect, config.delivery.zones, function (item) { return item.id; }, function (item) { return item.label; });
    appendOptions(methodSelect, config.payment.methods.filter(function (item) { return item.available !== false; }), function (item) { return item.id; }, function (item) { return item.label; });
    var scents = config.customization.scentOptions.filter(function (item) { return item.id !== 'custom'; });
    appendOptions(scentSelect, scents, function (item) { return item.id; }, function (item) { return item.label; });
    var noOil = document.createElement('option'); noOil.value = ''; noOil.textContent = 'بدون إضافة'; oilSelect.append(noOil);
    appendOptions(oilSelect, config.customization.oilAdditions.filter(function (item) { return item.id !== 'other'; }), function (item) { return item.id; }, function (item) { return item.label; });
    zoneSelect.value = config.delivery.defaultZone;
    scentSelect.value = 'unscented';

    function updateEstimate() {
      var elements = {
        products: document.getElementById('estimate-products'),
        scent: document.getElementById('estimate-scent'),
        subtotal: document.getElementById('estimate-subtotal'),
        discount: document.getElementById('estimate-discount'),
        delivery: document.getElementById('estimate-delivery'),
        total: document.getElementById('estimate-total'),
        note: document.getElementById('estimate-note')
      };
      var quantity = Number(quantityInput.value);
      var item = config.products.find(function (candidate) { return candidate.id === select.value; });
      if (!item || !Number.isInteger(quantity) || quantity < 1 || quantity > config.cart.maxQuantityPerItem) {
        elements.note.textContent = 'أدخلي كمية صحيحة لحساب مرجع السعر. لم يُرسل أو يُحفظ شيء.';
        ['products', 'scent', 'subtotal', 'discount', 'delivery', 'total'].forEach(function (key) {
          elements[key].textContent = '—';
        });
        return;
      }
      try {
        var estimate = pricing.calculateOrderEstimate({
          items: [{ id: item.id, qty: quantity }],
          scent: scentSelect.value,
          oil: oilSelect.value,
          zone: zoneSelect.value,
          method: methodSelect.value
        }, config);
        elements.products.textContent = formatAmount(estimate.productCents, config);
        elements.scent.textContent = formatAmount(estimate.scentCents, config);
        elements.subtotal.textContent = formatAmount(estimate.subtotalCents, config);
        elements.discount.textContent = (estimate.discountCents > 0 ? '−' : '') + formatAmount(estimate.discountCents, config);
        elements.delivery.textContent = formatAmount(estimate.deliveryCents, config);
        elements.total.textContent = formatAmount(estimate.totalCents, config);
        elements.note.textContent = estimate.oilPricePending
          ? 'لا يشمل الإجمالي إضافة الزيت؛ سعرها وتوفّرها يحتاجان تأكيدًا من المتجر. الإجمالي كله مرجعي ويُعاد حسابه عند الربط.'
          : 'الإجمالي مرجعي فقط ويُعاد حسابه من إعدادات المتجر عند ربط الطلب؛ لم يُرسل أو يُحفظ شيء.';
      } catch {
        ['products', 'scent', 'subtotal', 'discount', 'delivery', 'total'].forEach(function (key) {
          elements[key].textContent = '—';
        });
        elements.note.textContent = 'تعذّر حساب هذا الاختيار. لم يُرسل أو يُحفظ شيء.';
      }
    }

    function updateReferences() {
      var product = config.products.find(function (item) { return item.id === select.value; });
      var zone = config.delivery.zones.find(function (item) { return item.id === zoneSelect.value; });
      var method = config.payment.methods.find(function (item) { return item.id === methodSelect.value && item.available !== false; });
      summary.textContent = product
        ? 'سعر المنتج المرجعي: ' + formatPrice(product, config) + ' للحبة الواحدة؛ قبل العطر والتوصيل.'
        : '';
      document.getElementById('delivery-reference').textContent = zone
        ? (method && method.freeDeliveryIn.includes(zone.id)
          ? 'تُذكر رسوم المنطقة الأساسية ' + config.currency.symbol + zone.fee + '، وقد تُعفى مع هذه الطريقة في هذه المنطقة؛ يؤكد المتجر ذلك قبل الطلب.'
          : 'رسوم التوصيل المرجعية لهذه المنطقة: ' + config.currency.symbol + zone.fee + '؛ يؤكد المتجر النهائي قبل الطلب.')
        : '';
      document.getElementById('payment-reference').textContent = method
        ? method.description + ' ' + method.confirmNote
        : '';
      document.getElementById('customization-reference').textContent =
        'العطر: ' + config.currency.symbol + config.customization.scentPrice + ' لكل عبوة عطرية. ' +
        config.customization.extraOilNote + ' لا تدخل إضافة الزيت في التقدير.';
      updateEstimate();
    }
    [select, zoneSelect, methodSelect, scentSelect, oilSelect, quantityInput].forEach(function (element) {
      element.addEventListener('change', updateReferences);
      if (element === quantityInput) element.addEventListener('input', updateReferences);
    });
    updateReferences();

    var withdrawalUrl = buildWithdrawalUrl(config.contact.whatsappNumber);
    if (withdrawalUrl) { withdrawalLink.href = withdrawalUrl; withdrawalLink.removeAttribute('aria-disabled'); }
    else {
      withdrawalLink.removeAttribute('href');
      withdrawalLink.setAttribute('aria-disabled', 'true');
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (!form.checkValidity()) {
        form.reportValidity();
        status.textContent = 'راجعي الحقول المطلوبة. لم يُرسل أو يُحفظ شيء.';
        return;
      }
      if (!validPhone(document.getElementById('customer-phone').value.trim())) {
        status.textContent = 'اكتبي رقمًا تجريبيًا بصيغة مقبولة (سبعة أرقام على الأقل). لم يُرسل أو يُحفظ شيء.';
        return;
      }
      if (!document.getElementById('processing-consent').checked) {
        status.textContent = 'موافقة معالجة الطلب مطلوبة في هذا النموذج التجريبي؛ لم يُرسل أو يُحفظ شيء.';
        return;
      }
      // This local prototype intentionally discards all entered values and never calls a service.
      form.reset();
      updateReferences();
      status.textContent = 'اجتاز الفحص المحلي. لم يُرسل الطلب، ولم تُحفظ البيانات أو أي موافقة.';
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
