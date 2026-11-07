/*
 * سكربت صفحة setup.html — كان مضمّنًا في <script> داخلها.
 *
 * استُخرج ليصبح script-src 'self' كافيًا بدل 'unsafe-inline' (CSP). الكود نفسه
 * بلا تغيير. يُحمَّل بـdefer، أي أنه ينفَّذ بعد بناء DOM كالسكربت المضمّن في
 * نهاية الصفحة — لا فرق في التوقيت.
 */
(function () {
  'use strict';

  function copyText(text){if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(text).then(()=>alert("تم النسخ"),()=>alert("انسخ يدويًا: "+text))}else{window.prompt("انسخ النص التالي",text)}}
  document.getElementById("genBtn").onclick=()=>{const bytes=crypto.getRandomValues(new Uint8Array(48));let binary="";for(const byte of bytes)binary+=String.fromCharCode(byte);document.getElementById("secretOut").value=btoa(binary).replaceAll("+","-").replaceAll("/","_").replaceAll("=","");document.getElementById("secretWrap").hidden=false};
  document.getElementById("copySecret").onclick=()=>copyText(document.getElementById("secretOut").value);
  document.getElementById("genRateBtn").onclick=()=>{const bytes=crypto.getRandomValues(new Uint8Array(48));let binary="";for(const byte of bytes)binary+=String.fromCharCode(byte);document.getElementById("rateOut").value=btoa(binary).replaceAll("+","-").replaceAll("/","_").replaceAll("=","");document.getElementById("rateWrap").hidden=false};
  document.getElementById("copyRate").onclick=()=>copyText(document.getElementById("rateOut").value);

  /* رموز قابلة للنسخ — مستمع مفوَّض بدل onclick="" (CSP: script-src 'self'). */
  document.addEventListener('click', function (event) {
    var target = event.target.closest && event.target.closest('[data-copy-text]');
    if (!target) return;
    copyText(target.getAttribute('data-copy-text'));
  });
}());
