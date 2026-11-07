/**
 * RAWAA | رواء — قائمة الهاتف وتسجيل عامل الخدمة.
 *
 * كان هذا السكربت مضمّنًا في `index.html`. نُقل إلى ملف خارجي في ٦ نوفمبر ٢٠٢٦
 * لإزالة `'unsafe-inline'` من سياسة CSP: السماح بالنصوص المضمّنة يُلغي أهم حماية
 * ضد XSS، وكان يُمنح من أجل سكربت واحد صغير.
 */
(function () {
  'use strict';

  function initNav() {
    var toggle = document.getElementById('navToggle');
    var nav = document.getElementById('mobileNav');
    if (!toggle || !nav) return;

    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'فتح القائمة');
    toggle.type = 'button';

    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      nav.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'إغلاق القائمة' : 'فتح القائمة');
      document.body.classList.toggle('is-locked', open);
    });

    nav.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        nav.classList.remove('open');
        nav.hidden = true;
        toggle.setAttribute('aria-expanded', 'false');
        document.body.classList.remove('is-locked');
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initNav);
  } else {
    initNav();
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function () { /* اختياري */ });
    });
  }
})();
