/**
 * RAWAA | رواء — طبقة القياس التسويقي.
 *
 * المبدأ: نريد معرفة أي إعلان فيسبوك يجلب طلبات فعلية، وبأي تكلفة.
 * لكن الزائرة تكمل الطلب في واتساب — خارج موقعنا — فلا نرى الإتمام.
 * الحلّ: نخزّن رمز المصدر (utm) في الرابط، ونُعيد إرساله إلى فيسبوك لحظةَ
 * الضغط على واتساب. فيسبوك يقارن الرمز بالحملة ويعرف: هذا الإعلان أنتج محادثة.
 *
 * الخصوصية: لا كوكيز منّا، لا بيانات شخصية، لا تتبّع عبر المواقع.
 * البكسل نفسه يعمل بكوكيز من طرف فيسبوك — لذلك لا يُحمَّل قبل موافقة صريحة.
 */
(function () {
  'use strict';

  var STORE_KEY = 'rawaa_src';
  var CONSENT_KEY = 'rawaa_tracking_consent';
  var PIXEL_ID = (window.RAWAA_MARKETING && window.RAWAA_MARKETING.pixelId) || '';

  /* ── ١) التقاط مصدر الزيارة ─────────────────────────────────── */
  function readSource() {
    var q = new URLSearchParams(location.search);
    var src = {
      utm_source: q.get('utm_source'),
      utm_medium: q.get('utm_medium'),
      utm_campaign: q.get('utm_campaign'),
      utm_content: q.get('utm_content'),
      fbclid: q.get('fbclid')
    };
    var has = Object.keys(src).some(function (k) { return src[k]; });
    if (has) {
      try { sessionStorage.setItem(STORE_KEY, JSON.stringify(src)); } catch { /* تجاهل: لا شيء نفعله بالخطأ */ }
      return src;
    }
    try { return JSON.parse(sessionStorage.getItem(STORE_KEY) || 'null') || {}; }
    catch { return {}; }
  }

  var source = readSource();

  /* ── ٢) موافقة التتبّع — البكسل لا يُحمَّل بلا إذن ──────────── */
  function consent() {
    try { return localStorage.getItem(CONSENT_KEY); } catch { return null; }
  }

  window.rawaaConsent = function (granted) {
    try { localStorage.setItem(CONSENT_KEY, granted ? 'yes' : 'no'); } catch { /* تجاهل: لا شيء نفعله بالخطأ */ }
    if (granted) loadPixel();
    var bar = document.querySelector('[data-consent-bar]');
    if (bar) bar.hidden = true;
  };

  function loadPixel() {
    if (!PIXEL_ID || window.fbq) return;
    !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
    n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
    document,'script','https://connect.facebook.net/en_US/fbevents.js');
    window.fbq('init', PIXEL_ID);
    window.fbq('track', 'PageView');
  }

  if (consent() === 'yes') loadPixel();

  /* ── ٣) إرسال الأحداث إلى فيسبوك ────────────────────────────── */
  function track(event, params) {
    var data = Object.assign({}, params || {});
    if (source.utm_campaign) data.campaign = source.utm_campaign;
    if (source.utm_source) data.source = source.utm_source;
    if (window.fbq && consent() === 'yes') window.fbq('track', event, data);
    // سجل محلي يساعد في تشخيص المسار دون أي خدمة خارجية
    try {
      var log = JSON.parse(sessionStorage.getItem('rawaa_events') || '[]');
      log.push({ e: event, t: Date.now(), src: source.utm_campaign || null });
      sessionStorage.setItem('rawaa_events', JSON.stringify(log.slice(-40)));
    } catch { /* تجاهل: لا شيء نفعله بالخطأ */ }
  }
  window.rawaaTrack = track;

  /* ── ٤) الأحداث التي تهمّ متجرًا يعتمد واتساب ───────────────── */
  var ONCE = {};
  function once(name, event, params) {
    if (ONCE[name]) return;
    ONCE[name] = true;
    track(event, params);
  }

  /* مشاهدة المنتج: ظهور أول بطاقة سعر في الشاشة */
  if ('IntersectionObserver' in window) {
    var card = document.querySelector('[data-add-to-cart]');
    if (card) {
      new IntersectionObserver(function (entries, obs) {
        entries.forEach(function (en) {
          if (en.isIntersecting) { once('view', 'ViewContent', { content_type: 'product' }); obs.disconnect(); }
        });
      }, { threshold: 0.4 }).observe(card);
    }
  }

  /* الإضافة إلى السلة */
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-add-to-cart]');
    if (t) {
      track('AddToCart', {
        content_ids: [t.getAttribute('data-product-id') || 'serum'],
        content_type: 'product'
      });
    }
  }, true);

  /* بدء الطلب: فتح السلة أو الضغط على أي رابط واتساب */
  document.addEventListener('click', function (e) {
    if (!e.target.closest) return;
    if (e.target.closest('[data-cart-open],[data-wa-direct],a[href*="wa.me"]')) {
      once('checkout', 'InitiateCheckout', { content_type: 'product' });
      track('Contact', { method: 'whatsapp' });
    }
  }, true);

  /* ── ٥) إعادة رمز المصدر إلى رسالة واتساب ──────────────────── */
  /* الرسالة تصل للمالك وعليها اسم الحملة — يعرف من أين جاءت الزبونة دون أي أداة */
  window.rawaaSrcTag = function () {
    return source.utm_campaign || source.utm_source || '';
  };

  /* ── ٦) شريط الموافقة — يظهر مرة واحدة فقط ────────────────── */
  if (consent() === null && PIXEL_ID) {
    document.addEventListener('DOMContentLoaded', function () {
      var bar = document.querySelector('[data-consent-bar]');
      if (bar) bar.hidden = false;
    });
  }
})();
