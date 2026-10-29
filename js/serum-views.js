/* مشاهد توضيحية، لا صورًا حقيقية ولا نتائج استخدام موثّقة. */
(function () {
  'use strict';
  var media = document.querySelector('[data-serum-media]');
  if (!media) return;
  var controls = document.querySelectorAll('[data-serum-controls]');
  var caption = media.querySelector('[data-serum-caption]');
  var panels = media.querySelectorAll('[data-serum-view]');
  var buttons = document.querySelectorAll('[data-serum-control]');
  if (!controls.length || !caption || !panels.length || !buttons.length) return;

  var descriptions = {
    bottle: 'تصوّر تصميمي للعبوة، وليس صورة المنتج الفعلي.',
    sizes: 'تصوّر فني للأحجام؛ لا يوضّح القياسات أو النسب الفعلية للعبوات.',
    ritual: 'مشهد تعبيري مولّد؛ لا يعرض المنتج أو نتيجة استخدامه.'
  };

  function showView(key) {
    if (!Object.prototype.hasOwnProperty.call(descriptions, key)) return;
    Array.prototype.forEach.call(panels, function (panel) {
      panel.hidden = panel.getAttribute('data-serum-view') !== key;
    });
    Array.prototype.forEach.call(buttons, function (button) {
      button.setAttribute('aria-pressed', String(button.getAttribute('data-serum-control') === key));
    });
    caption.textContent = descriptions[key];
  }

  Array.prototype.forEach.call(buttons, function (button) {
    button.addEventListener('click', function () {
      showView(button.getAttribute('data-serum-control'));
    });
  });

  // اختيار حجم آخر يعيد صورة ذلك الحجم؛ لا يخلط بين المشهد والمنتج المختار.
  document.addEventListener('change', function (event) {
    if (event.target && event.target.matches('input[name="rawaa-size"]')) showView('bottle');
  });
  Array.prototype.forEach.call(controls, function (control) { control.hidden = false; });
})();
