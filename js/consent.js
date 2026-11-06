/**
 * RAWAA | رواء — أزرار شريط إذن القياس.
 *
 * كان الشريط يستخدم `onclick="rawaaConsent(true|false)"` وهو ما يفرض
 * `'unsafe-inline'` في CSP. الآن نربط بـ`data-consent-grant`/`data-consent-deny`،
 * والدالة نفسها تُعلن في `js/marketing.js` (`window.rawaaConsent`) وتبقى كما هي.
 *
 * قواعد ثابتة: لا يُحمَّل شيء قبل الموافقة، وسحب الموافقة يوقف القياس فورًا.
 */
(function () {
  'use strict';

  function bind() {
    document.querySelectorAll('[data-consent-grant]').forEach(function (button) {
      button.addEventListener('click', function () {
        if (typeof window.rawaaConsent === 'function') window.rawaaConsent(true);
      });
    });
    document.querySelectorAll('[data-consent-deny]').forEach(function (button) {
      button.addEventListener('click', function () {
        if (typeof window.rawaaConsent === 'function') window.rawaaConsent(false);
      });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
