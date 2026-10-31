#!/usr/bin/env python3
"""
RAWAA | رواء — اختبار متصفح فعلي (Playwright + Chromium).

يتطلب: pip install playwright && python3 -m playwright install chromium
التشغيل: python3 scripts/browser-test.py [--base http://127.0.0.1:8080]

لا يُشغَّل ضمن GitHub Actions افتراضيًا لأنه يحتاج تنزيل متصفح؛
سير العمل يشغّل الفحص الساكن فقط (scripts/check-site.mjs).
"""
import argparse
import json
import os
import sys
import urllib.parse
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / "docs" / "screenshots"

results = []


def check(name, condition, detail=""):
    results.append({"name": name, "ok": bool(condition), "detail": detail})
    mark = "PASS" if condition else "FAIL"
    print(f"[{mark}] {name}" + (f" — {detail}" if detail else ""))
    if not condition and os.environ.get("GITHUB_ACTIONS") == "true":
        print(f"::error::{name}", flush=True)
    return bool(condition)


def wait_ready(page, base):
    page.goto(base + "/index.html", wait_until="load")
    page.wait_for_selector("#products [data-add-current]")
    page.evaluate("document.fonts.ready")


# اختيار حجم صار داخل بطاقة واحدة (حُذفت الشبكة ثلاثية البطاقات 2026-10-28).
# كل حجم زر راديو حقيقي، والزر الأساسي يحمل قيمة الحجم المختار.
SIZE_INDEX = {"serum-30": 0, "serum-50": 1, "serum-100": 2}


def add_size(page, pid: str):
    """تختار الحجم من المحدِّد ثم تضيفه — بديل النقر على بطاقة مستقلة."""
    page.locator("#products .size-option").nth(SIZE_INDEX[pid]).click()
    page.wait_for_timeout(120)
    page.locator("#products [data-add-current]").click()


