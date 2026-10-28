# إعادة توليد الصور والهوية

النسخ عالية الدقة **لا تُحفظ في المستودع** (20 MB بلا فائدة) — لكنها قابلة لإعادة
التوليد بأمرين، والنتيجة مطابقة لأن التوليد حتمي (لا عشوائية في الهندسة).

## الأمران

```bash
python3 scripts/make_product_imagery.py   # يرسم 8 مشاهد في assets/img/design-raw
python3 scripts/optimize_images.py        # ينتج AVIF/WebP/JPEG في assets/img/products
```

## الهوية

```bash
python3 scripts/make_identity.py   # 5 ملفات SVG في assets/brand
python3 scripts/make_icons.py      # 5 أيقونات PNG في assets/icons
```

## ما يحتاجه التوليد

| المتطلب | الاستخدام | إن غاب |
|---------|-----------|--------|
| Pillow | الرسم والمعالجة | يفشل فورًا |
| Playwright + Chromium | كتابة الملصق العربي بدقة + رسم SVG للأيقونات | **الملصق يخرج فارغًا بصمت** |
| `assets/fonts/amiri-400.subset.woff2` | «رواء» على الملصق | نص عربي مفقود |
| `assets/fonts/cormorant-500-latin.subset.woff2` | `RAWAA` و`SERUM` و`50 ML` | نص لاتيني مفقود |

## مرجع بصري

`assets/img/design-raw-reference.png` — نسخة مصغّرة (700×525) من المشهد الثلاثي
لمقارنة أي إعادة توليد بالنتيجة المعتمدة، دون حفظ الملف الأصلي الكبير.

## تحذير موثّق

`label_text_image()` تُرجع `None` بصمت إذا فشل استيراد Playwright أو غاب الخط.
عندها تخرج العبوة **بملصق فارغ** ويُبلّغ السكربت عن نجاح. لذلك:
**افتح الصورة دائمًا بعد التوليد** — لا تكتفِ بكود الخروج.
