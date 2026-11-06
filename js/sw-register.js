/**
 * RAWAA | رواء — تسجيل عامل الخدمة في الصفحات الداخلية.
 *
 * نُقل من كتلة مضمّنة في `serum.html` في ٦ نوفمبر ٢٠٢٦ لإزالة
 * `'unsafe-inline'` من CSP. إن لم يكن مدعومًا أو كان الملف مفتوحًا
 * من القرص لا يحدث شيء ولا تتأثر أي وظيفة.
 */
(function () {
  'use strict';
  if (!('serviceWorker' in navigator) || !location.protocol.startsWith('http')) return;
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function () { /* اختياري تمامًا */ });
  });
})();
