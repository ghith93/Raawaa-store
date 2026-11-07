/*
 * سكربت صفحة privacy.html — كان مضمّنًا في <script> داخلها.
 *
 * استُخرج ليصبح script-src 'self' كافيًا بدل 'unsafe-inline' (CSP). الكود نفسه
 * بلا تغيير. يُحمَّل بـdefer، أي أنه ينفَّذ بعد بناء DOM كالسكربت المضمّن في
 * نهاية الصفحة — لا فرق في التوقيت.
 */
Array.prototype.forEach.call(document.querySelectorAll('[data-current-year]'), function (node) {
    node.textContent = String(new Date().getFullYear());
  });
