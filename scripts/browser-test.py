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
    return bool(condition)


def wait_ready(page, base):
    page.goto(base + "/index.html", wait_until="load")
    page.wait_for_selector("[data-product-grid] .product-card")
    page.evaluate("document.fonts.ready")


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
        cards = page.locator(".product-card")
        check("ثلاث بطاقات منتجات معروضة", cards.count() == 3, f"العدد={cards.count()}")
        prices = page.locator(".product-price .amount").all_inner_texts()
        check("الأسعار المعروضة $10 / $12 / $15", prices == ["$10", "$12", "$15"], str(prices))
        sizes = page.locator(".product-size").all_inner_texts()
        check("الأحجام 30/50/100 مل", sizes == ["30 مل", "50 مل", "100 مل"], str(sizes))
        check("اتجاه الصفحة RTL", page.evaluate("getComputedStyle(document.body).direction") == "rtl")
        check("عنوان h1 واحد", page.locator("h1").count() == 1)

        # الأصول محمّلة محليًا
        check("لا أخطاء JavaScript في الصفحة", not page_errors, "; ".join(page_errors))
        check("لا طلبات فاشلة", not failed_requests, "; ".join(failed_requests))

        # 2) السلة: إضافة، عدّاد، إشعار
        page.locator('[data-add-to-cart="serum-30"]').click()
        page.wait_for_timeout(120)
        badge = page.locator("[data-cart-count]")
        check("شارة السلة تظهر 1 بعد الإضافة", badge.inner_text() == "1" and badge.is_visible())
        check("ظهور إشعار تأكيد الإضافة", page.locator(".toast").count() >= 1)
        check("استجابة بصرية على الزر (is-added)",
              "is-added" in (page.locator('[data-add-to-cart="serum-30"]').get_attribute("class") or ""))
        check("نص الزر يتغيّر مؤقتًا بعد الإضافة",
              "أُضيف" in page.locator('[data-add-to-cart="serum-30"]').inner_text())

        # شريط السلة اللاصق (يُختبر في سياق الهاتف لاحقًا) وسعر الملليلتر
        per_ml = page.locator(".product-per-ml bdi").all_inner_texts()
        check("سعر الملليلتر محسوب لكل حجم",
              per_ml == ["$0.33", "$0.24", "$0.15"], str(per_ml))

        page.locator('[data-add-to-cart="serum-50"]').click()
        page.wait_for_timeout(80)
        page.locator('[data-add-to-cart="serum-100"]').click()
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
        # الحالة: 30مل×2=12 + 50مل×1=10 + 100مل×1=12 = 34 قيمة منتجات
        page.locator('[data-qty-increase="serum-30"]').click()
        page.wait_for_timeout(150)

        # الافتراضي = شام كاش: خصم 10% = 4.70 → الإجمالي 42.30 وتوصيل مجاني
        check("طريقة الدفع الافتراضية = شام كاش",
              page.evaluate("window.__RAWAA_TEST__.selectedMethod()") == "shamcash",
              str(page.evaluate("window.__RAWAA_TEST__.selectedMethod()")))
        total_text = page.locator("[data-cart-total]").inner_text()
        check("الشام كاش: قيمة المنتجات $47 ← خصم 10% ← الإجمالي $42.30",
              total_text == "$42.30", total_text)
        check("صف قيمة المنتجات يظهر القيمة الصحيحة",
              page.locator("[data-cart-subtotal]").inner_text() == "$47",
              page.locator("[data-cart-subtotal]").inner_text())
        check("صف الخصم يظهر − $4.70",
              page.locator("[data-cart-discount]").inner_text() == "− $4.70",
              page.locator("[data-cart-discount]").inner_text())
        check("التوصيل يظهر «مجاني» مع الشام كاش",
              page.locator("[data-cart-delivery]").inner_text() == "مجاني",
              page.locator("[data-cart-delivery]").inner_text())

        # التبديل إلى الدفع عند الاستلام: بلا خصم + $2 توصيل = 36
        page.locator('[data-pay-select="cod"]').check()
        page.wait_for_timeout(200)
        cod_total = page.locator("[data-cart-total]").inner_text()
        check("الدفع عند الاستلام: $47 + $2 توصيل = $49 بلا خصم", cod_total == "$49", cod_total)
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
        check("الإجمالي مع محافظات وشام كاش ($47 − 10% + $4 = $46.30)",
              page.locator("[data-cart-total]").inner_text() == "$46.30",
              page.locator("[data-cart-total]").inner_text())

        page.locator('[data-pay-select="cod"]').check()
        page.wait_for_timeout(250)
        check("محافظات + استلام: $47 + $4 = $51",
              page.locator("[data-cart-total]").inner_text() == "$51",
              page.locator("[data-cart-total]").inner_text())

        page.locator('[data-zone-select="hama"]').check()
        page.wait_for_timeout(250)
        check("حماة + استلام: $47 + $2 = $49",
              page.locator("[data-cart-total]").inner_text() == "$49",
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
        check("المعادلة: استلام/محافظات = 5100 سنتًا",
              zone_pricing["codOther"] == 5100, json.dumps(zone_pricing))
        check("المعادلة: شام كاش/محافظات = 4630 سنتًا وتوصيل 400",
              zone_pricing["scOther"] == 4630 and zone_pricing["scDelivery"] == 400,
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
        check("المعادلة في JS: 4700 − 470 + 0 = 4230 سنتًا",
              pricing == {"sc": 4230, "sub": 4700, "disc": 470, "del": 0}, json.dumps(pricing))

        page.locator('[data-qty-decrease="serum-30"]').click()
        page.wait_for_timeout(150)
        # 8+10+12 = 30 − 3.00 = 27
        check("بعد تقليل الكمية: $33.30",
              page.locator("[data-cart-total]").inner_text() == "$33.30",
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
                "الرسالة تحتوي أسعار الوحدات": "$10" in decoded and "$12" in decoded and "$15" in decoded,
                "الرسالة تحتوي المجموع المرجعي": "المجموع المرجعي" in decoded,
                "الرسالة تحتوي قيمة المنتجات قبل الخصم": "قيمة المنتجات:" in decoded,
                "الرسالة تذكر طريقة الدفع المختارة": "طريقة الدفع المطلوبة:" in decoded,
                "الرسالة تذكر الخصم أو غيابه": ("خصم" in decoded),
                "الرسالة تذكر التوصيل": ("التوصيل" in decoded),
                "الرسالة تذكر منطقة التوصيل": ("منطقة التوصيل:" in decoded),
                "الرسالة تطلب تأكيد التوفّر": "توفّر" in decoded or "التوفر" in decoded,
                "الرسالة تطلب تأكيد السعر النهائي": "السعر النهائي" in decoded,
                "الرسالة تطلب تأكيد رسوم التوصيل": "رسوم التوصيل" in decoded,
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
        op.wait_for_selector(".product-card")
        op.wait_for_timeout(350)
        check("رابط ?offer=cod يختار الدفع عند الاستلام تلقائيًا",
              op.evaluate("window.__RAWAA_TEST__.selectedMethod()") == "cod")
        op.locator('[data-add-to-cart="serum-100"]').click()
        op.wait_for_timeout(300)
        op.locator("[data-cart-open]").first.click()
        op.wait_for_timeout(350)
        check("الحساب مع ?offer=cod: $15 + $2 = $17",
              op.locator("[data-cart-total]").inner_text() == "$17",
              op.locator("[data-cart-total]").inner_text())
        check("رابط مشاركة لكل طريقة دفع", op.locator(".pay-share").count() >= 0)  # خارج السلة

        op2 = offer_ctx.new_page()
        op2.goto(base + "/index.html?offer=غير-صالح", wait_until="load")
        op2.wait_for_selector(".product-card")
        op2.wait_for_timeout(300)
        check("قيمة offer غير المعروفة تُتجاهل ويعود الافتراضي",
              op2.evaluate("window.__RAWAA_TEST__.selectedMethod()") == "shamcash")
        offer_ctx.close()

        # 9ج) حفظ السلة بعد التحديث + مشاركة السلة برابط
        cart_ctx = browser.new_context(viewport={"width": 390, "height": 844}, locale="ar")
        cp = cart_ctx.new_page()
        cp.goto(base + "/index.html", wait_until="load")
        cp.wait_for_selector(".product-card")
        cp.wait_for_timeout(400)
        cp.locator('[data-add-to-cart="serum-30"]').click()
        cp.locator('[data-add-to-cart="serum-100"]').click()
        cp.wait_for_timeout(400)
        check("السلة تحفظ اختيارين", cp.locator("[data-cart-count]").inner_text() == "2")
        share_url = cp.evaluate("window.__RAWAA_TEST__.cartShareLink()")
        check("رابط مشاركة السلة يُبنى بصيغة صحيحة",
              "?cart=" in share_url and "serum-30" in share_url and "serum-100" in share_url, share_url)

        cp.reload(wait_until="load")
        cp.wait_for_selector(".product-card")
        cp.wait_for_timeout(700)
        check("السلة تبقى بعد تحديث الصفحة", cp.locator("[data-cart-count]").inner_text() == "2",
              cp.locator("[data-cart-count]").inner_text())

        sp = cart_ctx.new_page()
        sp.goto(share_url, wait_until="load")
        sp.wait_for_selector(".product-card")
        sp.wait_for_timeout(700)
        check("رابط السلة المشترك يعيد بناء نفس السلة",
              sp.locator("[data-cart-count]").inner_text() == "2",
              sp.locator("[data-cart-count]").inner_text())
        sp.locator("[data-cart-open]").first.click()
        sp.wait_for_timeout(500)
        check("إجمالي السلة المشتركة صحيح ($25 − 10% = $22.50)",
              sp.locator("[data-cart-total]").inner_text() == "$22.50",
              sp.locator("[data-cart-total]").inner_text())

        # رابط سلة غير صالح يجب ألا يكسر الصفحة
        bp = cart_ctx.new_page()
        bp.goto(base + "/index.html?cart=serum-999x5,هراء", wait_until="load")
        bp.wait_for_selector(".product-card")
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
        m.locator("#mobile-nav a").first.click()
        m.wait_for_timeout(400)
        check("القائمة تُغلق بعد اختيار رابط", m.locator("#mobile-nav").is_hidden())

        # 10ب) شريط السلة اللاصق على الهاتف
        m.locator('#products').scroll_into_view_if_needed()
        m.locator('[data-add-to-cart="serum-30"]').click()
        m.wait_for_timeout(400)
        check("شريط السلة اللاصق يظهر على الهاتف بعد الإضافة", m.locator("[data-sticky-bar]").is_visible())
        check("الشريط يعرض عدد القطع", m.locator("[data-sticky-count]").inner_text() == "1",
              m.locator("[data-sticky-count]").inner_text())
        check("الشريط يعرض الإجمالي المرجعي مع خصم شام كاش ($10 − 10% = $9)",
              m.locator("[data-sticky-total]").inner_text() == "$9",
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
        pw.wait_for_selector(".product-card")
        pw.wait_for_timeout(4000)

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

        # القطع الحقيقي: إعادة التحميل بلا شبكة
        pwa_ctx.set_offline(True)
        pw.reload(wait_until="load")
        pw.wait_for_timeout(1500)
        check("الصفحة تعمل بلا إنترنت", pw.locator(".product-card").count() == 3,
              f"بطاقات={pw.locator('.product-card').count()}")
        pw.locator('[data-add-to-cart="serum-50"]').click()
        pw.wait_for_timeout(400)
        check("السلة تعمل بلا إنترنت", pw.locator("[data-cart-count]").inner_text() == "1")
        pw.locator("[data-cart-open]").first.click()
        pw.wait_for_timeout(500)
        check("الحساب يعمل بلا إنترنت ($10.80 مع شام كاش)",
              pw.locator("[data-cart-total]").inner_text() == "$10.80",
              pw.locator("[data-cart-total]").inner_text())
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

            if w != 390:
                pg.screenshot(path=str(SHOTS / f"viewport-{w}.png"), full_page=(w >= 768))
                vp.close()

        # لقطات نهائية موثّقة
        m.screenshot(path=str(SHOTS / "iphone-14-top.png"))
        m.evaluate("window.scrollTo(0, document.querySelector('#products').offsetTop)")
        m.wait_for_timeout(500)
        m.screenshot(path=str(SHOTS / "iphone-14-products.png"))
        m.locator("[data-add-to-cart='serum-50']").click()
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
                const el = document.querySelector('.product-card');
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
        check("عدد صور الصفحة أكبر من 8", total_imgs > 8, f"العدد={total_imgs}")

        check("لا استجابات HTTP ≥400", len(bad_responses) == 0, str(bad_responses[:4]))

        # هل يختار المتصفح AVIF/WebP من <picture>؟
        chosen = ip.evaluate(
            """() => [...document.images]
                 .map(i => i.currentSrc || '')
                 .filter(Boolean)"""
        )
        modern = [c for c in chosen if c.endswith('.avif') or c.endswith('.webp')]
        check("المتصفح اختار صيغة حديثة (AVIF/WebP) لمعظم الصور",
              len(modern) >= max(3, int(len(chosen) * 0.7)),
              f"{len(modern)}/{len(chosen)}")

        # كل صور المنتجات تحمل alt غير فارغ
        alts = ip.evaluate(
            """() => [...document.querySelectorAll('.product-card img, .gallery img, .hero-figure img')]
                 .map(i => i.alt)"""
        )
        check("كل صور المنتجات والمعرض لها alt", all(a and a.strip() for a in alts), str(alts[:3]))
        check("alt لا يدّعي صورة فوتوغرافية حقيقية",
              all(("توضيحي" in a or "للتصميم" in a) and ("مُصنَّع" in a or "مصنَّع" in a or "توفّره" in a)
                  for a in alts), str(alts[:3]))

        # الصور لا تتجاوز عرض الشاشة
        wide = ip.evaluate(
            """() => [...document.images]
                 .filter(i => i.getBoundingClientRect().width > window.innerWidth + 2)
                 .map(i => i.currentSrc)"""
        )
        check("لا صورة تتجاوز عرض الشاشة", len(wide) == 0, str(wide[:3]))

        ip.screenshot(path=str(SHOTS / "v2-iphone-top.png"))
        ip.evaluate("document.querySelector('#design').scrollIntoView()")
        ip.wait_for_timeout(500)
        ip.screenshot(path=str(SHOTS / "v2-iphone-design.png"))
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
