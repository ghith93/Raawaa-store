/*
 * سكربت صفحة serum.html — كان مضمّنًا في <script> داخلها.
 *
 * استُخرج ليصبح script-src 'self' كافيًا بدل 'unsafe-inline' (CSP). الكود نفسه
 * بلا تغيير. يُحمَّل بـdefer، أي أنه ينفَّذ بعد بناء DOM كالسكربت المضمّن في
 * نهاية الصفحة — لا فرق في التوقيت.
 */
// تسجيل عامل الخدمة: يجعل الموقع يعمل بلا إنترنت ويُثبَّت على الشاشة الرئيسية.
// إن لم يكن مدعومًا (أو كان الملف مفتوحًا من القرص) لا يحدث شيء ولا تتأثر الوظائف.
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function () { /* اختياري تمامًا */ });
  });
}
