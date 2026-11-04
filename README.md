# RAWAA | رواء — متجر سيروم شعر

متجر عربي ثابت كتطبيق ويب تقدّمي (PWA)، مستضاف على Cloudflare Pages. يتيح اختيار الحجم ومراجعة سلة مرجعية ثم تجهيز استفسار يرسله العميل يدويًا عبر واتساب.

> **الحالة:** الموقع منشور على <https://raawaa-store.pages.dev/>؛ آخر تغيير سلوكي للموقع PR #99. دُمج PR #119 في [commit f1329f3](https://github.com/ghith93/Raawaa-store/commit/f1329f3463bc4caae2bd5a2f37a6e2a3a63c8aed) لتحسين تأكيد ميزانية Lighthouse وحذف workflow ذاتي تجريبي قديم؛ لم تتغير الأسعار أو مسارات الطلب. نجح Site checks في [run 41525811574](https://github.com/ghith93/Raawaa-store/actions/runs/41525811574)، وتخطّى Deploy gate [run 41526412325](https://github.com/ghith93/Raawaa-store/actions/runs/41526412325) كما هو متوقع. نجح أول uptime مجدول بعد الدمج على SHA نفسه في [run 41642426066](https://github.com/ghith93/Raawaa-store/actions/runs/41642426066)، بما فيه ميزانيات Lighthouse والاختبار الوظيفي للموقع المنشور. للحالة التشغيلية الحالية راجع [`PROJECT-ROADMAP-AR.md`](PROJECT-ROADMAP-AR.md).
> **الحالة التشغيلية والتوجه:** ابدأ من [`PROJECT-ROADMAP-AR.md`](PROJECT-ROADMAP-AR.md)، لا من ملخصات التاريخ القديمة.

## ما يفعله الموقع — وما لا يفعله

- يعرض الأحجام 30 و50 و100 مل والأسعار المعتمدة `$13 / $16 / $25` (٤ تشرين الثاني ٢٠٢٦)، ومصدر السعر الوحيد هو `js/config.js`. صفحة العرض المحلي `/hama` تستخدم نفس السلّم.
- يحسب السلة والتوصيل والخصم المرجعي ويجهز نص واتساب؛ على الزائر إرسال الرسالة بنفسه، والمالك يؤكد التوفر والتفاصيل.
- صفحات الموقع والسلة مدعومة بالعمل دون اتصال بعد زيارة، مع إرشادات تثبيت لـiOS وAndroid.
- لا توجد بوابة دفع أو قاعدة بيانات للطلبات أو مخزون حي أو تأكيد آلي. فتح واتساب لا يثبت استلام رسالة أو طلب.
- الصور الحالية تصورات تصميمية معلنة. لا ادعاءات طبية أو تقييمات أو نتائج مضمونة.

## تشغيل وفحص محلي

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run gates:offline
npm run build
```

`npm run gates:offline` يفحص المراجع، الميزانية الساكنة، الموقع، اختبارات Node، ESLint وHTML. الفحص الكامل `npm run gates` يتضمن اختبارات Chromium/WebKit وaxe وقياسات الأداء والأصول، ويتطلب أدوات المتصفح والشبكة المحددة في المشروع.

للتشغيل المحلي فقط:

```bash
python3 -m http.server 8080 --bind 0.0.0.0
```

## وثائق البدء

- [`PROJECT-ROADMAP-AR.md`](PROJECT-ROADMAP-AR.md) — الحقيقة الحالية، ما اكتمل، وما يعتمد على المالك أو السوق.
- [`docs/GROWTH-OPERATING-SYSTEM-AR.md`](docs/GROWTH-OPERATING-SYSTEM-AR.md) — توزيع المسؤوليات من العلامة والمحتوى إلى الإعلانات والتسعير والتصنيع.
- [`IMPROVEMENT_BACKLOG.md`](IMPROVEMENT_BACKLOG.md) — قائمة الأفكار والحالات.
- [`DECISIONS.md`](DECISIONS.md) — القرارات وحدودها.
- [`BENCHMARKS.md`](BENCHMARKS.md) — قياسات الأداء والفحوص.
- [`/campaign`](https://raawaa-store.pages.dev/campaign) — صفحة هبوط للزيارات من حملات المحتوى؛ زوايا UTM مسموحة وأسعارها من `js/config.js`، بلا Pixel أو نشر آلي.
- [`docs/ORGANIC-TEST-KIT-AR.md`](docs/ORGANIC-TEST-KIT-AR.md) — مسودات منشورات وروابط حملة عضوية؛ غير منشورة.
- [`docs/organic-test-tracker.csv`](docs/organic-test-tracker.csv) — قالب أعداد مجمعة، بلا بيانات شخصية.
- [`docs/HAMA-SALES-PLAN-AR.md`](docs/HAMA-SALES-PLAN-AR.md) — خطة البيع الثانية: حماة بسعر ١٢ دولارًا، شبكة بائعات ونقاط بيع وتشغيل بأقل تدخل. الصفحة المنفّذة: [`/hama`](hama.html).
- [`docs/HAMA-SALES-KIT-AR.md`](docs/HAMA-SALES-KIT-AR.md) — نصوص المنشورات والردود والسكريبتات واتفاق البائعة وإعلان التوظيف.
- [`docs/HAMA-VISUALS-AR.md`](docs/HAMA-VISUALS-AR.md) — حزمة الصور والفيديوهات التصوّرية لحماة: ما هو مولّد، وقواعد استخدامه، وبرومبتات إعادة التوليد.
- `PROMPT-WORLD-CLASS-AR.md`, `PROMPT-MARKETING-AR.md`, `LAUNCH-KIT-AR.md` — مواد تاريخية موسومة بأنها متقادمة؛ لا تنشر منها أسعارًا أو أرقامًا دون مراجعة.

## قواعد النشر والعمل

- تعديل الأسعار أو الرسوم أو الخصومات أو شروط البيع يحتاج قرارًا صريحًا من المالك.
- لا نرسل رسائل للعملاء أو الموردين ولا نؤكد طلبًا أو موعد شحن نيابةً عن المالك.
- لا إعلانات مدفوعة ولا خدمات مدفوعة ضمن هذا المسار.
- يجب زيادة `CACHE_VERSION` في `sw.js` عند تعديل أصول الموقع؛ سكربت البناء يحدّثه عند بناء الحزمة.