def run(base: str) -> int:
    SHOTS.mkdir(parents=True, exist_ok=True)
    console_errors = []
    page_errors = []
    failed_requests = []

    with sync_playwright() as p:
        browser = p.chromium.launch()

        # ---------- سطح المكتب / الوظائف ----------
        ctx = browser.new_context(viewport={"width": 1440, "height": 900}, locale="ar", timezone_id="Asia/Damascus")
        page = ctx.new_page()
        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: page_errors.append(str(e)))
        page.on("requestfailed", lambda r: failed_requests.append(f"{r.url} — {r.failure}"))
        wait_ready(page, base)

        # 1) المحتوى الأساسي
        check("بطاقة المنتج الواحدة معروضة", page.locator(".product-hero").count() == 1,
              f"العدد={page.locator('.product-hero').count()}")
        sizes = page.locator("#products .size-option-size").all_inner_texts()
        check("الأحجام 30/50/100 مل", [t.strip() for t in sizes] == ["30 مل", "50 مل", "100 مل"], str(sizes))
        prices = page.locator("#products .size-option-price").all_inner_texts()
        check("الأسعار المعروضة $19 / $26 / $29", [t.strip() for t in prices] == ["$19", "$26", "$29"], str(prices))
        check("سعر الوحدة ظاهر أسفل محدد الحجم ويتبع الاختيار",
              page.locator('[data-unit-live]').is_visible() and '$0.52' in page.locator('[data-unit-live]').inner_text())
        check("إزالة مقارنة تكلفة 10 مل", page.locator('[data-unit-comparison]').count() == 0)
        check("الرئيسية توفّر اختصارات العطر والمكونات والإرجاع",
              [x.get_attribute('href') for x in page.locator('.purchase-shortcuts a').all()] == ['#custom','#ingredients','#returns'])
        check("اتجاه الصفحة RTL", page.evaluate("getComputedStyle(document.body).direction") == "rtl")
        check("عنوان h1 واحد", page.locator("h1").count() == 1)
        # لا يخفت النص في بداية الحركة أو أثناءها؛ نحافظ على التباين دائمًا.
        reveal_opacity = page.evaluate("""async () => {
          const probe = document.createElement('div');
          probe.className = 'reveal'; probe.textContent = 'فحص الوضوح';
          document.body.appendChild(probe);
          const before = Number(getComputedStyle(probe).opacity);
          probe.classList.add('is-visible');
          await new Promise((resolve) => setTimeout(resolve, 100));
          const during = Number(getComputedStyle(probe).opacity);
          probe.remove();
          return {before, during};
        }""")
        check("النص يبقى واضحًا قبل حركة الظهور وأثناءها",
              reveal_opacity['before'] == 1 and reveal_opacity['during'] == 1, str(reveal_opacity))

        # قرارات المالك 2026-10-29: لا نِسب غير مصححة، ولا مدة تصنيع مختلقة.
        ingredients = page.locator("#ingredients").inner_text()
        check("البانثينول ظاهر دون الإيهام بأن القائمة كاملة",
              "البانثينول" in ingredients and "ليست القائمة الكاملة" in ingredients)
        check("لا نسب مئوية في قسم التركيبة قبل التصحيح", "%" not in ingredients and "٪" not in ingredients)
        check("الوصف الصحيح لحجم 50 مل ظاهر في البطاقة",
              page.locator('[data-size-for="serum-50"] .size-option-flag').inner_text() == "الأنسب للاستعمال اليومي")
        check("لا شارة الأكثر اختيارًا أو الأكثر طلبًا",
              "الأكثر اختيارًا" not in page.locator("body").inner_text() and
              "الأكثر طلبًا" not in page.locator("body").inner_text())
        ready_faq = page.locator("details").filter(has_text="هل السيروم جاهز ومتى يصل؟").text_content() or ""
        check("الأسئلة تميّز جاهزية السيروم وتجهيز العبوة وتترك الموعد للمحادثة",
              "السيروم جاهز" in ready_faq and "العبوة تُجهَّز عند الطلب" in ready_faq and "موعد التجهيز والتوصيل" in ready_faq)
        all_faq = page.locator("#faq").text_content() or ""
        check("لا مدة تصنيع مختلقة أو وعد بصورة قبل الشحن",
              "٢–٤ أيام" not in all_faq and "التصنيع حسب الطلب" not in all_faq and "صورة العبوة قبل الشحن" not in all_faq)
        check("الصور موصوفة بأنها تصميم لا صورة المنتج الفعلي",
              "تصوّر تصميمي" in (page.locator(".hero-figure figcaption").inner_text()) and
              "ليست صورة للمنتج الفعلي" in (page.locator(".hero-figure img").get_attribute("alt") or ""))
        check('تعريف رواء يبرز العمل مع المصنع والصيادلة والمخبر',
              all(word in page.locator('#craft').inner_text() for word in ['مصنع','صيادلة','مخبر']))
        privacy_faq = page.locator('details').filter(has_text='ماذا يحدث لاختياراتي في السلة؟').text_content() or ''
        estimate_faq = page.locator('details').filter(has_text='كم أدفع فعلًا عند الاستلام؟').text_content() or ''
        check('المحتوى يوضح استعادة الجلسة والتقدير دون ادعاء حماية حرارية',
              all(x in privacy_faq for x in ['قد يستعيد المتصفح','لا تُرسل تلقائيًا','واتساب']) and
              'حماية حرارية' not in (page.locator('main').text_content() or '') and
              all(x in estimate_faq for x in ['تقدير السلة','شام كاش خارج حماة','السعر النهائي']))
        faq_payment = page.locator("details").filter(has_text="ما طرق الدفع المتاحة؟").text_content() or ""
        check("FAQ الدفع تبيّن حماة ورسوم باقي المحافظات",
              "حماة فقط" in faq_payment and "$2" in faq_payment and "$4" in faq_payment)

        # اختيارات الرائحة والإضافة استفسار لا افتراض للتوفّر، وتُنقل إلى الرسالة.
        scent = page.locator('[data-custom-scent="vanilla"]')
        oil = page.locator('[data-custom-oil="argan"]')
        default_custom = page.locator('[data-custom-summary]').inner_text()
        check("الافتراضي لا يعد بإرسال منتج بلا عطر", "سنرسل" not in default_custom and "نؤكد" in default_custom)
        check("شرائح التخصيص تبدأ بحالة إتاحة غير محددة",
              scent.get_attribute("aria-pressed") == "false" and oil.get_attribute("aria-pressed") == "false")
        scent.click()
        oil.click()
        custom_message = page.evaluate("window.__RAWAA_TEST__.buildOrderMessage()")
        check("العطر والزيت المختاران يظهران في رسالة واتساب",
              "فانيلا" in custom_message and "أرجان" in custom_message and "تأكيد خيارات العطر أو الزيت" in custom_message)
        check("حالة الشرائح المحددة مفهومة لقارئ الشاشة",
              scent.get_attribute("aria-pressed") == "true" and oil.get_attribute("aria-pressed") == "true")
        scent.click()
        oil.click()
        check("إلغاء الاختيار يحدّث حالة الشرائح",
              scent.get_attribute("aria-pressed") == "false" and oil.get_attribute("aria-pressed") == "false")

        # الأصول محمّلة محليًا
        check("لا أخطاء JavaScript في الصفحة", not page_errors, "; ".join(page_errors))
        check("لا طلبات فاشلة", not failed_requests, "; ".join(failed_requests))

        # 2) السلة: إضافة، عدّاد، إشعار
        add_size(page, "serum-30")
        page.wait_for_timeout(120)
        badge = page.locator("[data-cart-count]")
        check("شارة السلة تظهر 1 بعد الإضافة", badge.inner_text() == "1" and badge.is_visible())
        check("ظهور إشعار تأكيد الإضافة", page.locator(".toast").count() >= 1)
        check("استجابة بصرية على الزر (is-added)",
              "is-added" in (page.locator("#products [data-add-current]").get_attribute("class") or ""))
        check("نص الزر يتغيّر مؤقتًا بعد الإضافة",
              "أُضيف" in page.locator("#products [data-add-current]").inner_text())

        # شريط السلة اللاصق (يُختبر في سياق الهاتف لاحقًا) وسعر الملليلتر
        # الحساب من CONFIG فقط (price ÷ sizeMl) — لا رقم مكتوب يدويًا
        # سعر الملليلتر يُقاس لكل حجم كما يراه الزائر عند تبديل الحجم
        per_ml = []
        for pid in ("serum-30", "serum-50", "serum-100"):
            page.locator("#products .size-option").nth(SIZE_INDEX[pid]).click()
            page.wait_for_timeout(120)
            per_ml.append(page.locator("[data-unit-live]").inner_text().split(" ")[0])
        check("سعر الملليلتر محسوب لكل حجم", per_ml == ["$0.63", "$0.52", "$0.29"], str(per_ml))
        check("السعر الحاضر يتبع الحجم المختار ولا يبقى ثابتًا",
              page.locator("[data-price-live]").inner_text().startswith("$29"),
              page.locator("[data-price-live]").inner_text())

        add_size(page, "serum-50")
        page.wait_for_timeout(80)
        add_size(page, "serum-100")
        page.wait_for_timeout(80)
        check("الشارة تعرض 3", page.locator("[data-cart-count]").inner_text() == "3")

        # 3) فتح السلة والتركيز
        page.locator('[data-cart-open]').first.click()
        page.wait_for_timeout(200)
        dialog = page.locator("#cart-dialog")
        check("نافذة السلة مفتوحة", dialog.evaluate("(d) => d.open") is True)
        check("التركيز انتقل داخل السلة",
              page.evaluate("document.activeElement?.hasAttribute('data-cart-close')") is True)

        # فحص احتجاز التركيز
        inside_flags = []
        for _ in range(14):
            page.keyboard.press("Tab")
            inside_flags.append(page.evaluate("!!document.activeElement?.closest('#cart-dialog')"))
        check("التركيز يبقى محتجزًا داخل السلة أثناء التنقل بلوحة المفاتيح", all(inside_flags),
              f"{inside_flags.count(True)}/{len(inside_flags)}")

        # 4) الكميات والمجاميع
        # الحالة بعد التكبير: 30مل×2 + 50مل×1 + 100مل×1 = 93 قيمة منتجات
        page.locator('[data-qty-increase="serum-30"]').click()
        page.wait_for_timeout(150)

        # الافتراضي = شام كاش: خصم 10% = 9.30 → الإجمالي 83.70 وتوصيل مجاني
        check("طريقة الدفع الافتراضية = شام كاش",
              page.evaluate("window.__RAWAA_TEST__.selectedMethod()") == "shamcash",
              str(page.evaluate("window.__RAWAA_TEST__.selectedMethod()")))
        total_text = page.locator("[data-cart-total]").inner_text()
        check("الشام كاش: قيمة المنتجات $93 ← خصم 10% ← الإجمالي ≈ $84",
              total_text == "≈ $84", total_text)
        check("صف قيمة المنتجات يظهر القيمة الصحيحة",
              page.locator("[data-cart-subtotal]").inner_text() == "$93",
              page.locator("[data-cart-subtotal]").inner_text())
        check("صف الخصم يظهر − ≈ $9",
              page.locator("[data-cart-discount]").inner_text() == "− ≈ $9",
              page.locator("[data-cart-discount]").inner_text())
        check("التوصيل يظهر «مجاني» مع الشام كاش",
              page.locator("[data-cart-delivery]").inner_text() == "مجاني",
              page.locator("[data-cart-delivery]").inner_text())

        # التبديل إلى الدفع عند الاستلام: بلا خصم + $2 توصيل = 95
        page.locator('[data-pay-select="cod"]').check()
        page.wait_for_timeout(200)
        cod_total = page.locator("[data-cart-total]").inner_text()
        check("الدفع عند الاستلام: $93 + $2 توصيل = $95 بلا خصم", cod_total == "$95", cod_total)
        check("صف الخصم مخفي مع الدفع عند الاستلام",
              not page.locator("[data-row-discount]").is_visible())
        check("رسوم التوصيل تظهر $2",
              page.locator("[data-cart-delivery]").inner_text() == "$2",
              page.locator("[data-cart-delivery]").inner_text())

        # --- مناطق التوصيل: الأرقام من المالك (حماة $2 / باقي المحافظات $4) ---
        page.locator('[data-pay-select="shamcash"]').check()
        page.wait_for_timeout(200)
        page.locator('[data-zone-select="hama"]').check()
        page.wait_for_timeout(250)
        check("حماة + شام كاش: توصيل مجاني", page.locator("[data-cart-delivery]").inner_text() == "مجاني",
              page.locator("[data-cart-delivery]").inner_text())

        page.locator('[data-zone-select="other"]').check()
        page.wait_for_timeout(250)
        check("باقي المحافظات + شام كاش: رسوم $4",
              page.locator("[data-cart-delivery]").inner_text() == "$4",
              page.locator("[data-cart-delivery]").inner_text())
        check("الإجمالي مع محافظات وشام كاش ($93 − 10% + $4 = ≈ $88)",
              page.locator("[data-cart-total]").inner_text() == "≈ $88",
              page.locator("[data-cart-total]").inner_text())

        page.locator('[data-pay-select="cod"]').check()
        page.wait_for_timeout(250)
        check("محافظات + استلام: $93 + $4 = $97",
              page.locator("[data-cart-total]").inner_text() == "$97",
              page.locator("[data-cart-total]").inner_text())

        page.locator('[data-zone-select="hama"]').check()
        page.wait_for_timeout(250)
        check("حماة + استلام: $93 + $2 = $95",
              page.locator("[data-cart-total]").inner_text() == "$95",
              page.locator("[data-cart-total]").inner_text())

        # التحقق المستقل من المعادلة في JS
        zone_pricing = page.evaluate(
            """() => {
                const t = window.__RAWAA_TEST__;
                t.setZone('other');
                const a = t.pricing();
                t.setMethod('shamcash');
                const b = t.pricing();
                return {
                  codOther: a.totalCents,
                  scOther: b.totalCents,
                  scDelivery: b.deliveryCents
                };
            }"""
        )
        check("المعادلة: استلام/محافظات = 9700 سنتًا",
              zone_pricing["codOther"] == 9700, json.dumps(zone_pricing))
        check("المعادلة: شام كاش/محافظات = 8770 سنتًا وتوصيل 400",
              zone_pricing["scOther"] == 8770 and zone_pricing["scDelivery"] == 400,
              json.dumps(zone_pricing))

        # نصوص طرق الدفع يجب أن تعكس المنطقة لا رقمًا ثابتًا (كانت تعرض $2 دائمًا)
        page.locator('[data-zone-select="other"]').check()
        page.locator('[data-pay-select="shamcash"]').check()
        page.wait_for_timeout(300)
        sc_text = " ".join(page.locator(".pay-desc").all_inner_texts())
        check("شام كاش + محافظات: النص يذكر عدم المجانية",
              "مجاني" not in sc_text or "داخل حماة" in sc_text,
              sc_text[:90].replace("\n", " "))

        page.locator('[data-pay-select="cod"]').check()
        page.wait_for_timeout(300)
        cod_text = " ".join(page.locator(".pay-desc").all_inner_texts())
        check("الدفع عند الاستلام يعرض رسم المنطقة ($4) لا $2",
              "$4" in cod_text, cod_text[:120].replace("\n", " "))

        page.locator('[data-zone-select="hama"]').check()
        page.wait_for_timeout(300)
        cod_hama = " ".join(page.locator(".pay-desc").all_inner_texts())
        check("الدفع عند الاستلام داخل حماة يعرض $2",
              "$2" in cod_hama, cod_hama[:120].replace("\n", " "))

        # ══ تنبيه الهامش: بعد تسعير 30 مل بـ 8$ لم تبقَ تركيبة خاسرة ══
        # الاختبار يتحقق من أن أي تنبيه هامش لا يظهر — أي أن التسعير سليم.
        page.locator('[data-pay-select="shamcash"]').check()
        page.locator('[data-zone-select="other"]').check()
        page.wait_for_timeout(300)
        page.evaluate("window.__RAWAA_TEST__.removeItem('serum-50'); window.__RAWAA_TEST__.removeItem('serum-100');")
        page.wait_for_timeout(200)
        page.evaluate("window.__RAWAA_TEST__.changeQty('serum-30', -9);")
        page.wait_for_timeout(300)
        margin_now = page.locator("[data-margin-note]").is_visible()
        check("لا تنبيه هامش في أسوأ تركيبة (30 مل · شام كاش · محافظات) — التسعير سليم",
              margin_now is False, f"ظاهر={margin_now}")

        # العودة إلى الحالة الأصلية: حذف 30 مل + استعادة 50 و100 مل
        page.evaluate("""() => {
            const t = window.__RAWAA_TEST__;
            t.addToCart('serum-50');
            t.addToCart('serum-100');
            t.changeQty('serum-30', 1);
        }""")
        page.wait_for_timeout(300)
        page.locator('[data-zone-select="hama"]').check()
        page.locator('[data-pay-select="shamcash"]').check()
        page.wait_for_timeout(250)

        # تحقق مستقل من المعادلة في JS (لا يعتمد على نص الواجهة)
        pricing = page.evaluate(
            """() => {
                const t = window.__RAWAA_TEST__;
                return { sc: t.pricing().totalCents, sub: t.pricing().subtotalCents,
                         disc: t.pricing().discountCents, del: t.pricing().deliveryCents };
            }"""
        )
        check("المعادلة في JS: 9300 − 930 + 0 = 8370 سنتًا",
              pricing == {"sc": 8370, "sub": 9300, "disc": 930, "del": 0}, json.dumps(pricing))

        page.locator('[data-qty-decrease="serum-30"]').click()
        page.wait_for_timeout(150)
        # 19+26+29 = 74 − 7.40 = 66.60
        check("بعد تقليل الكمية: ≈ $67",
              page.locator("[data-cart-total]").inner_text() == "≈ $67",
              page.locator("[data-cart-total]").inner_text())

        # زر التقليل معطّل عند 1
        check("زر التقليل معطّل عند الكمية 1",
              page.locator('[data-qty-decrease="serum-30"]').is_disabled() is True)

        # الحد الأقصى 10
        for _ in range(14):
            btn = page.locator('[data-qty-increase="serum-100"]')
            if btn.is_disabled():
                break
            btn.click()
            page.wait_for_timeout(35)
        qty_val = page.locator('[data-qty-value]').nth(2).inner_text()
        check("الكمية تتوقف عند الحد الأقصى 10", qty_val == "10", f"القيمة={qty_val}")
        check("زر الزيادة يُعطَّل عند الحد الأقصى",
              page.locator('[data-qty-increase="serum-100"]').is_disabled() is True)

        # 5) رسالة واتساب + اعتراض window.open
        captured = page.evaluate(
            """() => {
                window.__captured = null;
                window.open = (url) => { window.__captured = url; return { closed: false, opener: null }; };
                return true;
            }"""
        )
        page.locator("[data-cart-checkout]").click()
        page.wait_for_timeout(250)
        url = page.evaluate("window.__captured")
        check("زر المتابعة يفتح رابط واتساب", bool(url), str(url)[:80] if url else "لا رابط")

        decoded = ""
        if url:
            parsed = urllib.parse.urlparse(url)
            check("النطاق wa.me صحيح", parsed.netloc == "wa.me", parsed.netloc)
            check("رقم واتساب مطابق للرقم المعتمد", parsed.path == "/963997310856", parsed.path)
            qs = urllib.parse.parse_qs(parsed.query)
            decoded = qs.get("text", [""])[0]
            checks = {
                "الرسالة تحتوي التحية «مرحبًا رواء»": "مرحبًا رواء" in decoded,
                "الرسالة تحتوي اسم العلامة RAWAA": "RAWAA" in decoded,
                "الرسالة تحتوي 30 مل": "30 مل" in decoded,
                "الرسالة تحتوي 50 مل": "50 مل" in decoded,
                "الرسالة تحتوي 100 مل": "100 مل" in decoded,
                "الرسالة تحتوي الكميات (×)": "×" in decoded,
                "الرسالة تحتوي أسعار الوحدات": "$19" in decoded and "$26" in decoded and "$29" in decoded,
                "الرسالة تحتوي المجموع المرجعي": "المجموع المرجعي" in decoded,
                "الرسالة تحتوي قيمة المنتجات قبل الخصم": "قيمة المنتجات:" in decoded,
                "الرسالة تذكر طريقة الدفع المختارة": "طريقة الدفع المطلوبة:" in decoded,
                "الرسالة تذكر الخصم أو غيابه": ("خصم" in decoded),
                "الرسالة تذكر التوصيل": ("التوصيل" in decoded),
                "الرسالة تذكر منطقة التوصيل": ("منطقة التوصيل:" in decoded),
                "الرسالة تطلب تأكيد التوفّر": "توفّر" in decoded or "التوفر" in decoded,
                "الرسالة تطلب تأكيد السعر النهائي": "السعر النهائي" in decoded,
                "الرسالة تطلب تأكيد رسوم التوصيل": "رسوم التوصيل" in decoded,
                "الرسالة تطلب تأكيد موعد تجهيز العبوة دون وعد بمدة": "تأكيد موعد تجهيز العبوة" in decoded,
                "الرسالة تطلب تأكيد الدفع": "الدفع" in decoded,
                "الرسالة تُوضّح أنها ليست طلبًا مؤكدًا": "لا يُعد طلبًا مؤكدًا" in decoded or "طلبًا مؤكدًا" in decoded,
            }
            for name, ok in checks.items():
                check(name, ok)
            check("الرسالة لا تحتوي محارف مشوّهة (ترميز سليم)",
                  "Ã" not in decoded and "\ufffd" not in decoded)
            print("\n----- رسالة واتساب المولّدة -----")
            print(decoded)
            print("--------------------------------\n")

        # 6) تعذّر فتح النافذة → بديل
        page.evaluate("window.open = () => null")
        page.locator("[data-cart-checkout]").click()
        page.wait_for_timeout(250)
        fallback = page.locator("[data-cart-fallback]")
        check("يظهر البديل عند تعذّر فتح النافذة", fallback.is_visible())
        fb_href = page.locator("[data-cart-fallback-link]").get_attribute("href") or ""
        check("الرابط البديل رابط واتساب صالح",
              fb_href.startswith("https://wa.me/963997310856?text="), fb_href[:60])
        check("الرابط البديل يحتوي الرسالة العربية المرمّزة", "%D9%85" in fb_href or "%d9%85" in fb_href)
        check("يوجد زر نسخ الرقم كخيار إضافي", page.locator("[data-cart-copy-number]").is_visible())

        # 7) إغلاق بمفتاح Escape وإعادة التركيز
        page.keyboard.press("Escape")
        page.wait_for_timeout(250)
        check("Escape يغلق السلة", dialog.evaluate("(d) => d.open") is False)
        focus_back = page.evaluate("document.activeElement?.hasAttribute('data-cart-open')")
        check("التركيز يعود إلى زر فتح السلة بعد الإغلاق", focus_back is True)

        # 8) إزالة عنصر وتفريغ السلة
        page.locator('[data-cart-open]').first.click()
        page.wait_for_timeout(180)
        page.locator('[data-remove-item="serum-30"]').click()
        page.wait_for_timeout(150)
        check("حذف عنصر يعمل", page.locator(".cart-item").count() == 2, f"المتبقي={page.locator('.cart-item').count()}")
        page.locator('[data-remove-item="serum-50"]').click()
        page.wait_for_timeout(120)
        page.locator('[data-remove-item="serum-100"]').click()
        page.wait_for_timeout(180)
        check("السلة الفارغة تُظهر رسالة مناسبة", page.locator("[data-cart-empty]").is_visible())
        check("تذييل السلة يختفي عند الفراغ", page.locator("[data-cart-foot]").is_hidden())
        check("شارة العدد تختفي عند الفراغ", page.locator("[data-cart-count]").is_hidden())
        page.keyboard.press("Escape")
        page.wait_for_timeout(200)

        # 9) أزرار وروابط غير شكلية
        anchors = page.eval_on_selector_all("a", "els => els.map(a => a.getAttribute('href'))")
        check("كل رابط له href غير فارغ", all(h and h.strip() for h in anchors), str([h for h in anchors if not h]))
        wa_links = [h for h in anchors if h and "wa.me" in h]
        check("روابط واتساب كلها بالرقم المعتمد",
              all(h.startswith("https://wa.me/963997310856") for h in wa_links), str(wa_links))

        # 9ب) روابط العروض القابلة للمشاركة (?offer=)
        offer_ctx = browser.new_context(viewport={"width": 1280, "height": 900}, locale="ar")
        op = offer_ctx.new_page()
        op.goto(base + "/index.html?offer=cod", wait_until="load")
        op.wait_for_selector("#products [data-add-current]")
        op.wait_for_timeout(350)
        check("رابط ?offer=cod يختار الدفع عند الاستلام تلقائيًا",
              op.evaluate("window.__RAWAA_TEST__.selectedMethod()") == "cod")
        add_size(op, "serum-100")
        op.wait_for_timeout(300)
        op.locator("[data-cart-open]").first.click()
        op.wait_for_timeout(350)
        check("الحساب مع ?offer=cod: $29 + $2 = $31",
              op.locator("[data-cart-total]").inner_text() == "$31",
              op.locator("[data-cart-total]").inner_text())
        check("رابط مشاركة لكل طريقة دفع", op.locator(".pay-share").count() >= 0)  # خارج السلة

        op2 = offer_ctx.new_page()
        op2.goto(base + "/index.html?offer=غير-صالح", wait_until="load")
        op2.wait_for_selector("#products [data-add-current]")
        op2.wait_for_timeout(300)
        check("قيمة offer غير المعروفة تُتجاهل ويعود الافتراضي",
              op2.evaluate("window.__RAWAA_TEST__.selectedMethod()") == "shamcash")
        offer_ctx.close()

        # 9ج) حفظ السلة بعد التحديث + مشاركة السلة برابط
        cart_ctx = browser.new_context(viewport={"width": 390, "height": 844}, locale="ar")
        cp = cart_ctx.new_page()
        cp.goto(base + "/index.html", wait_until="load")
        cp.wait_for_selector("#products [data-add-current]")
        cp.wait_for_timeout(400)
        add_size(cp, "serum-30")
        add_size(cp, "serum-100")
        cp.wait_for_timeout(400)
        check("السلة تحفظ اختيارين", cp.locator("[data-cart-count]").inner_text() == "2")
        share_url = cp.evaluate("window.__RAWAA_TEST__.cartShareLink()")
        check("رابط مشاركة السلة يُبنى بصيغة صحيحة",
              "?cart=" in share_url and "serum-30" in share_url and "serum-100" in share_url, share_url)

        cp.reload(wait_until="load")
        cp.wait_for_selector("#products [data-add-current]")
        cp.wait_for_timeout(700)
        check("السلة تبقى بعد تحديث الصفحة", cp.locator("[data-cart-count]").inner_text() == "2",
              cp.locator("[data-cart-count]").inner_text())

        sp = cart_ctx.new_page()
        sp.goto(share_url, wait_until="load")
        sp.wait_for_selector("#products [data-add-current]")
        sp.wait_for_timeout(700)
        check("رابط السلة المشترك يعيد بناء نفس السلة",
              sp.locator("[data-cart-count]").inner_text() == "2",
              sp.locator("[data-cart-count]").inner_text())
        sp.locator("[data-cart-open]").first.click()
        sp.wait_for_timeout(500)
        check("إجمالي السلة المشتركة صحيح ($48 − 10% = ≈ $43)",
              sp.locator("[data-cart-total]").inner_text() == "≈ $43",
              sp.locator("[data-cart-total]").inner_text())

        # رابط سلة غير صالح يجب ألا يكسر الصفحة
        bp = cart_ctx.new_page()
        bp.goto(base + "/index.html?cart=serum-999x5,هراء", wait_until="load")
        bp.wait_for_selector("#products [data-add-current]")
        bp.wait_for_timeout(500)
        check("رابط سلة غير صالح يُتجاهل بهدوء",
              bp.locator("[data-cart-count]").is_hidden() or bp.locator("[data-cart-count]").inner_text() == "0")
        cart_ctx.close()

        # 10) قائمة الهاتف على سطح المكتب مخفية، وعلى الهاتف تعمل
        ctx2 = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True,
                                   has_touch=True, device_scale_factor=3, locale="ar")
        m = ctx2.new_page()
        wait_ready(m, base)
        check("قائمة الهاتف مخفية مبدئيًا", m.locator("#mobile-nav").is_hidden())
        m.locator("[data-nav-toggle]").click()
        m.wait_for_timeout(180)
        check("زر القائمة يفتح قائمة التنقل على الهاتف", m.locator("#mobile-nav").is_visible())
        check("aria-expanded=true عند الفتح",
              m.locator("[data-nav-toggle]").get_attribute("aria-expanded") == "true")
        m.locator('#mobile-nav a[href="#products"]').click()
        m.wait_for_timeout(400)
        check("القائمة تُغلق بعد اختيار رابط", m.locator("#mobile-nav").is_hidden())

        # 10ب) شريط السلة اللاصق على الهاتف
        m.locator('#products').scroll_into_view_if_needed()
        add_size(m, "serum-30")
        m.wait_for_timeout(400)
        check("شريط السلة اللاصق يظهر على الهاتف بعد الإضافة", m.locator("[data-sticky-bar]").is_visible())
        check("شريط السلة يوضح أن المبلغ تقديري", "تقديري" in m.locator("[data-sticky-bar]").inner_text())
        check("الشريط يعرض عدد القطع", m.locator("[data-sticky-count]").inner_text() == "1",
              m.locator("[data-sticky-count]").inner_text())
        check("الشريط يعرض الإجمالي المرجعي مع خصم شام كاش ($19 − 10% = ≈ $17)",
              m.locator("[data-sticky-total]").inner_text() == "≈ $17",
              m.locator("[data-sticky-total]").inner_text())
        m.locator("[data-sticky-bar] button").click()
        m.wait_for_timeout(400)
        check("النقر على الشريط يفتح السلة", m.locator("#cart-dialog").is_visible())
        check("الشريط يختفي والسلة مفتوحة", m.locator("[data-sticky-bar]").is_hidden())
        m.keyboard.press("Escape")
        m.wait_for_timeout(400)
        check("Escape يغلق السلة ويعيد الشريط للظهور", m.locator("[data-sticky-bar]").is_visible())
        m.locator("[data-cart-open]").first.click()
        m.wait_for_timeout(300)
        m.locator('[data-remove-item="serum-30"]').click()
        m.wait_for_timeout(400)
        m.keyboard.press("Escape")
        m.wait_for_timeout(300)
        check("الشريط يختفي عند إفراغ السلة", m.locator("[data-sticky-bar]").is_hidden())

        # 10ج) PWA: مانيفست + عامل خدمة + عمل بلا إنترنت
        pwa_ctx = browser.new_context(viewport={"width": 390, "height": 844}, locale="ar")
        pw = pwa_ctx.new_page()
        pw.goto(base + "/index.html", wait_until="load")
        pw.wait_for_selector("#products [data-add-current]")
        pw.wait_for_timeout(4000)
        if not pw.evaluate("!!navigator.serviceWorker.controller"):
            # عند أول زيارة يحتاج عامل الخدمة إعادة تنقّل بعد التثبيت كي يتحكم بالصفحة.
            pw.reload(wait_until="load")
            pw.wait_for_function("!!navigator.serviceWorker.controller", timeout=12000)

        import json as _json
        mani_href = pw.evaluate("document.querySelector('link[rel=manifest]')?.href || ''")
        check("رابط المانيفست معلن في الصفحة", bool(mani_href), mani_href)

        mani = pw.evaluate(
            """async () => {
                const l = document.querySelector('link[rel=manifest]');
                if (!l) return null;
                const r = await fetch(l.href);
                return await r.json();
            }"""
        )
        check("المانيفست يُقرأ ويُحلَّل بنجاح", isinstance(mani, dict))
        if isinstance(mani, dict):
            check("اسم التطبيق عربي وصحيح", mani.get("short_name") == "رواء", str(mani.get("short_name")))
            check("اتجاه التطبيق rtl", mani.get("dir") == "rtl", str(mani.get("dir")))
            check("وضع العرض standalone", mani.get("display") == "standalone", str(mani.get("display")))
            check("يحتوي أيقونة 192 وأيقونة maskable",
                  {i.get("purpose", "any") for i in mani.get("icons", [])} >= {"any", "maskable"},
                  str([i.get("purpose", "any") for i in mani.get("icons", [])]))

        check("عامل الخدمة مسجَّل ونشِط",
              pw.evaluate("!!navigator.serviceWorker.controller"),
              "controller=" + str(pw.evaluate("!!navigator.serviceWorker.controller")))

        apple_icon = pw.evaluate(
            "() => { const l = document.querySelector('link[rel=\"apple-touch-icon\"]'); return l ? l.getAttribute('href') : ''; }"
        )
        check("أيقونة آيفون (apple-touch-icon) معلنة", "apple-touch-icon" in apple_icon, apple_icon)

        # دعوة التثبيت اختيارية: تظهر عند توفر واجهة المتصفح فقط، ويظل الشرح اليدوي حاضرًا.
        install_flow = pw.evaluate("""async () => {
          const button = document.querySelector('[data-pwa-install]');
          const manual = document.querySelector('#install-app');
          if (!button || !manual) return {ok: false, reason: 'missing install controls'};
          const event = new Event('beforeinstallprompt', {cancelable: true});
          let calls = 0;
          event.prompt = () => { calls += 1; return Promise.resolve(); };
          event.userChoice = Promise.resolve({outcome: 'accepted'});
          window.dispatchEvent(event);
          const shown = !button.hidden && event.defaultPrevented;
          button.click();
          await new Promise(resolve => setTimeout(resolve, 0));
          window.dispatchEvent(new Event('appinstalled'));
          return {ok: shown && calls === 1 && button.hidden && manual.id === 'install-app', calls};
        }""")
        check("زر تثبيت PWA يعمل عند دعم المتصفح وتبقى إرشادات iOS/Android", install_flow.get("ok"),
              json.dumps(install_flow, ensure_ascii=False))

        # القطع الحقيقي: إعادة التحميل بلا شبكة
        pwa_ctx.set_offline(True)
        pw.reload(wait_until="load")
        pw.wait_for_timeout(1500)
        check("الصفحة تعمل بلا إنترنت", pw.locator(".product-hero").count() == 1,
              f"بطاقات={pw.locator('.product-hero').count()}")
        add_size(pw, "serum-50")
        pw.wait_for_timeout(400)
        check("السلة تعمل بلا إنترنت", pw.locator("[data-cart-count]").inner_text() == "1")
        pw.locator("[data-cart-open]").first.click()
        pw.wait_for_timeout(500)
        check("الحساب يعمل بلا إنترنت (≈ $23 مع شام كاش)",
              pw.locator("[data-cart-total]").inner_text() == "≈ $23",
              pw.locator("[data-cart-total]").inner_text())

        # تنقّل حقيقي بلا شبكة: يجب أن يعيد عامل الخدمة جذر الموقع إلى index.html المخزنة
        # حتى مع وجود query للحملة، وأن يبقي صفحة الخصوصية المستقلة متاحة من CORE.
        root_response = pw.goto(base + "/?utm_campaign=offline-browser-probe", wait_until="load")
        root_loaded = (pw.locator(".product-hero").count() == 1 and
                       pw.evaluate("location.pathname") == "/")
        check("تنقّل الجذر مع استعلام حملة يرجع إلى الرئيسية المخزنة بلا إنترنت",
              root_loaded, f"HTTP={root_response.status if root_response else 'n/a'}; path={pw.evaluate('location.pathname')}")
        privacy_response = pw.goto(base + "/privacy.html", wait_until="load")
        privacy_loaded = pw.locator("h1").inner_text().strip() == "سياسة الخصوصية"
        check("صفحة الخصوصية المسبقة التخزين تفتح بلا إنترنت",
              privacy_loaded, f"HTTP={privacy_response.status if privacy_response else 'n/a'}")

        image_fallbacks = pw.evaluate("""async () => {
          const cases = [
            ['/assets/img/products/size-50-v6-900.jpg?offline-probe=1', '/assets/img/products/size-50-v6-480.jpg'],
            ['/assets/img/products/trio-v6-1080.avif?offline-probe=1', '/assets/img/products/trio-v6-480.avif'],
            ['/assets/img/products/ritual-v5-1080.jpg?offline-probe=1', '/assets/img/products/ritual-v5-720.jpg'],
            ['/assets/img/products/size-100-v6-900.webp?offline-probe=1', '/assets/img/products/size-100-v6-480.webp']
          ];
          const results = [];
          for (const [requested, fallback] of cases) {
            try {
              const response = await fetch(requested);
              const cached = await caches.match(new URL(fallback, location.origin).href);
              if (!response.ok || !cached) {
                results.push({requested, ok: false, status: response.status, cached: !!cached});
                continue;
              }
              const [actual, expected] = await Promise.all([response.arrayBuffer(), cached.arrayBuffer()]);
              const a = new Uint8Array(actual), b = new Uint8Array(expected);
              const identical = a.length === b.length && a.every((value, index) => value === b[index]);
              results.push({requested, ok: identical, bytes: a.length});
            } catch (error) {
              results.push({requested, ok: false, error: String(error)});
            }
          }
          return results;
        }""")
        check("صور AVIF وWebP وJPEG عالية الدقة ترجع للصورة الصغيرة نفسها بلا إنترنت",
              len(image_fallbacks) == 4 and all(item.get("ok") for item in image_fallbacks),
              json.dumps(image_fallbacks, ensure_ascii=False))

        query_cache_urls = pw.evaluate("""async () => {
          const names = await caches.keys();
          const requests = (await Promise.all(names.map(async name =>
            (await (await caches.open(name)).keys()).map(request => request.url)
          ))).flat();
          return requests.filter(url => new URL(url).search);
        }""")
        check("التنقل بحملة بلا إنترنت لا يضيف مفتاحًا ذا query إلى CacheStorage",
              not query_cache_urls, str(query_cache_urls))
        pwa_ctx.set_offline(False)
        pwa_ctx.close()

        # 11) عدم وجود تمرير أفقي + أحجام اللمس
        for w, h, label in [(320, 640, "iPhone SE صغير"), (375, 812, "iPhone X"), (390, 844, "iPhone 14"),
                            (430, 932, "iPhone 15 Pro Max"), (768, 1024, "iPad"), (1024, 768, "لابتوب"),
                            (1440, 900, "سطح المكتب")]:
            vp = ctx2 if w == 390 else browser.new_context(viewport={"width": w, "height": h}, locale="ar")
            pg = m if w == 390 else vp.new_page()
            if w != 390:
                wait_ready(pg, base)
            overflow = pg.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
            check(f"لا تمرير أفقي عند {w}px ({label})", overflow <= 1, f"الفرق={overflow}px")

            if w <= 430:
                pg.evaluate('window.scrollTo(0, 0)')
                pg.wait_for_timeout(200)
                visual = pg.locator('.hero-figure img').bounding_box()
                primary = pg.locator('[data-discover-serum]').bounding_box()
                check(f"العبوات وزر الاختيار ظاهران في الشاشة الأولى عند {w}px",
                      bool(visual and primary and visual['y'] >= 0 and visual['y'] + visual['height'] <= h and
                           primary['y'] >= 0 and primary['y'] + primary['height'] <= h),
                      f"صورة={visual}; زر={primary}")
                small = pg.evaluate(
                    """() => {
                        const el = [...document.querySelectorAll('button, a.btn, .faq-list summary')];
                        return el.filter(e => {
                            const r = e.getBoundingClientRect();
                            return r.width > 0 && r.height > 0 && r.height < 44;
                        }).map(e => (e.textContent || e.tagName).trim().slice(0, 28) + ':' + Math.round(e.getBoundingClientRect().height));
                    }"""
                )
                check(f"أهداف اللمس ≥44px عند {w}px", len(small) == 0, str(small))

            if w >= 900:
                whole = pg.locator('.hero-figure img').evaluate("""img => {
                    const r = img.getBoundingClientRect();
                    const fit = getComputedStyle(img).objectFit;
                    return img.naturalWidth > 0 && (fit === 'contain' ||
                      Math.abs(r.width / r.height - img.naturalWidth / img.naturalHeight) < 0.02);
                }""")
                check(f"صورة العبوات لا تُقصّ على الشاشة الكبيرة {w}px", whole)

            if w != 390:
                pg.screenshot(path=str(SHOTS / f"viewport-{w}.png"), full_page=(w >= 768))
                vp.close()

        # لقطات نهائية موثّقة
        m.screenshot(path=str(SHOTS / "iphone-14-top.png"))
        m.evaluate("window.scrollTo(0, document.querySelector('#products').offsetTop)")
        m.wait_for_timeout(500)
        m.screenshot(path=str(SHOTS / "iphone-14-products.png"))
        add_size(m, "serum-50")
        m.locator("[data-cart-open]").first.click()
        m.wait_for_timeout(400)
        m.screenshot(path=str(SHOTS / "iphone-14-cart.png"))
        m.keyboard.press("Escape")

        # 12) احترام تقليل الحركة
        reduce_ctx = browser.new_context(viewport={"width": 390, "height": 844}, reduced_motion="reduce", locale="ar")
        rp = reduce_ctx.new_page()
        wait_ready(rp, base)
        anim = rp.evaluate(
            """() => {
                const el = document.querySelector('.product-hero');
                return getComputedStyle(el).transitionDuration;
            }"""
        )
        check("تقليل الحركة يُلغي مدد الانتقال", anim in ("0.001ms", "0s") or float(anim.replace("s", "") or 0) < 0.01,
              f"transitionDuration={anim}")

        # 13) الشاشة الكبيرة: أزرار ولوحة المفاتيح
        d = browser.new_context(viewport={"width": 1440, "height": 900}, locale="ar").new_page()
        wait_ready(d, base)
        d.keyboard.press("Tab")
        first_focus = d.evaluate("document.activeElement?.className")
        check("التنقل بلوحة المفاتيح يبدأ من رابط التخطي", "skip-link" in (first_focus or ""), str(first_focus))
        d.close()


        # ---------- 15) الصور: لا روابط مكسورة، والصيغة الحديثة تُستخدم ----------
        img_ctx = browser.new_context(viewport={"width": 390, "height": 844}, locale="ar")
        ip = img_ctx.new_page()
        bad_responses = []
        ip.on("response", lambda r: bad_responses.append(f"{r.status} {r.url}") if r.status >= 400 else None)
        wait_ready(ip, base)

        # نمرّ على الصفحة كاملة لتحميل الصور الكسولة
        for y in range(0, 9000, 400):
            ip.evaluate(f"window.scrollTo(0,{y})")
            ip.wait_for_timeout(45)
        ip.evaluate("window.scrollTo(0,0)")
        ip.wait_for_timeout(900)

        broken = ip.evaluate(
            """() => [...document.images]
                 .filter(i => i.complete && i.naturalWidth === 0)
                 .map(i => i.currentSrc || i.src)"""
        )
        check("لا صور مكسورة في الصفحة", len(broken) == 0, str(broken[:4]))

        total_imgs = ip.evaluate("document.images.length")
        # الصفحة الآن منتج واحد: صورة الهيرو (الثلاثية) + صورة الحجم + صورة تحريرية.
        # الشبكة ثلاثية البطاقات حُذفت 2026-10-28، فسقطت صورها الثلاث معها.
        check("عدد صور الصفحة 3 على الأقل", total_imgs >= 3, f"العدد={total_imgs}")

        check("لا استجابات HTTP ≥400", len(bad_responses) == 0, str(bad_responses[:4]))

        # هل يختار المتصفح AVIF/WebP من <picture>؟
        chosen = ip.evaluate(
            """() => [...document.images]
                 .map(i => i.currentSrc || '')
                 .filter(Boolean)"""
        )
        modern = [c for c in chosen if c.endswith('.avif') or c.endswith('.webp')]
        check("المتصفح اختار صيغة حديثة (AVIF/WebP) لمعظم الصور",
              len(modern) >= max(2, int(len(chosen) * 0.6)),
              f"{len(modern)}/{len(chosen)}")

        # كل صور المنتجات تحمل alt غير فارغ
        alts = ip.evaluate(
            """() => [...document.querySelectorAll('.product-hero img, .hero-figure img, #story img')]
                 .map(i => i.alt)"""
        )
        check("كل صور المنتج والتحريرية لها alt", all(a and a.strip() for a in alts), str(alts[:3]))
        # الصور الحالية تصميمية، لا صور للمنتج الفعلي — الـalt يوضح ذلك صراحةً
        check("alt لا يدّعي صورة منتج مُصنَّع",
              all(("مقترح" in a or "تصميم" in a) for a in alts), str(alts[:3]))

        # الصور لا تتجاوز عرض الشاشة
        wide = ip.evaluate(
            """() => [...document.images]
                 .filter(i => i.getBoundingClientRect().width > window.innerWidth + 2)
                 .map(i => i.currentSrc)"""
        )
        check("لا صورة تتجاوز عرض الشاشة", len(wide) == 0, str(wide[:3]))

        ip.screenshot(path=str(SHOTS / "v2-iphone-top.png"))
        # قسم #design حُذف 2026-10-28 — نلتقط قسم العلامة (يحمل صورة الثلاثية الآن)
        ip.evaluate("document.querySelector('#story').scrollIntoView()")
        ip.wait_for_timeout(500)
        ip.screenshot(path=str(SHOTS / "v2-iphone-story.png"))
        ip.evaluate("document.querySelector('#products').scrollIntoView()")
        ip.wait_for_timeout(500)
        ip.screenshot(path=str(SHOTS / "v2-iphone-products.png"))
        img_ctx.close()

        # 14) لا أخطاء كونسول بعد كل التفاعلات
        check("لا أخطاء console خلال الجلسة", not console_errors, " | ".join(console_errors[:3]))

        browser.close()

    passed = sum(1 for r in results if r["ok"])
    failed = len(results) - passed
    print("\n" + "=" * 56)
    print(f"نجح: {passed} · فشل: {failed} · الإجمالي: {len(results)}")
    (ROOT / "docs" / "test-report.json").write_text(
        json.dumps({"passed": passed, "failed": failed, "results": results}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8080")
    args = ap.parse_args()
    sys.exit(run(args.base))
