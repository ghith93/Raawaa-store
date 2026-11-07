/*
 * سكربت صفحة check.html — كان مضمّنًا في <script> داخلها.
 *
 * استُخرج ليصبح script-src 'self' كافيًا بدل 'unsafe-inline' (CSP). الكود نفسه
 * بلا تغيير. يُحمَّل بـdefer، أي أنه ينفَّذ بعد بناء DOM كالسكربت المضمّن في
 * نهاية الصفحة — لا فرق في التوقيت.
 */
(function () {
  'use strict';

  const BR = 'https://raawaa-store.pages.dev/';
  /* عيّنات حقيقية من الأصول المنشورة حاليًا (v6). لا تُضِف اسمًا قبل التحقق من وجوده:
     العيّنة المكسورة تُنتج «صور معطوبة» وهمية في تقرير الزبونة. تحقّق آليًا عبر
     `node scripts/ref-audit.mjs`، وهو يفشل إذا أشارت هذه الصفحة إلى ملف مفقود. */
  const SAMPLES = [
    'assets/img/products/trio-v6-1080.avif',
    'assets/img/products/trio-v6-720.avif',
    'assets/img/products/trio-v6-720.webp',
    'assets/img/products/size-30-v6-900.avif',
    'assets/img/products/size-50-v6-720.jpg',
    'assets/img/products/size-100-v6-720.webp'
  ];

  document.getElementById('ua').textContent = navigator.userAgent.slice(0, 60);

  /*
   * صفحة تشخيص: يجب أن تُكمل تقريرها حتى لو فشل مسبار واحد.
   *
   * `toDataURL` قد تعيد null (canvas معطّل، أو بيئة بلا رسم) — وكان ذلك يُسقط
   * السكربت كله فلا تظهر بقية الفحوصات، وهي بالضبط ما جاءت الزبونة لرؤيته.
   */
  function testType(mime) {
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 1;
      const url = c.toDataURL(mime);
      return typeof url === 'string' && url.indexOf('data:' + mime) === 0;
    } catch {
      return false;
    }
  }
  const avifOK = testType('image/avif');
  document.getElementById('avif').innerHTML = avifOK ? '<span class="ok">نعم</span>' : '<span class="bad">لا — سترى JPG</span>';
  document.getElementById('webp').innerHTML = testType('image/webp') ? '<span class="ok">نعم</span>' : '<span class="bad">لا</span>';

  // عامل الخدمة غير متاح في سياقات كثيرة (تصفح خاص، أو صفحة بلا HTTPS).
  if (navigator.serviceWorker) {
    navigator.serviceWorker.getRegistrations().then(rs => {
      document.getElementById('sw').innerHTML = rs.length ? '<span class="ok">نعم (' + rs.length + ')</span>' : '<span>لا</span>';
    }).catch(()=>{});
  } else {
    document.getElementById('sw').innerHTML = '<span class="bad">غير متاح في هذا السياق</span>';
  }

  let ok = 0, bad = 0;

  SAMPLES.forEach(src => {
    const fig = document.createElement('figure');
    const img = document.createElement('img');
    img.src = BR + src;
    img.alt = '';
    fig.appendChild(img);
    const cap = document.createElement('figcaption');
    cap.textContent = src.split('/').pop();
    fig.appendChild(cap);
    document.getElementById('grid').appendChild(fig);
  });

  Promise.all(SAMPLES.map(src => new Promise(res => {
    const img = new Image();
    const t0 = Date.now();
    img.onload = () => { ok++; res({src, status:'OK', w:img.naturalWidth, h:img.naturalHeight, ms:Date.now()-t0}); };
    img.onerror = () => { bad++; res({src, status:'FAILED'}); };
    img.src = BR + src + '?probe=' + Date.now();
  }))).then(rows => {
    document.getElementById('okc').innerHTML = '<span class="ok">' + ok + '</span>';
    document.getElementById('badc').innerHTML = bad ? '<span class="bad">' + bad + '</span>' : '<span class="ok">0</span>';

    // فحص مباشر بلا وسيط
    const fetches = [];
    ['assets/img/products/trio-v6-1080.avif','assets/img/products/trio-v6-1080.jpg'].forEach(u => {
      fetch(BR + u, {cache:'no-store'}).then(r => {
        fetches.push(u.split('/').pop() + ' → HTTP ' + r.status + ' · ' + (r.headers.get('content-type')||'?'));
      }).catch(e => fetches.push(u.split('/').pop() + ' → خطأ شبكة'));
    });

    setTimeout(() => {
      const rep = {
        time: new Date().toISOString(),
        ua: navigator.userAgent,
        avif: avifOK,
        results: rows,
        fetchChecks: fetches,
        swCaches: 'انظر أعلاه'
      };
      document.getElementById('out').textContent = JSON.stringify(rep, null, 1);
      window.__report = JSON.stringify(rep);
    }, 1500);
  });

  function copyReport() {
    const t = window.__report || document.getElementById('out').textContent;
    navigator.clipboard.writeText(t).then(
      () => alert('تم النسخ — ألصقه في المحادثة'),
      () => alert('لم أستطع النسخ. اضغط مطوّلًا على النص واختر «نسخ».')
    );
  }

  /* زر «انسخ التقرير» — مستمع بدل onclick="" (CSP: script-src 'self'). */
  (function () {
    var button = document.querySelector('[data-copy-report]');
    if (!button) return;
    button.addEventListener('click', function () { copyReport(); });
  })();
}());
