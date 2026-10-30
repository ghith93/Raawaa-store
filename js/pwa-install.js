/**
 * RAWAA | رواء — دعوة التثبيت الاختيارية.
 * لا تظهر إلا حين يعرض المتصفح نافذة تثبيت فعلية؛ تبقى إرشادات iOS/Android
 * اليدوية متاحة دائمًا في الأسئلة الشائعة. لا تخزين ولا تتبّع.
 */
(function () {
  'use strict';

  var button = document.querySelector('[data-pwa-install]');
  if (!button) return;

  var standalone = false;
  try {
    standalone = Boolean(
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
      window.navigator.standalone === true
    );
  } catch { /* يبقى التثبيت اليدوي متاحًا */ }
  if (standalone) return;

  var deferredPrompt = null;
  var status = document.querySelector('[data-pwa-install-status]');

  window.addEventListener('beforeinstallprompt', function (event) {
    if (!event || typeof event.prompt !== 'function') return;
    event.preventDefault();
    deferredPrompt = event;
    button.hidden = false;
    if (status) status.textContent = '';
  });

  button.addEventListener('click', function () {
    if (!deferredPrompt) return;
    var promptEvent = deferredPrompt;
    deferredPrompt = null;
    button.hidden = true;
    button.disabled = true;

    var promptResult;
    try {
      // استدعاء prompt مباشرة داخل نقرة المستخدم يحافظ على شرط التفاعل الصريح للمتصفح.
      promptResult = promptEvent.prompt();
    } catch (error) {
      promptResult = Promise.reject(error);
    }

    Promise.resolve(promptResult)
      .then(function () { return promptEvent.userChoice; })
      .catch(function () {
        if (status) {
          status.textContent = 'تعذّر فتح نافذة التثبيت. اتبعي إرشادات إضافة رواء إلى الشاشة في الأسئلة الشائعة.';
        }
      })
      .finally(function () { button.disabled = false; });
  });

  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    button.hidden = true;
    if (status) status.textContent = 'أُضيف تطبيق رواء إلى جهازك.';
  });
})();
