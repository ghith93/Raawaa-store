/**
 * RAWAA | رواء — سنة النشر في التذييل.
 *
 * نُقل من كتلة مضمّنة في `privacy.html` في ٦ نوفمبر ٢٠٢٦ لإزالة
 * `'unsafe-inline'` من CSP. يعمل وجوده مع غيابه على السواء:
 * HTML يحمل السنة الحالية نصًّا، وهذا الملف يحدّثها إن تغيّرت.
 */
(function () {
  'use strict';
  var nodes = document.querySelectorAll('[data-current-year]');
  for (var i = 0; i < nodes.length; i++) {
    nodes[i].textContent = String(new Date().getFullYear());
  }
})();
