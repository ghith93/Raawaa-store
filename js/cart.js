/**
 * RAWAA | رواء — منطق الواجهة والسلة وطلب واتساب.
 * السلة في ذاكرة الجلسة؛ فتح الطلب ينقل اختيارات الزائرة إلى واتساب فقط عند اختيارها.
 */
(function () {
  'use strict';

  var CONFIG = window.RAWAA_CONFIG;
  var MAX_QTY = (CONFIG && CONFIG.cart && CONFIG.cart.maxQuantityPerItem) || 10;
  var MIN_QTY = (CONFIG && CONFIG.cart && CONFIG.cart.minQuantityPerItem) || 1;

  /** حالة السلة: { productId: quantity } — في الذاكرة وذاكرة جلسة التبويب عند توفرها. */
  var cart = Object.create(null);

  var el = {};
  var lastFocused = null;

  /** طريقة الدفع المختارة — أول طريقة متاحة من الإعدادات. */
  var availableMethods = (CONFIG && CONFIG.payment && CONFIG.payment.methods || []).filter(function (m) {
    return m.available !== false;
  });
  var selectedMethodId = availableMethods.length ? availableMethods[0].id : null;

  /** منطقة التوصيل المختارة — الافتراضي من الإعدادات. */
  var zones = (CONFIG && CONFIG.delivery && CONFIG.delivery.zones) || [];
  var selectedZoneId = (CONFIG && CONFIG.delivery && CONFIG.delivery.defaultZone) || (zones[0] && zones[0].id) || null;

  function activeZone() {
    return zones.filter(function (z) { return z.id === selectedZoneId; })[0] || zones[0] || null;
  }

  /** هل التوصيل مجاني لهذه الطريقة في هذه المنطقة؟ */
  function isFreeDelivery(method, zone) {
    if (!method || !zone) return false;
    return Array.isArray(method.freeDeliveryIn) && method.freeDeliveryIn.indexOf(zone.id) !== -1;
  }

  /** رسوم التوصيل الفعلية = 0 إن كانت مجانية، وإلا رسم المنطقة. */
  function deliveryFeeFor(method, zone) {
    if (!zone) return 0;
    if (isFreeDelivery(method, zone)) return 0;
    return zone.fee || 0;
  }

  /* ------------------------------ أدوات مساعدة ------------------------------ */

  function money(value) {
    var isInt = Math.abs(value - Math.round(value)) < 0.005;
    var formatted = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: isInt ? 0 : 2,
      maximumFractionDigits: 2
    }).format(value);
    return CONFIG.currency.symbol + formatted;
  }

  /** تحويل إلى سنتات لتجنّب أخطاء الفواصل العشرية في الجمع. */
  function toCents(value) { return Math.round(value * 100); }

  function getProduct(id) {
    return CONFIG.products.filter(function (p) { return p.id === id; })[0] || null;
  }

  /** يضيف الحملة ونسخة المحتوى إلى رسالة واتساب إن وُجدتا؛ لا يثبت إرسالًا أو بيعًا. */
  function withSourceTag(text) {
    var note = typeof window.rawaaSourceNote === 'function' ? window.rawaaSourceNote() : '';
    if (!note) return text;
    return text + '\n\n' + note;
  }

  function waLink(text) {
    return 'https://wa.me/' + CONFIG.contact.whatsappNumber +
      (text ? '?text=' + encodeURIComponent(withSourceTag(text)) : '');
  }

  function announce(message) {
    if (!el.toastRegion) return;
    var toast = document.createElement('p');
    toast.className = 'toast';
    toast.textContent = message;
    el.toastRegion.appendChild(toast);
    window.setTimeout(function () {
      toast.remove();
    }, 3200);
  }


  /** يبني عنصر <picture> من إعدادات الصورة (AVIF ← WebP ← JPEG). */

  /* ------------------------------ بناء بطاقات المنتجات ------------------------------ */


  /* ------------------------ اختيار الحجم -----------------------------
     منتج واحد، ثلاثة أحجام. القرار يصبح «أي حجم» لا «أي منتج» — وهذا ما
     تفعله Gisou و Rhode: منتج البطل واحد، والحجم خيار داخله.
     الاختيار يُخزَّن في selectedSize، وزر الإضافة يستخدمه. */

  var selectedSize = null;

  function selectedProduct() {
    var id = selectedSize || (CONFIG.products[1] && CONFIG.products[1].id) || 'serum-50';
    return getProduct(id) || CONFIG.products[0];
  }

  /** رابط السؤال يتبع الاختيار دون فتح واتساب أو إرسال رسالة. */
  function updateSelectedInquiry(product) {
    var links = document.querySelectorAll('[data-wa-selected]');
    if (!links.length || !product) return;
    var lines = [
      'مرحبًا رواء، أود الاستفسار عن ' + product.name + ' بحجم ' + product.sizeLabel + '.',
      'سعر العبوة المرجعي: ' + money(product.price + scentFee()) + ' قبل الخصم والتوصيل؛ سعر الزيت إن اختير يُؤكّد.'
    ];
    var cfg = CONFIG.customization || {};
    var scent = (cfg.scentOptions || []).filter(function (o) { return o.id === custom.scent; })[0];
    var oil = (cfg.oilAdditions || []).filter(function (o) { return o.id === custom.oil; })[0];
    if (scent) lines.push('العطر الذي أستفسر عنه: ' + scent.label + '.');
    if (oil) lines.push('إضافة الزيت التي أستفسر عنها: ' + oil.label + '.');
    lines.push('هل يمكن تأكيد التوفّر والسعر النهائي وموعد تجهيز العبوة والتوصيل؟');
    var href = waLink(lines.join('\n'));
    Array.prototype.forEach.call(links, function (link) { link.setAttribute('href', href); });
  }

  /** تُفتح الإجابة عند الوصول إليها بالاختصار، والرابط يعمل أيضًا دون نص برمجي. */
  function initProductShortcuts() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-expand-target]'), function (link) {
      link.addEventListener('click', function () {
        var id = (link.getAttribute('href') || '').replace(/^#/, '');
        var target = document.getElementById(id);
        if (target && target.tagName === 'DETAILS') target.open = true;
      });
    });
  }

  function renderSizePicker() {
    var host = document.querySelector('[data-size-options]');
    if (!host || !CONFIG.products.length) return;
    host.textContent = '';

    CONFIG.products.forEach(function (product, index) {
      var isDefault = index === 1 || CONFIG.products.length === 1;
      if (selectedSize === null && isDefault) selectedSize = product.id;

      var label = document.createElement('label');
      label.className = 'size-option' + (product.badge ? ' size-option--featured' : '');
      label.setAttribute('data-size-for', product.id);

      var radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'rawaa-size';
      radio.value = product.id;
      radio.className = 'size-option-input';
      radio.checked = product.id === selectedSize;
      radio.addEventListener('change', function () {
        if (radio.checked) selectSize(product.id);
      });

      var body = document.createElement('span');
      body.className = 'size-option-body';

      var size = document.createElement('span');
      size.className = 'size-option-size';
      size.textContent = product.sizeLabel;

      var price = document.createElement('span');
      price.className = 'size-option-price';
      price.textContent = money(product.price);

      body.appendChild(size);
      body.appendChild(price);

      if (product.badge) {
        var flag = document.createElement('span');
        flag.className = 'size-option-flag';
        flag.textContent = product.badge;
        body.appendChild(flag);
      }

      label.appendChild(radio);
      label.appendChild(body);
      host.appendChild(label);
    });

    syncSizeUI();
  }

  function selectSize(id) {
    if (!getProduct(id)) return;
    selectedSize = id;
    saveChoices();
    syncSizeUI();
  }

  function syncSizeUI() {
    if (!selectedSize) return;
    var product = selectedProduct();
    if (!product) return;

    Array.prototype.forEach.call(document.querySelectorAll('.size-option'), function (node) {
      var on = node.getAttribute('data-size-for') === selectedSize;
      node.classList.toggle('is-selected', on);
      var input = node.querySelector('input');
      if (input) input.checked = on;
    });

    var priceNode = document.querySelector('[data-price-live]');
    if (priceNode) priceNode.innerHTML = '<bdi>' + money(product.price) + '</bdi> <span>' + product.sizeLabel + '</span>';

    var unitNode = document.querySelector('[data-unit-live]');
    if (unitNode && product.sizeMl && product.price) {
      var per = product.price / product.sizeMl;
      unitNode.innerHTML = '<bdi>' + CONFIG.currency.symbol + (per >= 0.1 ? per.toFixed(2) : per.toFixed(3)) + '</bdi> تقريبًا لكل مل قبل الخصم والتوصيل.';
    }

    // صورة البطاقة تتبع الحجم المختار — ترى الزائنة العبوة التي تختارها فعلًا
    var img = document.querySelector('[data-size-img]');
    var srcAvif = document.querySelector('[data-size-avif]');
    var srcWebp = document.querySelector('[data-size-webp]');
    var base = product.image && product.image.base;
    if (img && base) {
      var widths = (product.image.widths || [480, 720, 900]);
      var setOf = function (ext) {
        var files = product.image[ext] || [];
        return widths.map(function (w, i) {
          return 'assets/img/products/' + files[i] + ' ' + w + 'w';
        }).join(', ');
      };
      if (srcAvif) srcAvif.setAttribute('srcset', setOf('avif'));
      if (srcWebp) srcWebp.setAttribute('srcset', setOf('webp'));
      img.setAttribute('src', product.image.src);
      img.setAttribute('alt', 'عبوة سيروم زيوت رواء ' + product.sizeLabel + ' — تصميم مقترح، ليست صورة للمنتج الفعلي');
    }

    // زر الإضافة يتبع الحجم المختار — الـ id لا يُكتب في HTML
    Array.prototype.forEach.call(document.querySelectorAll('[data-add-current]'), function (btn) {
      btn.setAttribute('data-add-to-cart', selectedSize);
      if (btn.hasAttribute('data-requires-js')) btn.disabled = false;
    });
    updateSelectedInquiry(product);
    refreshOrderEstimate();
  }


  /* ---------------------------- التخصيص ------------------------------
     العطر والزيوت المضافة — تُحفظ في الذاكرة وتُرسل في رسالة واتساب.
     هذا هو التخصيص الذي نملكه فعلًا: القاعدة ثابتة، والاختيار حسّي. */
  var custom = { scent: '', oil: '' };

  function scentFee() {
    return custom.scent && custom.scent !== 'unscented' ? (CONFIG.customization.scentPrice || 0) : 0;
  }

  function setCustom(field, value) {
    if (field !== 'scent' && field !== 'oil') return;
    var cfg = CONFIG.customization || {};
    var options = field === 'scent' ? (cfg.scentOptions || []) : (cfg.oilAdditions || []);
    if (value && !options.some(function (o) { return o.id === value; })) return;
    custom[field] = value || '';
    saveChoices();
    syncCustomChips();
    renderCustomSummary();
    updateSelectedInquiry(selectedProduct());
    refreshOrderEstimate();
    if (el.items) renderCart();
  }

  function syncCustomChips() {
    ['scent', 'oil'].forEach(function (field) {
      Array.prototype.forEach.call(document.querySelectorAll('[data-custom-' + field + ']'), function (chip) {
        var selected = chip.getAttribute('data-custom-' + field) === custom[field];
        chip.classList.toggle('is-selected', selected);
        chip.setAttribute('aria-pressed', selected ? 'true' : 'false');
      });
    });
  }

  function renderCustomSummary() {
    var host = document.querySelector('[data-custom-summary]');
    if (!host) return;
    var parts = [];
    var cfg = CONFIG.customization || {};
    var chosenScent = null;
    if (custom.scent) {
      chosenScent = (cfg.scentOptions || []).filter(function (o) { return o.id === custom.scent; })[0];
      if (chosenScent) parts.push('العطر: ' + chosenScent.label);
    }
    if (custom.oil) {
      var ol = (cfg.oilAdditions || []).filter(function (o) { return o.id === custom.oil; })[0];
      if (ol) parts.push('إضافة: ' + ol.label + (ol.note ? ' — ' + ol.note : ''));
    }
    var note = chosenScent && chosenScent.note ? chosenScent.note : '';
    host.textContent = parts.length
      ? parts.join(' · ') + (note ? ' · ' + note : '')
      : 'العطر والإضافة اختياريان — نؤكد الخيارات المتاحة في واتساب.';
  }

  /* ------------------------------ السلة ------------------------------ */

  function cartEntries() {
    return Object.keys(cart)
      .map(function (id) {
        var product = getProduct(id);
        return product ? { product: product, qty: cart[id] } : null;
      })
      .filter(Boolean);
  }

  function getMethod(id) {
    return availableMethods.filter(function (m) { return m.id === id; })[0] || availableMethods[0] || null;
  }

  function activeMethod() { return getMethod(selectedMethodId); }

  /** حساب مشترك للسلة وتقدير العبوة الواحدة؛ الأرقام كلها بالسنتات. */
  function calculateAmounts(subtotalCents, count, method, zone) {
    var discountCents = method ? Math.round(subtotalCents * (method.discountPercent || 0) / 100) : 0;
    var deliveryCents = (method && count > 0) ? toCents(deliveryFeeFor(method, zone)) : 0;
    return {
      subtotalCents: subtotalCents,
      discountCents: discountCents,
      deliveryCents: deliveryCents,
      totalCents: subtotalCents - discountCents + deliveryCents
    };
  }

  /**
   * محرّك الحساب: قيمة المنتجات ← الخصم ← رسوم التوصيل ← الإجمالي المرجعي.
   * كل الأرقام بالسنتات لتفادي أخطاء الفواصل العشرية.
   * الخصم والرسوم تأتيان من CONFIG.payment — لا قيمة مكتوبة يدويًا هنا.
   */
  function pricing() {
    var entries = cartEntries();
    var subtotalCents = 0;
    var count = 0;

    entries.forEach(function (entry) {
      subtotalCents += toCents(entry.product.price + scentFee()) * entry.qty;
      count += entry.qty;
    });

    var method = activeMethod();
    var zone = activeZone();
    var amounts = calculateAmounts(subtotalCents, count, method, zone);

    return {
      entries: entries,
      count: count,
      subtotalCents: amounts.subtotalCents,
      discountCents: amounts.discountCents,
      deliveryCents: amounts.deliveryCents,
      totalCents: amounts.totalCents,
      method: method,
      zone: zone,
      freeDelivery: isFreeDelivery(method, zone)
    };
  }

  /** واجهة مبسّطة بالقيم العشرية — تُستخدم في العرض والاختبارات. */
  function totals() {
    var p = pricing();
    return {
      cents: p.totalCents,
      amount: p.totalCents / 100,
      count: p.count,
      entries: p.entries,
      method: p.method,
      zone: p.zone,
      freeDelivery: p.freeDelivery,
      subtotal: p.subtotalCents / 100,
      discount: p.discountCents / 100,
      delivery: p.deliveryCents / 100
    };
  }

  /** حاسبة منتج واحد؛ خياراتها هي خيارات السلة نفسها وليست طلبًا مؤكدًا. */
  function initOrderEstimate() {
    var box = document.querySelector('[data-order-estimate]');
    if (!box || !zones.length || !availableMethods.length || !selectedProduct() || !activeZone() || !activeMethod()) return;
    if (box.getAttribute('data-ready') === 'true') { refreshOrderEstimate(); return; }
    var zoneSelect = box.querySelector('[data-estimate-zone]');
    var methodSelect = box.querySelector('[data-estimate-method]');
    var controls = box.querySelector('[data-estimate-interface]');
    var fallback = box.querySelector('[data-estimate-fallback]');
    if (!zoneSelect || !methodSelect || !controls || !fallback) return;
    zones.forEach(function (zone) {
      var opt = document.createElement('option');
      opt.value = zone.id;
      opt.textContent = zone.label;
      zoneSelect.appendChild(opt);
    });
    availableMethods.forEach(function (method) {
      var opt = document.createElement('option');
      opt.value = method.id;
      opt.textContent = method.short || method.label;
      methodSelect.appendChild(opt);
    });
    zoneSelect.addEventListener('change', function () { setZone(zoneSelect.value, true); });
    methodSelect.addEventListener('change', function () { setMethod(methodSelect.value, true); });
    box.setAttribute('data-ready', 'true');
    refreshOrderEstimate();
    fallback.hidden = true;
    controls.hidden = false;
  }

  function refreshOrderEstimate() {
    var box = document.querySelector('[data-order-estimate]');
    if (!box || box.getAttribute('data-ready') !== 'true') return;
    var product = selectedProduct();
    var zone = activeZone();
    var method = activeMethod();
    if (!product || !zone || !method) return;
    var amounts = calculateAmounts(toCents(product.price + scentFee()), 1, method, zone);
    box.querySelector('[data-estimate-zone]').value = zone.id;
    box.querySelector('[data-estimate-method]').value = method.id;
    box.querySelector('[data-estimate-context]').textContent = product.sizeLabel + ' · ' + zone.label + ' · ' + (method.short || method.label);
    box.querySelector('[data-estimate-total]').textContent = money(amounts.totalCents / 100);
    box.querySelector('[data-estimate-subtotal]').textContent = money(amounts.subtotalCents / 100);
    box.querySelector('[data-estimate-discount]').textContent = amounts.discountCents > 0 ? '− ' + money(amounts.discountCents / 100) : 'لا يوجد';
    box.querySelector('[data-estimate-delivery]').textContent = amounts.deliveryCents > 0 ? money(amounts.deliveryCents / 100) : 'مجاني';
    var oilNote = box.querySelector('[data-estimate-oil-note]');
    if (oilNote) oilNote.hidden = !custom.oil;
  }

  function clampQty(qty) {
    return Math.max(MIN_QTY, Math.min(MAX_QTY, Math.floor(qty) || MIN_QTY));
  }

  function renderCart() {
    var summary = totals();
    var focus = document.activeElement;
    var focusKey = null;
    var focusValue = null;
    if (el.dialog && el.dialog.open && focus && el.dialog.contains(focus)) {
      ['data-zone-select', 'data-pay-select', 'data-qty-increase', 'data-qty-decrease', 'data-remove-item']
        .some(function (key) {
          if (!focus.hasAttribute(key)) return false;
          focusKey = key;
          focusValue = focus.getAttribute(key);
          return true;
        });
    }

    // الشارة
    if (el.count) {
      if (summary.count > 0) {
        el.count.hidden = false;
        el.count.textContent = String(summary.count);
      } else {
        el.count.hidden = true;
        el.count.textContent = '0';
      }
      var countButton = el.count.closest('[data-cart-open]');
      if (countButton) countButton.setAttribute('aria-label', summary.count > 0
        ? 'فتح سلة المشتريات، ' + summary.count + ' في السلة'
        : 'فتح سلة المشتريات، السلة فارغة');
    }

    // عناصر السلة
    el.items.textContent = '';
    summary.entries.forEach(function (entry) {
      el.items.appendChild(buildCartItem(entry.product, entry.qty));
    });

    var isEmpty = summary.count === 0;
    el.empty.hidden = !isEmpty;
    el.foot.hidden = isEmpty;
    if (el.orderOptions) el.orderOptions.hidden = isEmpty;

    if (!isEmpty) {
      renderZones();
      renderPaymentMethods();
      renderSummary(summary);
    }
    renderCartCustomSummary(isEmpty);

    // زر «مشاركة السلة»
    if (el.shareBtn) {
      var shareUrl = summary.count > 0 ? cartShareLink() : '';
      el.shareBtn.hidden = !shareUrl;
      if (shareUrl) el.shareBtn.setAttribute('data-share-url', shareUrl);
    }

    // شريط السلة اللاصق على الهاتف — يُحسب أولًا، لأن شريط الشراء المبكّر
    // يعتمد عليه في تحديد موضعه (كانا يتراكبان على الشاشات الصغيرة).
    if (el.stickyBar) {
      if (!isEmpty && !(el.dialog && el.dialog.open)) {
        el.stickyBar.hidden = false;
        document.body.classList.add('has-sticky-bar');
        if (el.stickyCount) el.stickyCount.textContent = String(summary.count);
        if (el.stickyTotal) el.stickyTotal.textContent = money(summary.amount);
      } else {
        el.stickyBar.hidden = true;
        document.body.classList.remove('has-sticky-bar');
      }
    }

    // شريط الشراء المبكّر (قبل وجود أي منتج)
    updateShopBar(isEmpty);

    // إعادة بناء رابط واتساب وزر النسخ
    if (el.fallbackLink && !isEmpty) {
      el.fallbackLink.setAttribute('href', waLink(buildOrderMessage()));
    }
    if (el.copyText) el.copyText.value = isEmpty ? '' : withSourceTag(buildOrderMessage());
    if (el.copyStatus) el.copyStatus.textContent = '';
    if (isEmpty && el.copyManual) el.copyManual.hidden = true;
    refreshOrderEstimate();
    fitCartFooter();

    // إعادة بناء خيارات السلة لا يجب أن تُخرج مستخدمة لوحة المفاتيح من الحوار.
    if (focusKey && el.dialog && el.dialog.open) {
      var findFocus = function (key) {
        return Array.prototype.filter.call(el.dialog.querySelectorAll('[' + key + ']'), function (node) {
          return node.getAttribute(key) === focusValue && !node.disabled;
        })[0];
      };
      var replacement = findFocus(focusKey);
      if (!replacement && focusKey === 'data-qty-increase') replacement = findFocus('data-qty-decrease');
      if (!replacement && focusKey === 'data-qty-decrease') replacement = findFocus('data-qty-increase');
      if (!replacement && focusKey === 'data-remove-item') replacement = el.closeBtn;
      if (replacement) {
        try { replacement.focus({ preventScroll: true }); } catch { replacement.focus(); }
      }
    }
  }

  /** اختيارات العطر والإضافة استفسار للطلب كله، لا حجز أو ضمان توفر. */
  function renderCartCustomSummary(isEmpty) {
    if (!el.cartCustomSummary) return;
    var cfg = CONFIG.customization || {};
    var scent = (cfg.scentOptions || []).filter(function (o) { return o.id === custom.scent; })[0];
    var oil = (cfg.oilAdditions || []).filter(function (o) { return o.id === custom.oil; })[0];
    var parts = [];
    if (scent) parts.push('العطر: ' + scent.label);
    if (oil) parts.push('إضافة زيت: ' + oil.label + ' (السعر يؤكد في واتساب وغير مشمول بالإجمالي)');
    el.cartCustomSummary.hidden = isEmpty || !parts.length;
    el.cartCustomSummary.textContent = parts.length
      ? 'للاستفسار عن الطلب ككل: ' + parts.join(' · ') + '؛ نؤكد التوفّر في واتساب.'
      : '';
  }

  /** صفوف الملخّص: قيمة المنتجات، الخصم، التوصيل، الإجمالي المرجعي. */
  function renderSummary(summary) {
    var method = summary.method;

    if (el.subtotal) el.subtotal.textContent = money(summary.subtotal);
    if (el.subtotalRow) el.subtotalRow.hidden = false;

    if (el.discountRow) {
      if (summary.discount > 0) {
        el.discountRow.hidden = false;
        if (el.discountValue) {
          el.discountValue.textContent = '− ' + money(summary.discount);
        }
        if (el.discountLabel && method) {
          el.discountLabel.textContent = 'خصم ' + method.short + ' (' + (method.discountPercent || 0) + '%)';
        }
      } else {
        el.discountRow.hidden = true;
      }
    }

    if (el.zoneLabel && summary.zone) {
      el.zoneLabel.textContent = 'منطقة التوصيل: ' + summary.zone.label;
    }

    if (el.deliveryRow) {
      if (summary.freeDelivery) {
        el.deliveryRow.hidden = false;
        if (el.deliveryValue) el.deliveryValue.textContent = 'مجاني';
      } else if (summary.delivery > 0) {
        el.deliveryRow.hidden = false;
        if (el.deliveryValue) el.deliveryValue.textContent = money(summary.delivery);
      } else {
        el.deliveryRow.hidden = true;
      }
    }

    if (el.total) el.total.textContent = money(summary.amount);
    if (el.cartContext) {
      el.cartContext.textContent = [summary.zone && summary.zone.label, method && (method.short || method.label)]
        .filter(Boolean).join(' · ');
    }

    // تنبيه شفاف: تركيبة قد لا تغطي التكلفة
    if (el.marginNote && summary.count > 0 && summary.zone && summary.method) {
      var c = CONFIG.costing;
      // التكلفة ثابتة لكل عبوة بغضّ النظر عن الحجم (من المالك) — نأخذ الحد الأعلى
      var costOfUnit = function () {
        return c ? (c.unitCostMax || c.unitCostMin || 0) : 0;
      };
      var worst = null;
      summary.entries.forEach(function (e) {
        var net = e.product.price * (1 - (summary.method.discountPercent || 0) / 100);
        var profit = net - summary.delivery - costOfUnit();
        if (profit <= 0 && (!worst || profit < worst.profit)) {
          worst = { size: e.product.sizeLabel, profit: profit };
        }
      });
      if (worst) {
        el.marginNote.hidden = false;
        el.marginNote.textContent =
          'ملاحظة: الحجم ' + worst.size + ' في هذه المنطقة لا يغطي تكلفته مع هذه الطريقة. ' +
          'يمكن اختيار «الدفع عند الاستلام»، أو طلب حجم أكبر، أو إضافة حجم آخر — ' +
          'وسنؤكد لك السعر النهائي في المحادثة.';
      } else {
        el.marginNote.hidden = true;
      }
    }

    if (el.totalNote) {
      el.totalNote.textContent = method
        ? 'الإجمالي المرجعي بطريقة «' + method.label + '». الأسعار تُؤكَّد في المحادثة قبل الشحن.'
        : 'الأسعار تُؤكَّد في المحادثة قبل الشحن.';
    }
  }





  /** هل السلة فارغة الآن؟ */
  function cartIsEmpty() {
    return !cart || Object.keys(cart).length === 0;
  }

  /**
   * شريط الشراء المبكّر — يظهر حين: (١) الشاشة هاتف، (٢) السلة فارغة،
   * (٣) تجاوزت الزائرة قسم الأحجام. الغرض: مسار شراء دائم الظهور بلا تمرير طويل.
   * يُخفى فور وجود أي منتج في السلة (يحلّ محلّه الشريط اللاصق الكامل).
   */
  function updateShopBar(isEmpty) {
    var bar = document.querySelector('[data-shop-bar]');
    if (!bar) return;
    var productsSection = document.getElementById('products');
    if (!productsSection) { bar.hidden = true; return; }

    var isPhone = window.matchMedia('(max-width: 899px)').matches;
    var passed = productsSection.getBoundingClientRect().bottom < 0;
    var show = isPhone && isEmpty && passed;

    bar.hidden = !show;
    document.body.classList.toggle('has-shop-bar', show);
    // الحالة تُعاد لكل شاشة عرض: تغيير الحجم بين هاتف وسطح مكتب كان يترك
    // حالة قديمة على <body> فتبقى مساحة محجوزة أسفل الصفحة بلا سبب.
    document.body.classList.toggle('has-sticky-bar', !isEmpty);
  }

  /**
   * حاسبة التوصيل — تعرض الإجمالي النهائي لحجم 50 مل بحسب المحافظة وطريقة الدفع.
   * تستخدم نفس دوال التسعير المستخدمة في السلة، فلا يمكن أن يختلف الرقمان.
   */
  function renderCalculator() {
    var box = document.querySelector('[data-calc]');
    if (!box) return;

    var govSel = box.querySelector('[data-calc-gov]');
    var paySel = box.querySelector('[data-calc-pay]');
    var outSub = box.querySelector('[data-calc-sub]');
    var outDisc = box.querySelector('[data-calc-disc]');
    var outDeliv = box.querySelector('[data-calc-deliv]');
    var outTotal = box.querySelector('[data-calc-total]');
    var outNote = box.querySelector('[data-calc-note]');
    if (!govSel || !paySel) return;

    var sample = CONFIG.products[1] || CONFIG.products[0];
    if (!sample) return;

    // املأ المحافظات من الإعدادات
    if (govSel.options.length <= 2 && CONFIG.delivery && CONFIG.delivery.governorates) {
      govSel.innerHTML = '';
      CONFIG.delivery.governorates.forEach(function (name) {
        var opt = document.createElement('option');
        var isHama = name === 'حماة';
        opt.value = isHama ? 'hama' : 'other';
        opt.textContent = name;
        if (isHama) opt.selected = true;
        govSel.appendChild(opt);
      });
    }

    function update() {
      var zoneId = govSel.value;
      var methodId = paySel.value;
      var method = CONFIG.payment.methods.filter(function (m) { return m.id === methodId; })[0];
      var zone = CONFIG.delivery.zones.filter(function (z) { return z.id === zoneId; })[0];
      if (!method || !zone) return;

      var amounts = calculateAmounts(toCents(sample.price), 1, method, zone);

      outSub.textContent = money(amounts.subtotalCents / 100);
      outDisc.textContent = amounts.discountCents > 0
        ? '− ' + money(amounts.discountCents / 100) + ' (' + method.discountPercent + '%)'
        : 'لا يوجد';
      outDeliv.textContent = amounts.deliveryCents > 0 ? money(amounts.deliveryCents / 100) : 'مجاني';
      outTotal.textContent = money(amounts.totalCents / 100);

      var note = '';
      if (methodId === 'shamcash' && zoneId !== 'hama') {
        note = 'مع شام كاش خارج حماة: الخصم 10% يُطبَّق، والتوصيل 4 دولارات تبقى. المجاني داخل حماة فقط.';
      } else if (methodId === 'shamcash') {
        note = 'داخل حماة مع شام كاش: خصم 10% وتوصيل مجاني — أفضل سعر متاح.';
      } else {
        note = 'الدفع عند الاستلام: بلا خصم، وتُضاف رسوم التوصيل. المبلغ يُدفع كاملًا للمندوب.';
      }
      outNote.textContent = note;
    }

    govSel.addEventListener('change', update);
    paySel.addEventListener('change', update);
    update();
  }

  /**
   * قسم «ما لا نقدّمه» — يُبنى من CONFIG.trust فقط.
   * الغرض: نفي الادعاءات قبل أن يسأل الزبون، وهو أقوى وسيلة ثقة لمنتج جديد.
   */
  function renderTrust() {
    var host = document.querySelector('[data-trust]');
    if (!host || !CONFIG.trust || !CONFIG.trust.items) return;
    if (host.querySelector('.trust-item')) return;   // لا تكرّر البناء

    CONFIG.trust.items.forEach(function (text) {
      var item = document.createElement('p');
      item.className = 'trust-item';
      var mark = document.createElement('span');
      mark.className = 'trust-mark';
      mark.setAttribute('aria-hidden', 'true');
      mark.textContent = '—';
      var body = document.createElement('span');
      body.textContent = text;
      item.appendChild(mark);
      item.appendChild(body);
      host.appendChild(item);
    });
  }

  /**
   * بطاقات شرح طرق الدفع في قسم الصفحة — تُبنى من CONFIG.payment فقط.
   * الأمثلة تُحسب من سعر الحجم الوسط، فلا يوجد أي رقم مكتوب يدويًا في HTML.
   */
  function renderPaymentCards() {
    var host = document.querySelector('[data-pay-cards]');
    if (!host) return;

    var sample = CONFIG.products[1] || CONFIG.products[0];
    if (!sample) return;

    availableMethods.forEach(function (method) {
      var isBest = (method.discountPercent || 0) > 0;

      var card = document.createElement('article');
      card.className = 'pay-card' + (isBest ? ' pay-card-featured' : '');

      if (isBest) {
        var badge = document.createElement('p');
        badge.className = 'pay-badge';
        badge.textContent = 'وفّر ' + method.discountPercent + '%';
        card.appendChild(badge);
      }

      var title = document.createElement('h3');
      title.textContent = method.label;
      card.appendChild(title);

      var list = document.createElement('ul');
      list.className = 'pay-points';

      var points = [];
      if ((method.discountPercent || 0) > 0) {
        points.push('خصم <strong>' + method.discountPercent + '%</strong> على قيمة المنتجات');
      } else {
        points.push('بلا خصم');
      }
      var z = activeZone();
      points.push(isFreeDelivery(method, z)
        ? 'توصيل <strong>مجاني</strong> داخل ' + (z ? z.label : 'حماة')
        : 'رسوم توصيل <strong>' + money(deliveryFeeFor(method, z)) + '</strong> (' +
          (z ? z.label : '') + ') تُضاف إلى الإجمالي');
      points.push(method.requiresReceipt
        ? 'إرسال إشعار التحويل على واتساب لتأكيد الدفع'
        : 'تدفعين المبلغ كاملًا عند استلام الطلب');

      points.forEach(function (html) {
        var li = document.createElement('li');
        li.innerHTML = html; // محتوى من الإعدادات المحلية فقط، لا مدخلات مستخدم
        list.appendChild(li);
      });

      card.appendChild(list);

      // مثال محسوب من نفس معادلة السلة
      var unitCents = toCents(sample.price);
      var discountCents = Math.round(unitCents * (method.discountPercent || 0) / 100);
      var deliveryCents = toCents(deliveryFeeFor(method, activeZone()));
      var finalCents = unitCents - discountCents + deliveryCents;

      var example = document.createElement('p');
      example.className = 'pay-example';
      example.innerHTML = 'مثال: سيروم ' + sample.sizeLabel + ' بسعر ' +
        money(sample.price) + ' ← تدفعين <strong>' + money(finalCents / 100) + '</strong>' +
        (isFreeDelivery(method, activeZone()) ? ' مع توصيل مجاني.' : ' شامل التوصيل.');
      card.appendChild(example);

      // رابط مشاركة العرض نفسه (للمنشورات والإعلانات)
      var share = document.createElement('a');
      share.className = 'pay-share';
      share.href = offerLink(method.id);
      share.textContent = 'رابط هذا العرض';
      share.setAttribute('aria-label', 'رابط مباشر لطريقة ' + method.label);
      card.appendChild(share);

      host.appendChild(card);
    });
  }

  /** أزرار اختيار منطقة التوصيل — تُبنى من CONFIG.delivery.zones. */
  function renderZones() {
    if (!el.zones) return;
    el.zones.textContent = '';

    var legend = document.createElement('legend');
    legend.className = 'pay-legend';
    legend.textContent = 'منطقة التوصيل';
    el.zones.appendChild(legend);

    zones.forEach(function (zone) {
      var label = document.createElement('label');
      label.className = 'zone-option';

      var input = document.createElement('input');
      input.type = 'radio';
      input.name = 'delivery-zone';
      input.value = zone.id;
      input.checked = zone.id === selectedZoneId;
      input.dataset.zoneSelect = zone.id;

      var txt = document.createElement('span');
      txt.className = 'zone-text';
      var name = document.createElement('span');
      name.className = 'zone-name';
      name.textContent = zone.label;
      var fee = document.createElement('span');
      fee.className = 'zone-fee';
      var amount = deliveryFeeFor(activeMethod(), zone);
      if (amount > 0) {
        fee.appendChild(document.createTextNode('توصيل '));
        var bdi = document.createElement('bdi');
        bdi.textContent = money(amount);
        fee.appendChild(bdi);
      } else {
        fee.textContent = 'توصيل مجاني';
      }
      txt.appendChild(name);
      txt.appendChild(fee);

      label.appendChild(input);
      label.appendChild(txt);
      el.zones.appendChild(label);
    });
  }

  function setZone(id, silent) {
    if (!zones.some(function (z) { return z.id === id; })) return;
    selectedZoneId = id;
    saveChoices();
    renderCart();
    var z = activeZone();
    if (!silent && z) announce('منطقة التوصيل: ' + z.label + '. الإجمالي المرجعي الآن ' + money(totals().amount) + '.');
  }

  /** أزرار اختيار طريقة الدفع — تُبنى حرفيًا من CONFIG.payment.methods. */
  /**
   * وصف طريقة الدفع بحسب المنطقة المختارة فعليًا.
   * النص الثابت في config.js يذكر المنطقتين معًا؛ هذا السطر يقول للعميل
   * ما سيدفعه هو بالتحديد، فيقلّل المفاجأة عند التأكيد.
   */
  function methodDescription(method) {
    var z = activeZone();
    var zoneName = z ? z.label : 'حماة';

    if ((method.discountPercent || 0) > 0) {
      return isFreeDelivery(method, z)
        ? 'خصم ' + method.discountPercent + '% على قيمة المنتجات + توصيل مجاني داخل ' + zoneName + '.'
        : 'خصم ' + method.discountPercent + '% على قيمة المنتجات + توصيل ' +
          money(deliveryFeeFor(method, z)) + ' إلى ' + zoneName + '.';
    }
    return 'بلا خصم، وتُضاف رسوم التوصيل: ' + money(deliveryFeeFor(method, z)) +
      ' إلى ' + zoneName + '.';
  }

  function renderPaymentMethods() {
    if (!el.payment) return;
    el.payment.textContent = '';

    var legend = document.createElement('legend');
    legend.className = 'pay-legend';
    legend.textContent = (CONFIG.payment && CONFIG.payment.title) || 'طريقة الدفع';
    el.payment.appendChild(legend);

    availableMethods.forEach(function (method) {
      var label = document.createElement('label');
      label.className = 'pay-option';
      label.dataset.payOption = method.id;

      var input = document.createElement('input');
      input.type = 'radio';
      input.name = 'payment-method';
      input.value = method.id;
      input.checked = method.id === selectedMethodId;
      input.dataset.paySelect = method.id;

      var body = document.createElement('span');
      body.className = 'pay-body';

      var title = document.createElement('span');
      title.className = 'pay-title';
      title.textContent = method.label;

      var desc = document.createElement('span');
      desc.className = 'pay-desc';
      desc.textContent = methodDescription(method);

      body.appendChild(title);
      body.appendChild(desc);
      label.appendChild(input);
      label.appendChild(body);
      el.payment.appendChild(label);
    });

    var note = document.createElement('p');
    note.className = 'pay-note';
    note.textContent = (CONFIG.payment && CONFIG.payment.freeDeliveryNote) || '';
    el.payment.appendChild(note);
  }

  function setMethod(id, silent) {
    if (!availableMethods.some(function (m) { return m.id === id; })) return;
    selectedMethodId = id;
    saveChoices();
    renderCart();
    var method = activeMethod();
    if (!silent && method) announce('طريقة الدفع: ' + method.label + '. الإجمالي المرجعي الآن ' + money(totals().amount) + '.');
  }

  function buildCartItem(product, qty) {
    var li = document.createElement('li');
    li.className = 'cart-item';
    li.dataset.cartItem = product.id;

    var img = document.createElement('img');
    img.src = product.image.src;
    img.width = 64;
    img.height = 64;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = '';
    img.style.objectFit = 'cover';

    var main = document.createElement('div');
    main.className = 'cart-item-main';

    var head = document.createElement('div');
    head.className = 'cart-item-head';

    var name = document.createElement('p');
    name.className = 'cart-item-name';
    name.textContent = product.name;

    var size = document.createElement('p');
    size.className = 'cart-item-size';
    size.textContent = product.sizeLabel;

    head.appendChild(name);
    head.appendChild(size);

    var unit = document.createElement('p');
    unit.className = 'cart-item-unit';
    unit.textContent = 'سعر الوحدة: ' + money(product.price + scentFee()) + ' · مرجعي';

    var line = document.createElement('p');
    line.className = 'cart-item-line';
    line.textContent = 'مجموع البند: ' + money((toCents(product.price + scentFee()) * qty) / 100);

    var controls = document.createElement('div');
    controls.className = 'cart-item-controls';

    var qtyWrap = document.createElement('div');
    qtyWrap.className = 'qty';
    qtyWrap.setAttribute('role', 'group');
    qtyWrap.setAttribute('aria-label', 'الكمية للحجم ' + product.sizeLabel);

    var minus = document.createElement('button');
    minus.type = 'button';
    minus.dataset.qtyDecrease = product.id;
    minus.textContent = '−';
    minus.setAttribute('aria-label', 'تقليل الكمية للحجم ' + product.sizeLabel);
    if (qty <= MIN_QTY) minus.disabled = true;

    var value = document.createElement('span');
    value.dataset.qtyValue = '';
    value.textContent = String(qty);
    value.setAttribute('aria-live', 'polite');
    value.setAttribute('aria-label', 'الكمية الحالية ' + qty);

    var plus = document.createElement('button');
    plus.type = 'button';
    plus.dataset.qtyIncrease = product.id;
    plus.textContent = '+';
    plus.setAttribute('aria-label', 'زيادة الكمية للحجم ' + product.sizeLabel);
    if (qty >= MAX_QTY) plus.disabled = true;

    qtyWrap.appendChild(minus);
    qtyWrap.appendChild(value);
    qtyWrap.appendChild(plus);

    var remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'cart-remove';
    remove.dataset.removeItem = product.id;
    remove.textContent = 'إزالة';
    remove.setAttribute('aria-label', 'إزالة الحجم ' + product.sizeLabel + ' من السلة');

    controls.appendChild(qtyWrap);
    controls.appendChild(remove);

    main.appendChild(head);
    main.appendChild(unit);
    main.appendChild(line);
    main.appendChild(controls);

    li.appendChild(img);
    li.appendChild(main);
    return li;
  }

  function addToCart(id, button) {
    var product = getProduct(id);
    if (!product) return;

    var current = cart[id] || 0;
    if (current >= MAX_QTY) {
      announce('الحد الأقصى ' + MAX_QTY + ' وحدات للحجم الواحد. يمكنك تعديل الكمية من السلة.');
      if (button) updateButtonFeedback(button, 'الحد الأقصى ' + MAX_QTY, true);
      return;
    }

    cart[id] = clampQty(current + 1);
    saveCart();
    renderCart();

    // القياس اختياري ولا يجب أن يمنع الإضافة إن غاب أو فشل.
    // نبلّغ عن معرّف الحجم الفعلي فقط بعد نجاح الإضافة بواسطة الزائرة.
    if (button && typeof window.rawaaTrack === 'function') {
      try { window.rawaaTrack('AddToCart', { content_ids: [product.id], content_type: 'product' }); }
      catch { /* السلة تبقى عاملة دون القياس */ }
    }

    if (button) {
      updateButtonFeedback(button, 'أُضيف إلى السلة ✓', false);
      button.classList.add('is-added');
      window.setTimeout(function () {
        button.classList.remove('is-added');
      }, 1600);
    }

    announce('تمت إضافة ' + product.sizeLabel + ' إلى السلة. المجموع المرجعي الآن ' + money(totals().amount) + '.');
  }

  function updateButtonFeedback(button, text, isError) {
    var holderId = button.getAttribute('aria-describedby');
    var feedback = holderId ? document.getElementById(holderId) : null;
    if (feedback) {
      feedback.textContent = text;
      feedback.style.color = isError ? 'var(--brown)' : '';
    }
    var original = button.dataset.originalLabel || button.textContent;
    button.dataset.originalLabel = original;
    button.textContent = text;
    window.clearTimeout(button._feedbackTimer);
    button._feedbackTimer = window.setTimeout(function () {
      button.textContent = button.dataset.originalLabel;
      if (feedback) feedback.textContent = '';
    }, 2200);
  }

  function changeQty(id, delta) {
    if (!cart[id]) return;
    var next = clampQty(cart[id] + delta);
    if (next === cart[id]) return;
    cart[id] = next;
    saveCart();
    renderCart();

    var product = getProduct(id);
    if (product) {
      announce('الكمية للحجم ' + product.sizeLabel + ' أصبحت ' + next + '.');
    }
  }

  function removeItem(id) {
    var product = getProduct(id);
    if (!cart[id]) return;
    delete cart[id];
    saveCart();
    renderCart();
    if (product) announce('تمت إزالة الحجم ' + product.sizeLabel + ' من السلة.');
    var trigger = el.items.querySelector('[data-remove-item="' + id + '"]');
    if (trigger) trigger.focus();
    else if (el.closeBtn) el.closeBtn.focus();
  }

  /* ------------------------------ رسالة واتساب ------------------------------ */

  function buildOrderMessage() {
    var p = pricing();
    var lines = [];

    lines.push(CONFIG.order.greeting);
    lines.push(CONFIG.order.intro);
    lines.push('');

    p.entries.forEach(function (entry) {
      lines.push('• ' + entry.product.sizeLabel + ' × ' + entry.qty +
        ' — ' + money(entry.product.price + scentFee()) + ' للواحدة = ' +
        money((toCents(entry.product.price + scentFee()) * entry.qty) / 100));
    });

    lines.push('');
    lines.push('قيمة المنتجات: ' + money(p.subtotalCents / 100));

    if (p.zone) {
      lines.push('منطقة التوصيل: ' + p.zone.label);
    }

    if (p.method) {
      if (p.discountCents > 0) {
        lines.push('خصم ' + p.method.short + ' (' + p.method.discountPercent + '%): − ' +
          money(p.discountCents / 100));
      } else {
        lines.push('خصم: لا يوجد (طريقة ' + p.method.short + ').');
      }

      if (p.freeDelivery) {
        lines.push('التوصيل: مجاني (' + p.zone.label + ' مع ' + p.method.short + ').');
      } else {
        lines.push('رسوم التوصيل: ' + money(p.deliveryCents / 100) + ' (' + p.zone.label + ' مع ' + p.method.short + ').');
      }

      lines.push('طريقة الدفع المطلوبة: ' + p.method.label + '.');
    }

    lines.push('المجموع المرجعي: ' + money(p.totalCents / 100));
    if (custom.scent || custom.oil) {
      var cfgC = CONFIG.customization || {};
      lines.push('');
      lines.push('التخصيص:');
      if (custom.scent) {
        var so = (cfgC.scentOptions || []).filter(function (o) { return o.id === custom.scent; })[0];
        if (so) lines.push('• العطر: ' + so.label + (scentFee() ? ' (إضافة ' + money(scentFee()) + ' لكل عبوة، مشمولة أعلاه)' : ''));
      }
      if (custom.oil) {
        var oo = (cfgC.oilAdditions || []).filter(function (o) { return o.id === custom.oil; })[0];
        if (oo) lines.push('• إضافة زيت: ' + oo.label + ' (السعر غير مشمول ويؤكد في واتساب)');
      }
    }

    lines.push('');
    lines.push('أرجو تأكيد ما يلي:');
    CONFIG.order.confirmationPoints.forEach(function (point, index) {
      lines.push((index + 1) + ') ' + point);
    });
    lines.push('');
    lines.push('(' + CONFIG.brand.latinName + ' · ' + CONFIG.brand.arabicName +
      ' — الأسعار المعروضة مرجعية بالدولار الأمريكي، وهذا الاستفسار لا يُعد طلبًا مؤكدًا حتى ردّكم.)');

    return lines.join('\n');
  }

  /**
   * قسم الصنعة — يُبنى من CONFIG.craft.
   * السبب: أقوى رسالة ثقة في الصفحة يجب أن يكون مصدرها ملفًا واحدًا قابلًا للتعديل،
   * لا HTML مكتوبًا يدويًا ينسى أحد تحديثه عند تغيّر المعلومة.
   */
  function renderCraft() {
    var cfg = CONFIG.craft;
    if (!cfg) return;
    var host = document.querySelector('[data-craft]');
    if (!host) return;

    var list = host.querySelector('[data-craft-points]');
    if (list) {
      list.textContent = '';
      (cfg.points || []).forEach(function (pt) {
        var li = document.createElement('li');
        li.className = 'craft-point';
        var h = document.createElement('h3');
        h.className = 'craft-point-title';
        h.textContent = pt.title;
        var b = document.createElement('p');
        b.className = 'craft-point-body';
        b.textContent = pt.body;
        li.appendChild(h);
        li.appendChild(b);
        list.appendChild(li);
      });
    }
    var sig = host.querySelector('[data-craft-signature]');
    if (sig && cfg.signature) sig.textContent = cfg.signature;
  }

  /** روتين الاستخدام — من CONFIG.routines */
  function renderRoutines() {
    var cfg = CONFIG.routines;
    if (!cfg) return;
    var host = document.querySelector('[data-routines]');
    if (!host) return;
    var list = host.querySelector('[data-routine-list]');
    if (list) {
      list.textContent = '';
      (cfg.items || []).forEach(function (item) {
        var li = document.createElement('li');
        li.className = 'routine';
        var when = document.createElement('span');
        when.className = 'routine-when';
        when.textContent = item.when;
        var t = document.createElement('p');
        t.className = 'routine-title';
        t.textContent = item.title;
        var b = document.createElement('p');
        b.className = 'routine-body';
        b.textContent = item.body;
        li.appendChild(when); li.appendChild(t); li.appendChild(b);
        list.appendChild(li);
      });
    }
    var note = host.querySelector('[data-routine-note]');
    if (note) note.textContent = cfg.note || '';
  }

  /** يبني قائمة اختيار العطر والزيت من CONFIG — لا خيارات مكتوبة يدويًا. */
  function renderCustomPickers() {
    var cfg = CONFIG.customization;
    if (!cfg) return;
    var scentHost = document.querySelector('[data-scent-options]');
    var oilHost = document.querySelector('[data-oil-options]');

    function build(host, options, field) {
      if (!host) return;
      host.textContent = '';
      options.forEach(function (opt) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'chip';
        btn.textContent = opt.label;
        btn.setAttribute('aria-pressed', 'false');
        btn.setAttribute('data-custom-' + field, opt.id);
        btn.addEventListener('click', function () {
          var same = custom[field] === opt.id;
          setCustom(field, same ? '' : opt.id);
        });
        host.appendChild(btn);
      });
    }

    build(scentHost, cfg.scentOptions || [], 'scent');
    build(oilHost, cfg.oilAdditions || [], 'oil');
    syncCustomChips();
    renderCustomSummary();
  }

  function checkout() {
    if (totals().count === 0) {
      announce('السلة فارغة. أضيفي حجمًا واحدًا على الأقل قبل متابعة الطلب.');
      return;
    }

    var url = waLink(buildOrderMessage());
    var opened = null;

    try {
      opened = window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      opened = null;
    }

    var blocked = !opened || opened.closed || typeof opened.closed === 'undefined';

    if (blocked) {
      showFallback(url);
      announce('إن لم تُفتح محادثة واتساب، استخدمي الرابط البديل الظاهر في السلة.');
    } else {
      hideFallback();
      announce('فُتحت محادثة واتساب في نافذة جديدة. الطلب لا يُعد مؤكدًا قبل ردّنا عليك.');
      try { opened.opener = null; } catch { /* تجاهل: لا شيء نفعله بالخطأ */ }
    }
  }

  function showFallback(url) {
    if (!el.fallback) return;
    el.fallback.hidden = false;
    if (el.fallbackLink) el.fallbackLink.setAttribute('href', url);
    if (el.fallbackLink) el.fallbackLink.focus();
  }

  function hideFallback() {
    if (el.fallback) el.fallback.hidden = true;
    if (el.copyManual) el.copyManual.hidden = true;
    if (el.copyStatus) el.copyStatus.textContent = '';
  }

  /** مشاركة السلة: Web Share API على الآيفون، وإلا نسخ الرابط. */
  function shareCart(button) {
    var url = button.getAttribute('data-share-url');
    if (!url) return;
    var text = 'أحجام وكميات من رواء — تحقّقي من المنطقة والدفع والخيارات عند فتح الرابط:';

    if (navigator.share) {
      navigator.share({ title: 'سلة رواء', text: text, url: url })
        .catch(function () { /* أُلغيت المشاركة — ليس خطأ */ });
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () {
        announce('تم نسخ رابط السلة.');
      }, function () {
        announce('انسخي الرابط يدويًا: ' + url);
      });
      return;
    }
    announce('انسخي الرابط يدويًا: ' + url);
  }

  function copyNumber(button) {
    var number = CONFIG.contact.displayNumber;
    var done = function (ok) {
      button.textContent = ok ? 'تم نسخ الرقم ✓' : 'انسخي الرقم يدويًا: ' + number;
      window.setTimeout(function () {
        button.textContent = 'نسخ رقم واتساب';
      }, 2600);
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(number).then(function () { done(true); }, function () { done(false); });
    } else {
      done(false);
    }
  }

  /** نسخ الاستفسار يتم عند طلب الزائرة فقط ولا يرسل رسالة. */
  function copyOrder() {
    if (cartIsEmpty() || !el.copyText || !el.copyStatus || !el.copyManual) return;
    var text = withSourceTag(buildOrderMessage());
    el.copyText.value = text;
    el.copyManual.hidden = true;
    el.copyStatus.textContent = '';

    function done(success) {
      if (cartIsEmpty() || !el.dialog || !el.dialog.open) return;
      if (text !== withSourceTag(buildOrderMessage())) {
        el.copyStatus.textContent = 'تغيّرت السلة؛ أعيدي نسخ التفاصيل الحالية.';
        return;
      }
      if (success) {
        el.copyStatus.textContent = 'نُسخت التفاصيل. الصقيها في واتساب لإرسال استفسارك.';
      } else {
        el.copyManual.hidden = false;
        el.copyStatus.textContent = 'تعذّر النسخ التلقائي؛ انسخي النص يدويًا.';
      }
      fitCartFooter();
      if (!success) {
        el.copyText.focus();
        el.copyText.select();
      }
    }

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
      } else { done(false); }
    } catch { done(false); }
  }

  /* ------------------------------ نافذة السلة ------------------------------ */

  /** ألغِ تثبيت التذييل إن حجب المحتوى، بما في ذلك عند تكبير حجم النص. */
  function fitCartFooter() {
    if (!el.dialog || !el.dialog.open || !el.cartScroller || !el.cartHead || !el.foot) return;
    var available = el.cartScroller.clientHeight;
    var needed = el.cartHead.offsetHeight + (el.foot.hidden ? 0 : el.foot.offsetHeight) + 96;
    el.cartScroller.classList.toggle('cart-inner--flow', available > 0 && needed > available);
  }

  function openCart(trigger) {
    if (!el.dialog) return;
    lastFocused = trigger || document.activeElement;
    hideFallback();

    if (typeof el.dialog.showModal === 'function') {
      if (!el.dialog.open) el.dialog.showModal();
    } else {
      el.dialog.setAttribute('open', '');
    }

    document.body.classList.add('is-locked');
    if (el.stickyBar) el.stickyBar.hidden = true;
    fitCartFooter();
    if (el.cartScroller) el.cartScroller.scrollTop = 0;
    if (el.closeBtn) el.closeBtn.focus();
  }

  function closeCart() {
    if (!el.dialog) return;
    if (typeof el.dialog.close === 'function' && el.dialog.open) {
      el.dialog.close();
    } else {
      el.dialog.removeAttribute('open');
      afterClose();
    }
  }

  function afterClose() {
    document.body.classList.remove('is-locked');
    renderCart();
    if (lastFocused && typeof lastFocused.focus === 'function' && document.contains(lastFocused)) {
      lastFocused.focus();
    } else if (el.cartTriggers && el.cartTriggers[0]) {
      el.cartTriggers[0].focus();
    }
  }

  /** العناصر القابلة للتركيز داخل السلة، بالترتيب. */
  function focusables() {
    if (!el.dialog) return [];
    var selector = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';
    return Array.prototype.filter.call(el.dialog.querySelectorAll(selector), function (node) {
      return node.offsetParent !== null || node === document.activeElement;
    });
  }

  /**
   * احتجاز التركيز داخل النافذة: بعض المتصفحات لا تحجز التركيز
   * بشكل موثوق في <dialog>، لذا نفرضه عند الحدّين.
   */
  function trapFocus(event) {
    if (!el.dialog || !el.dialog.open || event.key !== 'Tab') return;
    var items = focusables();
    if (items.length === 0) return;

    var first = items[0];
    var last = items[items.length - 1];
    var active = document.activeElement;
    var inside = el.dialog.contains(active);

    if (!inside) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
      return;
    }
    if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    }
  }

  /* ------------------------------ التنقل للهاتف ------------------------------ */

  function setNav(open) {
    if (!el.navPanel || !el.navToggle) return;
    el.navPanel.hidden = !open;
    el.navToggle.setAttribute('aria-expanded', String(open));
    el.navToggle.setAttribute('aria-label', open ? 'إغلاق قائمة التنقل' : 'فتح قائمة التنقل');
  }

  /* ------------------------------ التهيئة ------------------------------ */

  /**
   * روابط عرض قابلة للمشاركة: ?offer=shamcash أو ?offer=cod
   * تختار طريقة الدفع تلقائيًا، فيصل الزائر من منشور فيسبوك أو انستغرام
   * إلى نفس الحساب الذي رآه في المنشور. لا تُرسَل أي بيانات، ولا يُنفَّذ أي كود من الرابط.
   */
  function applyOfferFromUrl(restoredMethod) {
    var params;
    try {
      params = new URLSearchParams(window.location.search);
    } catch {
      return;
    }
    var wanted = params.get('offer');
    if (!wanted) return;
    var method = getMethod(wanted);
    if (!method || method.id !== wanted) return;
    // نطبّق رابط العرض عند الوصول إليه، لا كلما حدّثت الزائرة الصفحة بعد أن غيّرت رأيها.
    try {
      if (restoredMethod && window.history.state && window.history.state.rawaaAppliedOffer === wanted) return;
    } catch { /* سجل المتصفح غير متاح؛ يبقى العرض هو الافتراضي */ }
    selectedMethodId = method.id;
    saveChoices();
    try {
      var state = window.history.state;
      if (state === null || (typeof state === 'object' && !Array.isArray(state))) {
        var updated = Object.assign({}, state || {});
        updated.rawaaAppliedOffer = wanted;
        window.history.replaceState(updated, '');
      }
    } catch { /* الموقع يعمل حتى لو مُنع تعديل سجل الصفحة */ }
  }

  /** يبني رابط مشاركة لطريقة دفع معيّنة (يُستخدم في بطاقات الدفع نفسها). */
  function offerLink(methodId) {
    var base = window.location.href.split('?')[0].split('#')[0];
    return base + '?offer=' + encodeURIComponent(methodId) + '#payment';
  }

  /* ------------------------------ حفظ ومشاركة السلة ------------------------------ */

  /**
   * نحفظ السلة في sessionStorage فقط لتبقى عند التحديث أو انقطاع الشبكة.
   * تنتهي عادةً بإغلاق التبويب، وقد يستعيدها المتصفح عند استعادة الجلسة.
   * لا تُرسَل بيانات التخزين تلقائيًا، ولا تُستخدم كوكيز للسلة.
   */
  var STORAGE_KEY = 'rawaa:cart:v1';
  var CHOICES_KEY = 'rawaa:choices:v1';

  /** رموز اختيارات فقط، في جلسة التبويب؛ لا أسماء أو عناوين أو أرقام تواصل. */
  function saveChoices() {
    try {
      window.sessionStorage.setItem(CHOICES_KEY, JSON.stringify({
        size: selectedSize, zone: selectedZoneId, method: selectedMethodId,
        scent: custom.scent, oil: custom.oil
      }));
    } catch { /* التخزين قد يُمنع؛ تبقى الاختيارات في الذاكرة للصفحة الحالية */ }
  }

  /** لا نستعيد إلا معرّفات موجودة في الإعدادات الحالية. */
  function restoreChoices() {
    try {
      var raw = window.sessionStorage.getItem(CHOICES_KEY);
      if (!raw) return false;
      var data = JSON.parse(raw);
      if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
      var fallbackProduct = CONFIG.products[1] || CONFIG.products[0];
      selectedSize = typeof data.size === 'string' && getProduct(data.size)
        ? data.size : (fallbackProduct && fallbackProduct.id) || null;
      var defaultZone = (CONFIG.delivery && CONFIG.delivery.defaultZone) || (zones[0] && zones[0].id) || null;
      selectedZoneId = zones.some(function (z) { return z.id === data.zone; }) ? data.zone : defaultZone;
      var validMethod = availableMethods.some(function (m) { return m.id === data.method; });
      selectedMethodId = validMethod ? data.method : (availableMethods[0] && availableMethods[0].id) || null;
      var cfg = CONFIG.customization || {};
      custom.scent = (cfg.scentOptions || []).some(function (o) { return o.id === data.scent; }) ? data.scent : '';
      custom.oil = (cfg.oilAdditions || []).some(function (o) { return o.id === data.oil; }) ? data.oil : '';
      return validMethod;
    } catch { return false; }
  }

  function saveCart() {
    try {
      var plain = {};
      Object.keys(cart).forEach(function (k) { plain[k] = cart[k]; });
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(plain));
      return true;
    } catch { return false; /* التخزين محجوب؛ تبقى السلة في ذاكرة الصفحة */ }
  }

  function restoreCart(replace) {
    try {
      var raw = window.sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      var data = JSON.parse(raw);
      if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
      if (replace) Object.keys(cart).forEach(function (id) { delete cart[id]; });
      Object.keys(data).forEach(function (id) {
        var qty = parseInt(data[id], 10);
        if (getProduct(id) && qty > 0) cart[id] = clampQty(qty);
      });
      return true;
    } catch { return false; }
  }

  /**
   * رابط سلة قابل للمشاركة: ?cart=serum-30x1,serum-50x2
   * يفيد الزبونة التي تريد إرسال طلبها لصديقة، أو نشره في مجموعة.
   * يُقرأ بأمان: أي معرّف غير معروف يُتجاهل.
   */
  function loadCartFromUrl(restoredCart) {
    var params;
    try { params = new URLSearchParams(window.location.search); } catch { return; }
    var raw = params.get('cart');
    if (!raw) return;
    var shared = Object.create(null);
    raw.split(',').forEach(function (chunk) {
      var parts = chunk.split('x');
      if (parts.length !== 2) return;
      var id = parts[0].trim();
      var qty = parseInt(parts[1], 10);
      if (getProduct(id) && qty > 0) shared[id] = clampQty(qty);
    });
    var ids = Object.keys(shared);
    if (!ids.length) return;
    if (el.cartSharedNotice) el.cartSharedNotice.hidden = false;
    try {
      if (restoredCart && window.history.state && window.history.state.rawaaAppliedCart === raw) return;
    } catch { /* يبقى رابط السلة قابلًا للاستخدام دون تعديل السجل */ }
    // لا نستبدل كمية موجودة مسبقًا؛ نضيف الأحجام الجديدة فقط ونوضح ذلك للزائرة.
    ids.forEach(function (id) { if (!cart[id]) cart[id] = shared[id]; });
    // لا نعلّم الرابط كمطبّق إن منع المتصفح الحفظ، كي يظل صالحًا عند التحديث.
    if (!saveCart()) return;
    try {
      var state = window.history.state;
      if (state === null || (typeof state === 'object' && !Array.isArray(state))) {
        var updated = Object.assign({}, state || {});
        updated.rawaaAppliedCart = raw;
        window.history.replaceState(updated, '');
      }
    } catch { /* قد يمنع المتصفح تعديل السجل */ }
  }

  /** يبني رابط مشاركة للسلة الحالية. */
  function cartShareLink() {
    var entries = cartEntries();
    if (!entries.length) return '';
    var payload = entries.map(function (e) { return e.product.id + 'x' + e.qty; }).join(',');
    var base = window.location.href.split('?')[0].split('#')[0];
    return base + '?cart=' + encodeURIComponent(payload) + '#products';
  }

  function init() {
    el.toastRegion = document.querySelector('[data-toast-region]');
    el.count = document.querySelector('[data-cart-count]');
    el.dialog = document.getElementById('cart-dialog');
    el.items = document.querySelector('[data-cart-items]');
    el.cartCustomSummary = document.querySelector('[data-cart-custom-summary]');
    el.cartSharedNotice = document.querySelector('[data-cart-shared-notice]');
    el.cartScroller = el.dialog && el.dialog.querySelector('.cart-inner');
    el.cartHead = el.dialog && el.dialog.querySelector('.cart-head');
    el.empty = document.querySelector('[data-cart-empty]');
    el.foot = document.querySelector('[data-cart-foot]');
    el.orderOptions = document.querySelector('[data-cart-order-options]');
    el.cartContext = document.querySelector('[data-cart-context]');
    el.total = document.querySelector('[data-cart-total]');
    el.checkout = document.querySelector('[data-cart-checkout]');
    el.closeBtn = document.querySelector('[data-cart-close]');
    el.fallback = document.querySelector('[data-cart-fallback]');
    el.fallbackLink = document.querySelector('[data-cart-fallback-link]');
    el.copyBtn = document.querySelector('[data-cart-copy-number]');
    el.copyText = document.querySelector('[data-cart-copy-text]');
    el.copyStatus = document.querySelector('[data-cart-copy-status]');
    el.copyManual = document.querySelector('[data-cart-copy-manual]');
    el.payment = document.querySelector('[data-payment-methods]');
    el.subtotal = document.querySelector('[data-cart-subtotal]');
    el.subtotalRow = document.querySelector('[data-row-subtotal]');
    el.discountRow = document.querySelector('[data-row-discount]');
    el.discountValue = document.querySelector('[data-cart-discount]');
    el.discountLabel = document.querySelector('[data-discount-label]');
    el.deliveryRow = document.querySelector('[data-row-delivery]');
    el.deliveryValue = document.querySelector('[data-cart-delivery]');
    el.totalNote = document.querySelector('[data-cart-total-note]');
    el.shareBtn = document.querySelector('[data-cart-share]');
    el.zones = document.querySelector('[data-delivery-zones]');
    el.zoneLabel = document.querySelector('[data-zone-label]');
    el.marginNote = document.querySelector('[data-margin-note]');
    el.stickyBar = document.querySelector('[data-sticky-bar]');
    el.stickyCount = document.querySelector('[data-sticky-count]');
    el.stickyTotal = document.querySelector('[data-sticky-total]');
    el.cartTriggers = Array.prototype.slice.call(document.querySelectorAll('[data-cart-open]'));
    if (window.ResizeObserver && el.cartScroller && el.cartHead && el.foot) {
      var cartLayoutObserver = new window.ResizeObserver(fitCartFooter);
      cartLayoutObserver.observe(el.cartScroller);
      cartLayoutObserver.observe(el.cartHead);
      cartLayoutObserver.observe(el.foot);
    }
    window.addEventListener('resize', fitCartFooter, { passive: true });
    el.navToggle = document.querySelector('[data-nav-toggle]');
    el.navPanel = document.getElementById('mobile-nav');

    /**
     * الحرس القديم كان: إن غابت شبكة المنتجات القديمة، اخرج من init بالكامل.
     * بعد إعادة تصميم قسم المنتج (بطاقة واحدة بدل ثلاث) اختفت الشبكة، فصار
     * init يخرج قبل تشغيل نصف الواجهة — بلا أي رسالة خطأ.
     * الحرس الجديد: نخرج فقط إن غاب **الإعداد**، وهو الشرط الوحيد الحقيقي.
     */
    if (!CONFIG) return;

    var restoredMethod = restoreChoices();
    applyOfferFromUrl(restoredMethod);
    var restoredCart = restoreCart();
    loadCartFromUrl(restoredCart);
    renderSizePicker();
    renderRoutines();
    renderCustomPickers();
    renderCraft();
    renderPaymentCards();
    renderTrust();
    renderCalculator();
    initOrderEstimate();
    initProductShortcuts();

    // شريط الشراء المبكّر يتبع التمرير
    if (!window.__rawaaShopBarScroll) {
      window.__rawaaShopBarScroll = true;
      window.addEventListener('scroll', function () {
        updateShopBar(cartIsEmpty());
      }, { passive: true });
    }
    renderCart();

    // سجل السنة الحالية
    Array.prototype.forEach.call(document.querySelectorAll('[data-current-year]'), function (node) {
      node.textContent = String(new Date().getFullYear());
    });

    // أحداث موزّعة (Delegation) على الصفحة
    document.addEventListener('click', function (event) {
      var target = event.target.closest('button, a');
      if (!target) return;

      if (target.hasAttribute('data-add-to-cart')) {
        event.preventDefault();
        var productId = target.getAttribute('data-add-to-cart');
        addToCart(productId, target);
        if (target.hasAttribute('data-open-cart-after-add') && cart[productId]) openCart(target);
        return;
      }
      if (target.hasAttribute('data-cart-open')) {
        event.preventDefault();
        openCart(target);
        return;
      }
      if (target.hasAttribute('data-cart-close')) {
        event.preventDefault();
        closeCart();
        return;
      }
      if (target.hasAttribute('data-cart-checkout')) {
        event.preventDefault();
        checkout();
        return;
      }
      if (target.hasAttribute('data-cart-share')) {
        event.preventDefault();
        shareCart(target);
        return;
      }
      if (target.hasAttribute('data-cart-copy-number')) {
        event.preventDefault();
        copyNumber(target);
        return;
      }
      if (target.hasAttribute('data-cart-copy-order')) {
        event.preventDefault();
        copyOrder();
        return;
      }
      if (target.hasAttribute('data-qty-increase')) {
        event.preventDefault();
        changeQty(target.getAttribute('data-qty-increase'), +1);
        return;
      }
      if (target.hasAttribute('data-qty-decrease')) {
        event.preventDefault();
        changeQty(target.getAttribute('data-qty-decrease'), -1);
        return;
      }
      if (target.hasAttribute('data-remove-item')) {
        event.preventDefault();
        removeItem(target.getAttribute('data-remove-item'));
        return;
      }
      if (target.hasAttribute('data-nav-toggle')) {
        event.preventDefault();
        setNav(el.navPanel.hidden);
        return;
      }
      if (el.navPanel && !el.navPanel.hidden && target.closest('#mobile-nav')) {
        setNav(false);
      }
    });

    // طريقة الدفع: تغيير عبر حدث change على مستوى المستند
    document.addEventListener('change', function (event) {
      var zoneInput = event.target.closest && event.target.closest('[data-zone-select]');
      if (zoneInput) { setZone(zoneInput.getAttribute('data-zone-select')); return; }

      var input = event.target.closest && event.target.closest('[data-pay-select]');
      if (!input) return;
      setMethod(input.getAttribute('data-pay-select'));
    });

    // روابط التنقل تغلق القائمة على الهاتف
    if (el.navPanel) {
      el.navPanel.addEventListener('click', function (event) {
        if (event.target.closest('a')) setNav(false);
      });
    }

    // لوحة المفاتيح: احتجاز التركيز داخل السلة + Escape لقائمة الهاتف
    document.addEventListener('keydown', function (event) {
      trapFocus(event);
      if (event.key === 'Escape' && el.navPanel && !el.navPanel.hidden) {
        setNav(false);
        if (el.navToggle) el.navToggle.focus();
      }
    });

    // إعادة التركيز بعد الإغلاق بأي وسيلة (ESC أو النقر على الخلفية)
    if (el.dialog) {
      el.dialog.addEventListener('close', afterClose);
      el.dialog.addEventListener('click', function (event) {
        // نقر على الخلفية خارج الصندوق
        if (event.target === el.dialog) closeCart();
      });
    }

    // إغلاق قائمة الهاتف عند تكبير الشاشة
    var mq = window.matchMedia('(min-width: 900px)');
    var onMq = function (event) { if (event.matches) setNav(false); };
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onMq);

    // ظهور هادئ (مع احترام تقليل الحركة)
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var revealTargets = Array.prototype.slice.call(
      document.querySelectorAll('.section-head, .product-card, .story-figure, .story-copy, .steps li, .order-cta-inner')
    );

    if (!reduce && 'IntersectionObserver' in window && revealTargets.length) {
      var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      }, { rootMargin: '0px 0px 240px 0px', threshold: 0 });

      revealTargets.forEach(function (node) {
        /**
         * تبقى النصوص واضحة حتى أثناء الحركة: CSS تحرّك الموضع فقط ولا تخفض
         * الشفافية، كي لا يضعف التباين أو يُحجب المحتوى. ونترك ما يظهر داخل
         * الشاشة دون إزاحة منذ البداية حتى لا يتأخر رسم المحتوى الأول.
         */
        var rect = node.getBoundingClientRect();
        if (rect.top < window.innerHeight && rect.bottom > 0) return;
        node.classList.add('reveal');
        observer.observe(node);
      });

      // شبكة أمان: لا يبقى أي محتوى مخفيًا إن فشل المراقب لأي سبب
      window.setTimeout(function () {
        revealTargets.forEach(function (node) { node.classList.add('is-visible'); });
      }, 2500);
    }
  }

  /**
   * ⚠ درس مُكلِّف (2026-10-28): كان init() يُستدعى عاريًا. أي عنصر مفقود
   * داخل init (مثل شبكة منتجات أُعيد تصميمها) كان يرمي استثناءً فيتوقّف
   * **كل** ما بعده: مبدّل الحجم، مخصّص العطر، قسم الصنعة، حاسبة التوصيل —
   * بلا أي رسالة في الكونسول لأن الخطأ داخل مستمع DOMContentLoaded.
   * الآن: init محمي، والخطأ يُبلَّغ عنه باسمه، وبقية الميزات لا تتوقف.
   */
  function boot() {
    try {
      init();
    } catch (err) {
      if (window.console && console.error) console.error('[RAWAA] تعذّر تهيئة الواجهة:', err);
      // إعادة المحاولة محصورة في الميزات المستقلة عن العنصر المفقود
      [renderSizePicker, renderRoutines, renderCustomPickers, renderCraft, renderPaymentCards,
       renderTrust, renderCalculator, initOrderEstimate].forEach(function (fn) {
        try { fn(); } catch { /* ميزة واحدة معطّلة لا تُسقط الباقي */ }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.addEventListener('pageshow', function (event) {
    if (!event.persisted || !CONFIG) return;
    restoreChoices();
    restoreCart(true);
    syncSizeUI();
    syncCustomChips();
    renderCustomSummary();
    if (el.items) renderCart();
  });

  // واجهة اختبارية داخلية (تُستخدم في scripts/check-site.mjs فقط، لا تُستخدم في الواجهة)
  window.__RAWAA_TEST__ = {
    buildOrderMessage: buildOrderMessage,
    money: money,
    addToCart: addToCart,
    changeQty: changeQty,
    removeItem: removeItem,
    totals: totals,
    pricing: pricing,
    setMethod: setMethod,
    offerLink: offerLink,
    cartShareLink: cartShareLink,
    loadCartFromUrl: loadCartFromUrl,
    saveCart: saveCart,
    restoreCart: restoreCart,
    applyOfferFromUrl: applyOfferFromUrl,
    getMethod: function (id) { return getMethod(id); },
    methods: availableMethods,
    zones: zones,
    setZone: setZone,
    selectedZone: function () { return selectedZoneId; },
    deliveryFeeFor: deliveryFeeFor,
    selectedMethod: function () { return selectedMethodId; },
    cart: cart,
    MAX_QTY: MAX_QTY
  };
})();

/* ── زر واتساب العائم: يظهر بعد تجاوز قسم الأحجام ──────────────────
   الغرض التجاري: من يصل من إعلان فيسبوك يجب أن يجد طريق الطلب أينما كان.
   يختفي في أعلى الصفحة حتى لا يزاحم زر «اختاري حجمك». */
(function floatingWhatsApp() {
  'use strict';
  var btn = document.querySelector('[data-wa-float]');
  var anchor = document.querySelector('#products [data-add-to-cart]');
  if (!btn || !anchor || !('IntersectionObserver' in window)) return;

  var seen = false;
  new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      // نُظهر الزر بعد أن يمرّ الزائر بقسم الأحجام
      if (entry.boundingClientRect.top < 0) seen = true;
      btn.classList.toggle('is-visible', seen);
    });
  }, { threshold: 0 }).observe(anchor);

  // إن وصل الزائر بتمرير سريع، لا يبقى الزر مخفيًا
  window.addEventListener('scroll', function () {
    if (!seen && window.scrollY > 1400) { seen = true; btn.classList.add('is-visible'); }
  }, { passive: true });
})();
