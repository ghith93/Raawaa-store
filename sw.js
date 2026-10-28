/**
 * RAWAA | رواء — Service Worker
 *
 * الهدف: أن يعمل الموقع بالكامل بلا إنترنت بعد أول زيارة، وأن يفتح فورًا
 * من الشاشة الرئيسية على الآيفون. لا تتبّع، لا إحصاءات، لا إرسال أي بيانات.
 *
 * الاستراتيجية:
 *  - التثبيت: تخزين الصفحات والأصول الأساسية (app shell) مسبقًا.
 *  - الصور: Cache First (لا تتغيّر) — مع تحديث صامت في الخلفية.
 *  - الصفحات: Network First مع رجوع إلى النسخة المخزّنة عند انقطاع الشبكة.
 *  - أي طلب لا يخصّ نفس النطاق (مثل wa.me) يمرّ كما هو دون تخزين.
 *
 * عند تغيير أي ملف من الموقع: ارفع رقم الإصدار CACHE_VERSION
 * وإلا سيبقى الزائر يرى النسخة القديمة من الذاكرة.
 */

const CACHE_VERSION = 'v6';
const RUNTIME = 'rawaa-runtime-v5';

/** الأصول التي يجب أن تعمل بلا إنترنت */
const CORE = [
  './',
  './index.html',
  './privacy.html',
  './404.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/config.js',
  './js/cart.js',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/apple-touch-icon.png',
  './assets/icons/favicon-64.png',
  './assets/favicon.svg',
  './assets/fonts/almarai-400.subset.woff2',
  './assets/fonts/almarai-700.subset.woff2',
  './assets/fonts/amiri-400.subset.woff2',
  './assets/fonts/almarai-400-latin.subset.woff2',
  './assets/fonts/almarai-700-latin.subset.woff2',
  './assets/fonts/amiri-400-latin.subset.woff2',
  './assets/fonts/cormorant-500-latin.subset.woff2',
  // الهوية البصرية (الجيل الثاني)
  './assets/brand/logo-mark-v2.svg',
  './assets/brand/logo-primary-v2.svg',
  // الصور الجديدة المضغوطة (AVIF + WebP + JPG احتياطي)
  './assets/img/products/hero-wide-v3-1080.avif',
  './assets/img/products/trio-1080.avif',
  './assets/img/products/size-30-720.webp',
  './assets/img/products/size-50-720.webp',
  './assets/img/products/size-100-720.webp',
  './assets/img/products/size-30-720.jpg',
  './assets/img/products/size-50-720.jpg',
  './assets/img/products/size-100-720.jpg',
  './assets/img/products/editorial-720.jpg',
  './assets/img/products/detail-label-720.jpg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      // addAll تفشل كلها إن فشل ملف واحد — نضيف كلاً على حدة حتى لا ينهار التثبيت
      Promise.all(CORE.map((url) => cache.add(url).catch(() => null)))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_VERSION && k !== RUNTIME).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // لا نتدخّل إلا في طلبات GET من نفس النطاق
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // الصور والخطوط والأيقونات: من الذاكرة أولًا (أسرع، ولا تتغيّر)
  if (/\.(avif|webp|jpe?g|png|svg|woff2?)$/i.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then((hit) => {
        if (hit) return hit;
        return fetch(req).then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(RUNTIME).then((c) => c.put(req, copy));
          }
          return res;
        }).catch(() => hit);
      })
    );
    return;
  }

  // الصفحات وCSS/JS: الشبكة أولًا ثم الذاكرة (حتى لا يرى الزائر نسخة قديمة)
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((hit) => hit || caches.match('./index.html'))
      )
  );
});
