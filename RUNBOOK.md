# RUNBOOK — التشغيل والصيانة والاستعادة

## 1. أوامر الفحص (قبل أي نشر)

```bash
node scripts/check-site.mjs          # 227 فحصًا: HTML/JS/روابط/أسعار/ادعاءات/شعار/تسويق/PWA
python3 scripts/browser-test.py      # 109 اختبارًا: سلة، دفع، واتساب، آيفون، بلا إنترنت
python3 scripts/a11y-audit.py        # axe-core WCAG 2.1 AA على 8 حالات
```

## 2. النشر

النشر تلقائي: أي push إلى `main` يعيد نشر GitHub Pages خلال ~60 ثانية.

**إلزامي عند تغيير أي ملف يخدمه عامل الخدمة:**
```
افتح sw.js وارفع CACHE_VERSION من rawaa-v1 إلى rawaa-v2
```
بدون ذلك يبقى زائر سابق يرى النسخة القديمة.

## 3. التراجع عن نشر سيئ

```bash
# محليًا
git revert <sha> && git push
# أو من الآيفون: github.com/ghith93/Raawaa-store/commits/main -> Revert
```
GitHub Pages يعيد النشر تلقائيًا بعد التراجع.

## 4. استعادة كاملة

الأصول الأصلية والتصاميم داخل المستودع — الاستنساخ يعيد كل شيء:
```bash
git clone https://github.com/ghith93/Raawaa-store.git
cd Raawaa-store && python3 -m http.server 8080
```
لا قاعدة بيانات، لا أسرار، لا حالة خارجية → الاستعادة = استنساخ.

## 5. تغيير نطاق

1. `index.html`: `canonical`, `og:url`, `og:image`, `twitter:image`
2. `privacy.html`: `canonical`
3. `sitemap.xml` و`robots.txt`
4. `scripts/check-site.mjs`: المتغيّر `SITE_BASE`
5. أعد تشغيل الفحوصات الثلاثة.

## 6. تغيير الأسعار أو نسب الدفع

مكان واحد فقط: `js/config.js` → `products[]` و`payment.methods[]`.
البطاقات والملخص ورسالة واتساب تُبنى منه برمجيًا.
**ثم:** حدّث الأرقام في `docs/marketing-content-plan.md` وإلا فشل فحص الاتساق.

## 7. أعطال شائعة

| العَرَض | السبب المرجّح | الحل |
|---|---|---|
| الموقع 404 | Pages لم يُنشَر بعد | Actions → تأكد من نجاح النشر، انتظر 60 ثانية |
| زائر يرى نسخة قديمة | `CACHE_VERSION` لم يُرفع | ارفعه في `sw.js` |
| CI فشل في الإتاحة | axe-core تغيّر مساره | تحقق من `AXE_PATH` في سير العمل |
| صور لا تظهر | مسار خاطئ بعد نقل ملف | `node scripts/check-site.mjs` يحدد الملف |
| رسالة واتساب لا تُفتح | حاجب نوافذ منبثقة | يوجد رابط بديل داخل السلة |

---

## إضافة: ماذا تفعل عند فشل أو نقل

### إذا فشل فحص على `main`
1. ستجد Issue بعنوان **«⛔ فشل فحص على main»** أُنشئ تلقائيًا.
2. افتح رابط التشغيل بداخله واقرأ الخطوة الفاشلة.
3. أصلح السبب، أو ارجع للالتزام السابق:
   `git revert HEAD` ثم ارفع.
4. أغلق الـIssue بعد نجاح الفحوصات.

### نقل الاستضافة إلى Cloudflare Pages (D-015)
1. `python3 scripts/set-site-url.py https://<اسم-المشروع>.pages.dev/`
   — يستبدل canonical وog:url وsitemap وrobots وQR في 20 موضعًا.
2. ارفع: `python3 scripts/push-to-github.py "نقل العنوان"`
3. تحقق: `python3 scripts/browser-test.py --base https://<المشروع>.pages.dev/`
4. أوقف GitHub Pages: Settings → Pages → Source: **None** (لا تحذف).

### إذا اختفت مصادر الصور عالية الدقة
هذا سلوك مقصود — تُستبعد من المستودع لتوفير 20 MB. تُعاد بأمرين:
`python3 scripts/make_product_imagery.py && python3 scripts/optimize_images.py`
التفاصيل: `docs/REPRODUCE-IMAGERY.md`.

### إذا فشل الرفع بسبب الشبكة
`push-to-github.py` يعيد المحاولة تلقائيًا 3 مرات (1s → 2s → 4s) على الأخطاء
العابرة فقط. إذا تكرر 401 أو 403 فالمشكلة في التوكن لا في الشبكة.
