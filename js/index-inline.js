/*
 * سكربت صفحة index.html — كان مضمّنًا في <script> داخلها.
 *
 * استُخرج ليصبح script-src 'self' كافيًا بدل 'unsafe-inline' (CSP). الكود نفسه
 * بلا تغيير. يُحمَّل بـdefer، أي أنه ينفَّذ بعد بناء DOM كالسكربت المضمّن في
 * نهاية الصفحة — لا فرق في التوقيت.
 */
/*
 * قائمة الجوال + تسجيل عامل الخدمة.
 *
 * كُتب هذا الملف مقروءًا بعد استخراجه من سطر مضغوط واحد داخل index.html.
 * السلوك مطابق حرفيًا لما كان، والفرق أن قفل التمرير صار صنفًا (`is-locked`)
 * بدل `document.body.style.overflow` — النمط السطري يرفضه CSP (style-src 'self').
 */
(function () {
  'use strict';

  var toggle = document.getElementById('navToggle');
  var nav = document.getElementById('mobileNav');
  if (!toggle || !nav) return;

  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-label', 'فتح القائمة');
  toggle.type = 'button';

  toggle.onclick = function () {
    var open = nav.classList.toggle('open');
    nav.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'إغلاق القائمة' : 'فتح القائمة');
    document.body.classList.toggle('is-locked', open);
  };

  nav.querySelectorAll('a').forEach(function (link) {
    link.onclick = function () {
      nav.classList.remove('open');
      nav.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
      document.body.classList.remove('is-locked');
    };
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function () {});
    });
  }
}());
