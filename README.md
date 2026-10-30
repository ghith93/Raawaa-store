# RAWAA | رواء — متجر سيروم شعر (نسخة المراجعة v2)

متجر ثابت (HTML/CSS/JS) بلا خادم وبلا قاعدة بيانات وبلا اشتراكات. الطلب يبدأ من السلة ويكتمل عبر واتساب.

> **هذه النسخة لم تُنشر ولم تُدمج.** أُعِدّت للمراجعة فقط — راجع `docs/REVIEW-AR.md`.

## التشغيل محليًا

```bash
python3 -m http.server 8080 --bind 0.0.0.0
# من iPhone على نفس الشبكة: http://<عنوان-الحاسوب>:8080/index.html
```

تفاصيل المراجعة من iPhone والنشر لاحقًا: `docs/run-and-deploy.md`

## بنية المشروع

```
index.html                      الصفحة الرئيسية (RTL) — Hero + تصميم العبوة + الأحجام + العلامة + الطلب + FAQ
privacy.html                    سياسة خصوصية أولية (مسودة)
robots.txt                      جاهز للنشر
assets/
  brand/                        ★ اللوجو (5 نسخ SVG + PNG) + العبوة المتجهة + لوحة الهوية
  fonts/                        خطوط مستضافة ذاتيًا (Amiri, Almarai, Cormorant) — SIL OFL
  img/plate/                    خلفيات خامات مولّدة (فارغة، بلا منتج)
  img/design/                   مشاهد SVG + ملصقات قابلة للتحرير (أمامي/خلفي لكل حجم)
  img/design-raw/               الأصول الأصلية عالية الدقة (المالك يحتفظ بها)
  img/products/                 نسخ محسّنة للويب: AVIF + WebP + JPEG بأحجام متعددة + manifest.json
css/styles.css                  نظام التصميم والاستجابة
js/config.js                    ★ المصدر المركزي: العلامة، الأسعار، رقم واتساب، الصور
js/cart.js                      السلة، الحسابات، رسالة واتساب، الوصولية
scripts/                        أدوات بناء الأصول والفحص (لا تُنشر)
  textpath.py                   تشكيل عربي (HarfBuzz) → مسارات SVG
  brand.py                      اللوجو + العبوة + لوحة الهوية
  compose.py / compose_photo.py تركيب الصور التحريرية
  optimize_images.py            AVIF/WebP/JPEG بأحجام متعددة
  check-site.mjs                الفحص الآلي (187 فحصًا)
  browser-test.py               اختبار متصفح فعلي (74 فحصًا)
docs/
  REVIEW-AR.md                  ★ تقرير التسليم والمراجعة (اقرأه أولًا)
  product-packaging-spec.md     ★ مواصفات تصنيع العبوة والملصق
  brand-content-guide.md        دليل العلامة والمحتوى + أفكار التسويق
  launch-and-growth-plan.md     خطة الإطلاق العضوي ومؤشرات الأداء
  licenses-and-assets.md        التراخيص والاعتماديات
  run-and-deploy.md             التشغيل، المراجعة من iPhone، النشر لاحقًا
.github/workflows/site-checks.yml  CI: فحص بناء JS + الفحص الآلي (بلا نشر)
```

## تعديل الأسعار أو رقم واتساب

في **`js/config.js`** فقط. الفحص الآلي يفشل إذا ظهر سعر مكتوب يدويًا في الواجهة.

## الفحوصات

```bash
# بوابات تعمل بلا شبكة وبلا متصفح (الأساس — تُشغَّل دائمًا)
npm run gates:offline
#   = ref-audit (مراجع/خطوط/JSON-LD/تسعير/إتاحة) + perf-static (ميزانية الوزن)
#     + check-site + eslint + html-validate لكل الصفحات

# بوابات تحتاج متصفح Chromium و/أو شبكة
npm run gates        # كل ما سبق + browser-test + serum-browser-test + axe + Lighthouse + asset-audit
npm run perf:static  # ميزانية الوزن وحدها
npm run refs         # تدقيق المراجع وحده
node scripts/purge-css.mjs --check   # يفشل إن تجاوز CSS الميت 8%
```

> ملاحظة: `perf-budget.mjs` و`asset-audit.mjs` يفحصان **الموقع الحيّ**، فلا يعملان بلا شبكة.
> البوابات التي تعمل دائمًا هي `gates:offline`، وهي ما يُشغَّل في CI بلا متصفح.

## تصريح عن الصور

كل صور العبوة **تصورات تصميمية** مركّبة من رسم متجهي واحد (نفس اللوجو والنسب في كل الصور)،
وليست صورًا لمنتج مُصنَّع، ولا تُعبّر عن تغليف أو ملصق أو شهادة مُنتَجة. تُستبدل بصور حقيقية قبل الإطلاق.

## ما لم يُنفَّذ

لم يُنشر الموقع، ولم يُدمج طلب المراجعة، ولم يُعدَّل أي مستودع بعيد — التفاصيل في `docs/REVIEW-AR.md`.
