# OPEN-SOURCE-AUDIT.md — الأدوات المدمجة وتراخيصها

> كل أداة دخلت المشروع مسجّلة هنا: المصدر، الترخيص، ما تفعله، وكيف تُزال.
> القاعدة: لا أداة بلا ترخيص موثّق، ولا أداة تُشغّل في الإنتاج بلا حاجة.

## مدمج ويعمل الآن

| الأداة | المصدر | ⭐ | الترخيص | تجاري؟ | الوظيفة | كيف تُزال |
|--------|--------|----|---------|--------|---------|-----------|
| **ESLint** | eslint/eslint | — | MIT | ✅ | كشف أخطاء JS — **0 خطأ** | `npm uninstall eslint` + حذف `eslint.config.mjs` |
| **html-validate** | html-validate/html-validate | — | MIT | ✅ | صحة HTML ومعالم a11y — **0 خطأ** (كان 5) | `npm uninstall html-validate` + `.htmlvalidate.json` |
| **Repomix** | yamadashy/repomix | 29k | MIT | ✅ | يحزم المشروع في ملف 163KB يفهمه أي وكيل — يوفّر آلاف التوكنات | `npm uninstall repomix` |
| **axe-core** | dequelabs/axe-core | 26k | MPL-2.0 | ✅ | تدقيق a11y — **0 مخالفة** | حذف `scripts/axe-audit.py` + `scripts/vendor/axe.min.js` |
| **Lighthouse** | GoogleChrome/lighthouse | 30k | Apache-2.0 | ✅ | ميزانية الأداء | `npm uninstall lighthouse` |
| **Playwright** | microsoft/playwright | 78k | Apache-2.0 | ✅ | 127 اختبار + 237 فحص محتوى | `pip uninstall playwright` |
| **fontTools** | fonttools/fonttools | — | MIT | ✅ | تقليص الخطوط 402→84KB | `pip uninstall fonttools` |
| **Pillow** | python-pillow/Pillow | — | MIT-CMU | ✅ | مشتقات الصور AVIF/WebP | `pip uninstall pillow` |
| **IBM Plex Sans Arabic** | IBM/plex | — | SIL OFL 1.1 | ✅ | الخط | استبدال `@font-face` |
| **Cormorant Garamond** | google/fonts | — | SIL OFL 1.1 | ✅ | اللاتينية الفاخرة | — |
| **Wrangler** | cloudflare/workers-sdk | 25k | Apache-2.0 | ✅ | النشر | `npm uninstall wrangler` |

## مدروسة ولم تُدمج (بسبب)

| الأداة | ⭐ | الترخيص | سبب الرفض |
|--------|----|---------|-----------|
| `microsoft/playwright-mcp` | 38.7k | Apache-2.0 | يحتاج عميل MCP — لا ينطبق على بيئة تنفيذ مباشرة |
| `continuedev/continue` | 36.4k | Apache-2.0 | إضافة IDE — لا معنى لها بلا محرر تفاعلي |
| `chroma-core/chroma` | 29.6k | Apache-2.0 | قاعدة متجهات — لا RAG في مشروع من 3 صفحات |
| `knip` | 12k | ISC | جُرِّب: لا يكشف شيئًا لم يكشفه فحصي المخصص للملفات الميتة |
| `purgecss` | 7k | MIT | جُرِّب: CSS ميت 1% فقط — لا مكسب يستحق اعتمادية |
| `linkinator` | — | MIT | روابط الموقع داخلية ومفحوصة أصلًا |
| نظام متعدد الوكلاء | — | — | تعقيد هندسي لمشكلة من 3 صفحات |

## مجالات جُرِّبت فيها أدوات خارجية + النتيجة

| المحاولة | النتيجة |
|----------|---------|
| `Google/Promptfoo` لأفكار تقييم | ❌ يحتاج مفاتيح نماذج مدفوعة |
| `remotion` للفيديو | ❌ React + Chrome headless — ثقيل جدًا لهذا الحجم |
| `unlighthouse` لفحص كل المسارات | 🟡 مفيد لو زاد عدد الصفحات عن 10 |

## ما وفّرته هذه الأدوات (قياس فعلي)

| الأداة | العيب الذي كشفته | لو لم تُستخدم |
|--------|-------------------|---------------|
| html-validate | **5 معالم متكررة بلا اسم** — تضر قارئ الشاشة | عيب a11y خفي |
| ESLint | 0 أخطاء (تحقق سلبي مؤكَّد) | ثقة بلا دليل |
| فحص الملفات الميتة | **1.18 MB** ملفات غير مستخدمة | حِمل زائد في المستودع |
| CI الجديد | كشف أن الفحص نفسه كان معطوبًا (لا يقرأ CSS) | فحص زائف يمرّ دائمًا |
| Repomix | 163 KB تمثّل المشروع كاملًا | آلاف التوكنات لكل جلسة جديدة |
