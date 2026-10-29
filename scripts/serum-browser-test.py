#!/usr/bin/env python3
"""اختبار صفحة الإعلان: المتصفح، السلة، واتساب، مصدر الحملة وaxe.

لا تُرسل رسالة ولا تفتح واتساب: نستبدل window.open بجامع روابط محلي.
يمكن اختبار /serum على الموقع الحي أو /serum.html على خادم ملفات بسيط.
"""
from __future__ import annotations
import argparse
import json
import os
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlparse
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
AXE = (ROOT / "scripts/vendor/axe.min.js").read_text(encoding="utf-8")
checks: list[tuple[str, bool, str]] = []


def report_exception(exc_type, value, traceback):
    if os.environ.get('GITHUB_ACTIONS') == 'true':
        frame = traceback
        while frame and frame.tb_next:
            frame = frame.tb_next
        location = f'{Path(frame.tb_frame.f_code.co_filename).name}:{frame.tb_lineno}' if frame else 'unknown'
        print(f'::error::اختبار المتصفح توقف باستثناء {exc_type.__name__} ({location})', flush=True)
    sys.__excepthook__(exc_type, value, traceback)


sys.excepthook = report_exception


def check(name: str, condition: bool, detail: str = "") -> None:
    checks.append((name, bool(condition), detail))
    print(f"  {'✓' if condition else '✗'} {name}" + (f" — {detail}" if detail else ""))
    if not condition and os.environ.get('GITHUB_ACTIONS') == 'true':
        # نشر اسم الفحص فقط؛ التفاصيل قد تحوي روابط أو معلومات لا يلزم إعلانها.
        print(f"::error::{name}")


def audit(page, label: str) -> None:
    page.add_script_tag(content=AXE)
    violations = page.evaluate("""async () => {
      const r = await axe.run(document, {runOnly: {type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']}});
      return r.violations.map(v => ({id: v.id, impact: v.impact,
        targets: v.nodes.slice(0, 3).map(n => n.target.join(' '))}));
    }""")
    check(f"{label}: axe بلا مخالفات", not violations, json.dumps(violations, ensure_ascii=False))


def run(base: str, path: str, browser_name: str, ignore_https: bool, screenshot_dir: str | None) -> int:
    base = base.rstrip("/")
    with sync_playwright() as p:
        browser = getattr(p, browser_name).launch()
        for width, height in [(320, 640), (390, 844), (430, 932), (1440, 900)]:
            print(f"\n{browser_name} · {width}×{height}")
            ctx = browser.new_context(viewport={"width": width, "height": height},
                                      is_mobile=width < 600, has_touch=width < 600,
                                      locale="ar", reduced_motion="reduce",
                                      ignore_https_errors=ignore_https)
            ctx.add_init_script("""window.__waCalls = [];
                window.open = function(url) { window.__waCalls.push(url); return null; };""")
            page = ctx.new_page()
            errors: list[str] = []
            bad: list[str] = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.on("response", lambda r: bad.append(f"{r.status} {r.url}") if r.status >= 400 else None)
            response = page.goto(base + path + "?utm_source=facebook&utm_medium=paid&utm_campaign=serum-oct&utm_content=moment", wait_until="load", timeout=45000)
            page.wait_for_selector('#products .size-option input')
            page.evaluate('document.fonts.ready')
            check("صفحة حقيقية HTTP 200", bool(response and response.status == 200), str(response.status if response else None))
            check("عنوان عربي واحد واتجاه RTL", page.locator('h1').count() == 1 and page.evaluate("getComputedStyle(document.body).direction") == 'rtl')
            intro = page.locator('.serum-purchase .serum-intro').inner_text()
            benefit = page.locator('#benefits').inner_text()
            check("الرسالة تبدأ بحاجة وفائدة لا بالمكوّنات وحدها", all(word in intro for word in ['الباهت','المتطاير','مظهر أنعم','لمعان لطيف']) and 'سيروم رواء للشعر' in page.locator('.serum-heading').inner_text())
            check("الفوائد والاستعمال واختلاف النتيجة واضحة", all(word in benefit for word in ['ملمسًا أنعم','كمية صغيرة','النتيجة والإحساس يختلفان']))
            add_box = page.locator('[data-add-current]').bounding_box()
            check("زر الاختيار ظاهر في الشاشة الأولى", bool(add_box and add_box['y'] >= 0 and add_box['y'] + add_box['height'] <= height), str(add_box))
            check("الأحجام والأسعار من الإعدادات", page.locator('#products .size-option-size').all_inner_texts() == ['30 مل','50 مل','100 مل'] and page.locator('#products .size-option-price').all_inner_texts() == ['$10','$12','$15'])
            check("شارة 50 مل مطابقة لتوجيه المالك", page.locator('[data-size-for="serum-50"] .size-option-flag').inner_text() == 'الأنسب للاستعمال اليومي')
            units = page.locator('[data-unit-comparison] li')
            check("تكلفة 10 مل ظاهرة لكل الأحجام ومحسوبة قبل الرسوم",
                  units.count() == 3 and [x.inner_text().replace('\n', ' ') for x in units.all()] ==
                  ['30 مل $3.33', '50 مل $2.40', '100 مل $1.50'] and
                  all(x in page.locator('.unit-comparison-note').inner_text() for x in ['تقريبية','قبل الخصم والتوصيل','لا نعرض عبوة 10 مل']))
            quick = page.locator('.purchase-shortcuts a')
            check("روابط العطر والمكونات والإرجاع قرب الشراء بأهداف لمس كافية",
                  quick.count() == 3 and [x.get_attribute('href') for x in quick.all()] == ['#custom','#ingredients','#returns'] and
                  all((x.bounding_box() or {}).get('height', 0) >= 44 for x in quick.all()))
            check("لا تمرير أفقي", page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'))
            if width < 600:
                check("عرض شام كاش مقروء بلا اقتطاع", page.locator('.topbar-short').evaluate('(e) => e.scrollWidth <= e.clientWidth + 1'))
            check("الصورة توضيحية وليست صورة منتج", 'ليست صورة للمنتج الفعلي' in (page.locator('[data-size-img]').get_attribute('alt') or '') and 'تصوّر تصميمي' in page.locator('.serum-photo figcaption').inner_text())
            package_note = page.locator('.serum-packaging-note').inner_text()
            check("السيروم جاهز والعبوة تُجهّز عند الطلب والموعد بالتأكيد", all(x in package_note for x in ['السيروم جاهز','العبوة تُجهَّز عند الطلب','موعد التجهيز والتوصيل']))
            check("صورة الحجم المختار من تصميم العبوة الجديد", 'size-50-v6-' in (page.locator('[data-size-img]').get_attribute('src') or ''))
            check("المكوّنات غير مكتملة ولا نِسب فيها", 'البانثينول' in page.locator('#ingredients').inner_text() and 'ليست القائمة الكاملة' in page.locator('#ingredients').inner_text() and '%' not in page.locator('#ingredients').inner_text())
            check("المصدر محفوظ في الجلسة", page.evaluate('window.rawaaSrcTag()') == 'serum-oct')
            direct = page.locator('[data-wa-direct]').first.get_attribute('href') or ''
            direct_msg = parse_qs(urlparse(direct).query).get('text', [''])[0]
            check("الحملة ونسخة المحتوى في واتساب المباشر", all(x in direct_msg for x in ['— المصدر: serum-oct','— القناة: facebook','— نسخة المحتوى: moment']) and direct_msg.count('— المصدر: serum-oct') == 1)
            check("استفسار واتساب يوضح الحجم الافتراضي والسعر المرجعي وموعد التجهيز",
                  all(x in direct_msg for x in ['50 مل','$12','قبل الخصم والتوصيل','موعد تجهيز العبوة']) and
                  page.locator('[data-wa-context]').is_visible() and 'راجعي الرسالة' in page.locator('[data-wa-context]').inner_text())
            check("رسوم التوصيل وشروطها قرب الشراء", all(x in page.locator('.serum-trust').inner_text() for x in ['حماة فقط','$4','$2','بلا خصم']))
            estimate = page.locator('[data-order-estimate]')
            check("تقدير العبوة الواحدة يظهر بافتراضاته قبل فتح السلة",
                  estimate.is_visible() and 'عبوة واحدة' in estimate.inner_text() and
                  all(x in page.locator('[data-estimate-context]').inner_text() for x in ['50 مل','حماة','شام كاش']) and
                  page.locator('[data-estimate-total]').inner_text() == '$10.80')
            check("تقدير العبوة يوضح أنه ليس إجمالي كل السلة",
                  'بقية المنتجات والكميات تُحسب في السلة' in estimate.inner_text() and 'السعر والتوفّر يُؤكّدان' in estimate.inner_text())
            page.locator('.serum-size-guide summary').click()
            guide = page.locator('.serum-size-guide').inner_text()
            check("دليل الحجم يشرح التجربة والاستعمال والقيمة", all(x in guide for x in ['30 مل','50 مل','100 مل','الأنسب للاستعمال اليومي','لكل ملليلتر']))
            page.locator('.serum-size-guide summary').click()
            # معرض بمشاهد موسومة وأزرار عادية تعمل بلوحة المفاتيح وفي اللمس.
            buttons = page.locator('[data-serum-controls]:visible button')
            check("مجموعة مشاهد واحدة ظاهرة وثلاثة أهداف لمس كافية",
                  buttons.count() == 3 and all((b.bounding_box() or {}).get('height', 0) >= 44 for b in buttons.all()))
            sizes_view = page.locator('[data-serum-control="sizes"]:visible')
            sizes_view.focus(); sizes_view.press('Enter')
            check("معرض الأحجام يعمل بلوحة المفاتيح ولا يدّعي مقياسًا فعليًا",
                  page.locator('[data-serum-view="sizes"]').is_visible() and sizes_view.get_attribute('aria-pressed') == 'true' and
                  'لا يوضّح القياسات' in page.locator('[data-serum-caption]').inner_text())
            ritual_view = page.locator('[data-serum-control="ritual"]:visible')
            ritual_view.focus(); ritual_view.press('Space')
            check("المشهد التعبيري موسوم ولا يُعرض نتيجة للمنتج",
                  page.locator('[data-serum-view="ritual"]').is_visible() and ritual_view.get_attribute('aria-pressed') == 'true' and
                  'مولّد' in page.locator('[data-serum-caption]').inner_text() and 'لا يعرض المنتج' in page.locator('[data-serum-caption]').inner_text())
            if width == 390:
                audit(page, 'المشهد المفتوح')
                sizes_view.tap()
                check("تبديل المشهد باللمس المحاكى يعمل", page.locator('[data-serum-view="sizes"]').is_visible())
            page.locator('#products .size-option').nth(2).click()
            check("اختيار حجم جديد يعيد صورته ويحدّث حالة المعرض",
                  page.locator('[data-serum-view="bottle"]').is_visible() and
                  page.locator('[data-serum-control="bottle"]:visible').get_attribute('aria-pressed') == 'true')
            check("السعر المختار يُعلن لقارئ الشاشة وتتبعه الصورة", '$15' in page.locator('[data-price-live]').inner_text() and '100 مل' in (page.locator('[data-size-img]').get_attribute('alt') or ''))
            check("تبديل الحجم يحدّث ملفات الصور الجديدة", 'size-100-v6-' in (page.locator('[data-size-img]').get_attribute('src') or '') and 'size-100-v6-' in (page.locator('[data-size-avif]').get_attribute('srcset') or ''))
            selected_msg = parse_qs(urlparse(page.locator('[data-wa-selected]').get_attribute('href') or '').query).get('text', [''])[0]
            check("استفسار واتساب يتبع 100 مل دون تكرار مصدر الحملة",
                  '100 مل' in selected_msg and '$15' in selected_msg and '50 مل' not in selected_msg and
                  selected_msg.count('— المصدر: serum-oct') == 1)
            check("التقدير يتبع الحجم المختار", page.locator('[data-estimate-total]').inner_text() == '$13.50' and '100 مل' in page.locator('[data-estimate-context]').inner_text())
            page.locator('#products .size-option').nth(1).click()
            check("لا بكسل مفعّل بلا معرّف", not page.evaluate('!!window.fbq') and page.locator('[data-consent-bar]').is_hidden())
            if screenshot_dir and width == 390:
                Path(screenshot_dir).mkdir(parents=True, exist_ok=True)
                page.screenshot(path=str(Path(screenshot_dir) / f'serum-{browser_name}-390.png'), full_page=False)
            audit(page, 'الصفحة')
            page.locator('#ritual img').scroll_into_view_if_needed()
            image_loaded = page.locator('#ritual img').evaluate("""el => new Promise(resolve => {
              if (el.complete) return resolve(el.naturalWidth > 0);
              el.addEventListener('load', () => resolve(el.naturalWidth > 0), {once:true});
              el.addEventListener('error', () => resolve(false), {once:true});
              setTimeout(() => resolve(false), 15000);
            })""")
            check("المشهد التعبيري يحمل وصفًا واضحًا وخطوات استخدام", image_loaded and 'مشهد تعبيري' in page.locator('#ritual figcaption').inner_text() and 'لا يعرض نتيجة' in page.locator('#ritual figcaption').inner_text() and page.locator('#ritual .serum-ritual-steps li').count() == 3)
            page.locator('#ritual a[href="#products"]').click()
            check("زر اللحظة يعود لاختيار الحجم", urlparse(page.url).fragment == 'products')
            page.locator('#returns summary').click()
            check("الإرجاع للاستفسار لا سياسة مختلقة", 'الاستفسار عن الشروط' in page.locator('#returns').inner_text() and 'wa.me/963997310856' in (page.locator('#returns a').get_attribute('href') or ''))
            page.locator('.serum-benefits-cta').click()
            check("زر الفوائد يعيد الزائرة إلى اختيار الحجم", urlparse(page.url).fragment == 'products' and page.locator('[data-add-current]').is_visible())

            # إضافة الحجم الافتراضي تفتح السلة؛ لا يُحسب فتحها محادثة.
            page.locator('[data-add-current]').click()
            dialog = page.locator('#cart-dialog')
            check("الزر يضيف ويفتح السلة", dialog.evaluate('(d) => d.open') and page.locator('[data-cart-count]').inner_text() == '1')
            ev = page.evaluate("JSON.parse(sessionStorage.getItem('rawaa_events') || '[]').map(x => x.e)")
            check("فتح السلة ليس Contact أو طلبًا مكتملًا", 'Contact' not in ev and 'InitiateCheckout' not in ev and 'Purchase' not in ev, str(ev))
            check("50 مل + شام كاش حماة = $10.80", page.locator('[data-cart-subtotal]').inner_text() == '$12' and page.locator('[data-cart-total]').inner_text() == '$10.80' and page.locator('[data-cart-delivery]').inner_text() == 'مجاني')
            hama_fee = page.locator('[data-zone-select="hama"]').locator('..').locator('.zone-fee')
            other_fee = page.locator('[data-zone-select="other"]').locator('..').locator('.zone-fee')
            check("بطاقتا المنطقة تتبعان رسوم شام كاش الفعلية", 'مجاني' in hama_fee.inner_text() and '$4' in other_fee.inner_text())
            page.locator('[data-zone-select="other"]').check()
            check("50 مل + شام كاش المحافظات = $14.80", page.locator('[data-cart-total]').inner_text() == '$14.80')
            page.locator('[data-pay-select="cod"]').check()
            check("بطاقتا المنطقة تتبعان رسوم الاستلام الفعلية", '$2' in hama_fee.inner_text() and '$4' in other_fee.inner_text())
            check("50 مل + استلام المحافظات = $16", page.locator('[data-cart-total]').inner_text() == '$16')
            page.locator('[data-zone-select="hama"]').check()
            check("50 مل + استلام حماة = $14", page.locator('[data-cart-total]').inner_text() == '$14')
            audit(page, 'السلة المفتوحة')
            page.locator('[data-cart-close]').click()
            if width < 600:
                sticky = page.locator('[data-sticky-bar]')
                sticky.wait_for(state='visible', timeout=5000)
                check("شريط السلة يوضح أن المبلغ تقديري ويتبع المنطقة والدفع",
                      sticky.is_visible() and 'تقديري' in sticky.inner_text() and
                      page.locator('[data-sticky-total]').inner_text() == '$14')
                check("تسمية التقدير وزر السلة مقروءان دون اقتطاع",
                      sticky.locator('.sticky-bar-btn').evaluate("""e => {
                        const bounds = e.getBoundingClientRect();
                        return [...e.children].every(child => {
                          const r = child.getBoundingClientRect();
                          return r.left >= bounds.left - 1 && r.right <= bounds.right + 1 &&
                            child.scrollWidth <= child.clientWidth + 1;
                        });
                      }"""))
            check("تغيير المنطقة والدفع في السلة يحدّث تقدير الصفحة",
                  page.locator('[data-estimate-total]').inner_text() == '$14' and
                  page.locator('[data-estimate-zone]').input_value() == 'hama' and
                  page.locator('[data-estimate-method]').input_value() == 'cod')

            # الخيارات للاستفسار فقط، وتُرفق برسالة السلة.
            page.locator('[data-custom-scent="vanilla"]').click()
            page.locator('[data-custom-oil="argan"]').click()
            for index in [0, 2]:
                page.locator('#products .size-option').nth(index).click()
                page.locator('[data-add-current]').click()
                page.locator('[data-cart-close]').click()
            page.locator('[data-cart-open]').first.click()
            check("تظهر خيارات العطر والزيت للاستفسار داخل السلة",
                  all(x in page.locator('[data-cart-custom-summary]').inner_text() for x in ['الطلب ككل','فانيلا','أرجان','نؤكد']))
            check("الأحجام الثلاثة = $37 قبل الخصم", page.locator('[data-cart-subtotal]').inner_text() == '$37')
            page.locator('[data-pay-select="shamcash"]').check()
            check("شام كاش حماة = $33.30", page.locator('[data-cart-total]').inner_text() == '$33.30')
            check("تقدير العبوة لا يُعرض كمجموع للسلة متعددة الأحجام",
                  page.locator('[data-estimate-total]').text_content() == '$13.50' and
                  'عبوة واحدة' in (page.locator('[data-order-estimate] h2').text_content() or '') and
                  page.locator('[data-cart-total]').inner_text() == '$33.30')
            page.locator('[data-zone-select="other"]').check()
            check("شام كاش المحافظات = $37.30", page.locator('[data-cart-total]').inner_text() == '$37.30')
            page.locator('[data-cart-checkout]').click()
            calls = page.evaluate('window.__waCalls')
            url = calls[-1] if calls else ''
            msg = parse_qs(urlparse(url).query).get('text', [''])[0]
            check("رابط الطلب للرقم الصحيح، دون إرسال", url.startswith('https://wa.me/963997310856?') and bool(msg))
            check("الرسالة تحمل الخيارات والمصدر والمجموع", all(x in msg for x in ['30 مل','50 مل','100 مل','فانيلا','أرجان','$37.30','— المصدر: serum-oct','— القناة: facebook','— نسخة المحتوى: moment']))
            check("الرسالة تطلب موعد تجهيز العبوة بدل افتراضه", 'تأكيد موعد تجهيز العبوة' in msg)
            check("الرابط البديل يظهر إذا تعذّر فتح النافذة", page.locator('[data-cart-fallback]').is_visible() and page.locator('[data-cart-fallback-link]').get_attribute('href') == url)
            events = page.evaluate("JSON.parse(sessionStorage.getItem('rawaa_events') || '[]').map(x => x.e)")
            check("زر واتساب يقيس النقرة فقط لا الشراء", 'InitiateCheckout' in events and 'Contact' in events and 'Purchase' not in events, str(events))
            page.locator('[data-cart-close]').click()
            page.goto(base + '/', wait_until='load')
            page.wait_for_selector('#products .size-option input')
            check("السلة والمصدر ينتقلان للرئيسية في التبويب نفسه", page.locator('[data-cart-count]').inner_text() == '3' and page.evaluate('window.rawaaSrcTag()') == 'serum-oct')
            check("لا أخطاء JavaScript", not errors, '; '.join(errors[:3]))
            check("لا استجابات فاشلة", not bad, '; '.join(bad[:3]))
            ctx.close()

        # رحلة من الرئيسية إلى صفحة المنتج، مع الحفاظ على مصدر الحملة والسلة.
        # خادم الملفات البسيط في CI لا يعرف رابط Cloudflare النظيف؛ نحاكي التحويل محليًا فقط.
        ctx = browser.new_context(viewport={"width":390,"height":844}, locale="ar",
                                  ignore_https_errors=ignore_https, service_workers='block')
        ctx.add_init_script("window.__waCalls = []; window.open = function(url) { window.__waCalls.push(url); return null; };")
        if path.endswith('.html') and urlparse(base).hostname in ('127.0.0.1', 'localhost'):
            ctx.route('**/serum', lambda route: route.continue_(url=base + path))
        page = ctx.new_page()
        page.goto(base + '/?utm_source=facebook&utm_medium=organic&utm_campaign=home_bridge&utm_content=finish', wait_until='load')
        check("الرئيسية تربط الحاجة بخطوة اختيار الحجم", all(x in page.locator('.hero-lead').inner_text() for x in ['الباهت','المتطاير']) and page.locator('[data-discover-serum]').get_attribute('href') == '/serum')
        with page.expect_navigation(wait_until='load'):
            page.locator('[data-discover-serum]').click()
        page.wait_for_selector('#products .size-option input')
        check("زر الرئيسية يفتح صفحة المنتج ويحفظ المصدر", urlparse(page.url).path == '/serum' and page.evaluate('window.rawaaSrcTag()') == 'home_bridge')
        page.locator('#products .size-option').nth(2).click()
        page.locator('[data-add-current]').click()
        check("100 مل من الرئيسية يصل للسلة بالسعر الصحيح", page.locator('#cart-dialog').evaluate('(d) => d.open') and page.locator('[data-cart-total]').inner_text() == '$13.50')
        page.locator('[data-cart-checkout]').click()
        calls = page.evaluate('window.__waCalls')
        msg = parse_qs(urlparse(calls[-1] if calls else '').query).get('text', [''])[0]
        check("مصدر الرئيسية والحجم ينتقلان لنص واتساب دون إرسال", all(x in msg for x in ['100 مل', '$13.50', '— المصدر: home_bridge', '— القناة: facebook', '— نسخة المحتوى: finish']))
        ctx.close()

        # اختبر كل الأحجام والمنطقتين وطريقتي الدفع ضد الإجمالي الفعلي للسلة.
        # سياق جديد حتى لا تغيّر هذه التجارب سلة الاختبارات الأخرى.
        ctx = browser.new_context(viewport={"width":390,"height":844}, locale="ar",
                                  reduced_motion="reduce", ignore_https_errors=ignore_https)
        page = ctx.new_page()
        page.goto(base + path + '?utm_campaign=estimate_test&utm_content=proof', wait_until='load')
        page.wait_for_selector('#products .size-option input')
        page.locator('.serum-estimate-details summary').click()
        audit(page, 'التقدير المفتوح')
        cases = [
            (0, '30 مل', {'hama': {'shamcash':'$9', 'cod':'$12'}, 'other': {'shamcash':'$13', 'cod':'$14'}}),
            (1, '50 مل', {'hama': {'shamcash':'$10.80', 'cod':'$14'}, 'other': {'shamcash':'$14.80', 'cod':'$16'}}),
            (2, '100 مل', {'hama': {'shamcash':'$13.50', 'cod':'$17'}, 'other': {'shamcash':'$17.50', 'cod':'$19'}})
        ]
        for index, size, zones in cases:
            page.locator('#products .size-option').nth(index).click()
            for zone, methods in zones.items():
                for method, expected in methods.items():
                    page.locator('[data-estimate-zone]').select_option(zone)
                    page.locator('[data-estimate-method]').select_option(method)
                    quote = page.locator('[data-estimate-total]').inner_text()
                    context = page.locator('[data-estimate-context]').inner_text()
                    page.locator('[data-add-current]').click()
                    total = page.locator('[data-cart-total]').inner_text()
                    radio_ok = page.locator(f'[data-zone-select="{zone}"]').is_checked() and page.locator(f'[data-pay-select="{method}"]').is_checked()
                    fallback = page.locator('[data-cart-fallback-link]').get_attribute('href') or ''
                    msg = parse_qs(urlparse(fallback).query).get('text', [''])[0]
                    check(f"تقدير {size} / {zone} / {method} يطابق السلة والرسالة",
                          quote == expected and total == expected and radio_ok and size in context and
                          expected in msg and '— المصدر: estimate_test' in msg and '— نسخة المحتوى: proof' in msg,
                          f"التقدير={quote} السلة={total} المتوقع={expected}")
                    page.locator('[data-remove-item]').click()
                    page.locator('[data-cart-close]').click()
        page.locator('.serum-estimate-details summary').click()
        check("كل تقديرات الحجم الفردي لا تضيف منتجات تلقائيًا", page.locator('[data-cart-count]').is_hidden())
        ctx.close()
        ctx = browser.new_context(viewport={"width":390,"height":844}, ignore_https_errors=ignore_https)
        page = ctx.new_page(); page.goto(base + path + '?offer=cod', wait_until='load')
        check("رابط عرض الاستلام يضبط التقدير الافتراضي بوضوح",
              page.locator('[data-estimate-method]').input_value() == 'cod' and
              page.locator('[data-estimate-total]').inner_text() == '$14' and
              'الدفع عند الاستلام' in page.locator('[data-estimate-context]').inner_text())
        ctx.close()

        # استعادة الاختيارات بين التحديث والتنقل، دون إرسال بيانات أو مشاركتها تلقائيًا.
        ctx = browser.new_context(viewport={"width":390,"height":844}, locale="ar",
                                  reduced_motion="reduce", ignore_https_errors=ignore_https)
        ctx.add_init_script("window.__waCalls = []; window.open = url => { window.__waCalls.push(url); return null; };")
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(base + path + '?utm_campaign=continuity&utm_content=detail', wait_until='load')
        page.locator('#products .size-option').nth(2).click()
        page.locator('.serum-estimate-details summary').click()
        page.locator('[data-estimate-zone]').select_option('other')
        page.locator('[data-estimate-method]').select_option('cod')
        page.locator('[data-custom-scent="vanilla"]').click()
        page.locator('[data-custom-oil="argan"]').click()
        selected_msg = parse_qs(urlparse(page.locator('[data-wa-selected]').get_attribute('href') or '').query).get('text', [''])[0]
        check("الاستفسار المباشر يعكس العطر والزيت المختارين دون إرسال",
              all(x in selected_msg for x in ['100 مل','$15','فانيلا','أرجان','تأكيد التوفّر']) and
              selected_msg.count('— المصدر: continuity') == 1 and not page.evaluate('window.__waCalls.length'))
        page.locator('[data-add-current]').click()
        check("قبل التحديث: 100 مل والاستلام للمحافظات = $19",
              page.locator('[data-cart-total]').inner_text() == '$19' and
              'باقي المحافظات' in page.locator('[data-cart-context]').inner_text())
        check("اسم زر السلة المقروء يتضمن عدد العناصر الظاهر",
              '1 في السلة' in (page.locator('.cart-trigger').get_attribute('aria-label') or ''))
        check("مراجعة العطر والإضافة للطلب ككل داخل السلة",
              all(x in page.locator('[data-cart-custom-summary]').inner_text() for x in ['الطلب ككل','فانيلا','أرجان','نؤكد']))
        share_url = page.evaluate('window.__RAWAA_TEST__.cartShareLink()')
        check("رابط المشاركة يقتصر على الأحجام والكميات",
              'serum-100x1' in share_url and all(x not in share_url for x in ['other','cod','vanilla','argan']) and
              'لا يشمل المنطقة' in page.locator('.cart-share-note').inner_text())
        page.locator('[data-cart-close]').click()
        page.reload(wait_until='load')
        check("بعد التحديث تبقى الخيارات والتقدير دون تغيير صامت",
              '$15' in page.locator('[data-price-live]').text_content() and
              page.locator('[data-estimate-total]').inner_text() == '$19' and
              page.locator('[data-estimate-zone]').input_value() == 'other' and
              page.locator('[data-estimate-method]').input_value() == 'cod' and
              page.locator('[data-custom-scent="vanilla"]').get_attribute('aria-pressed') == 'true' and
              page.locator('[data-custom-oil="argan"]').get_attribute('aria-pressed') == 'true')
        restored_msg = parse_qs(urlparse(page.locator('[data-wa-selected]').get_attribute('href') or '').query).get('text', [''])[0]
        check("الاستفسار المباشر يستعيد الاختيارات والمصدر مرة واحدة بعد التحديث",
              all(x in restored_msg for x in ['100 مل','$15','فانيلا','أرجان']) and restored_msg.count('— المصدر: continuity') == 1)
        stored = page.evaluate("JSON.parse(sessionStorage.getItem('rawaa:choices:v1'))")
        check("ذاكرة الجلسة تحفظ رموز الاختيارات فقط لا معلومات اتصال",
              set(stored) == {'size','zone','method','scent','oil'} and
              stored == {'size':'serum-100','zone':'other','method':'cod','scent':'vanilla','oil':'argan'} and
              page.evaluate("localStorage.getItem('rawaa:choices:v1')") is None, str(stored))
        page.locator('[data-cart-open]').first.click()
        draft = parse_qs(urlparse(page.locator('[data-cart-fallback-link]').get_attribute('href') or '').query).get('text', [''])[0]
        check("السلة والرسالة المعدّة تستعيدان السعر والاختيارات والمصدر",
              page.locator('[data-cart-total]').inner_text() == '$19' and
              all(x in draft for x in ['100 مل','$19','فانيلا','أرجان','باقي المحافظات','الدفع عند الاستلام','continuity','detail']))
        events = page.evaluate("JSON.parse(sessionStorage.getItem('rawaa_events') || '[]').map(x => x.e)")
        check("حفظ الاختيارات لا يفتح واتساب أو ينشئ طلبًا",
              not page.evaluate('window.__waCalls.length') and 'Contact' not in events and 'Purchase' not in events)
        page.locator('[data-cart-close]').click()
        shared = ctx.new_page(); shared.goto(share_url, wait_until='load')
        check("رابط المشاركة في تبويب مستقل لا يتضمن الخيارات الأخرى",
              shared.locator('[data-cart-count]').inner_text() == '1' and
              shared.locator('[data-estimate-zone]').input_value() == 'hama' and
              shared.locator('[data-estimate-method]').input_value() == 'shamcash' and
              shared.locator('[data-custom-scent="vanilla"]').get_attribute('aria-pressed') == 'false' and
              shared.locator('[data-custom-oil="argan"]').get_attribute('aria-pressed') == 'false')
        shared.close()
        page.goto(base + '/', wait_until='load')
        check("الخيارات تنتقل للرئيسية في التبويب نفسه",
              '$15' in page.locator('[data-price-live]').text_content() and
              page.locator('[data-custom-scent="vanilla"]').get_attribute('aria-pressed') == 'true' and
              page.locator('[data-custom-oil="argan"]').get_attribute('aria-pressed') == 'true')
        page.locator('[data-cart-open]').first.click()
        check("السلة في الرئيسية تحافظ على الإجمالي والمنطقة والدفع",
              page.locator('[data-cart-total]').inner_text() == '$19' and
              page.locator('[data-zone-select="other"]').is_checked() and page.locator('[data-pay-select="cod"]').is_checked())
        page.locator('[data-zone-select="hama"]').check()
        page.locator('[data-pay-select="shamcash"]').check()
        page.locator('[data-cart-close]').click()
        page.locator('[data-custom-scent="rose"]').click()
        page.locator('[data-custom-oil="almond"]').click()
        page.locator('#products .size-option').nth(0).click()
        page.locator('[data-add-current]').click()
        page.locator('[data-cart-open]').first.click()
        page.locator('[data-remove-item="serum-100"]').click()
        page.locator('[data-cart-close]').click()
        page.go_back(wait_until='load')
        page.wait_for_selector('#products .size-option input')
        check("العودة للمنتج تعكس أحدث اختيارات الحجم والعطر والزيت",
              '$10' in page.locator('[data-price-live]').text_content() and
              page.locator('[data-custom-scent="rose"]').get_attribute('aria-pressed') == 'true' and
              page.locator('[data-custom-oil="almond"]').get_attribute('aria-pressed') == 'true' and
              page.locator('[data-estimate-total]').inner_text() == '$9')
        page.locator('[data-cart-open]').first.click()
        check("العودة لا تعيد عنصرًا حُذف في الصفحة الأخرى",
              page.locator('[data-cart-count]').inner_text() == '1' and
              page.locator('[data-cart-item="serum-30"]').count() == 1 and
              page.locator('[data-cart-item="serum-100"]').count() == 0 and
              page.locator('[data-cart-total]').inner_text() == '$9')
        page.locator('[data-cart-close]').click()
        page.locator('[data-custom-scent="rose"]').click()
        page.locator('[data-custom-oil="almond"]').click()
        page.reload(wait_until='load')
        page.locator('[data-cart-open]').first.click()
        check("إلغاء العطر والإضافة يبقى ملغيًا بعد التحديث",
              page.locator('[data-custom-scent="rose"]').get_attribute('aria-pressed') == 'false' and
              page.locator('[data-custom-oil="almond"]').get_attribute('aria-pressed') == 'false' and
              page.locator('[data-cart-custom-summary]').is_hidden())
        page.locator('[data-cart-close]').click()
        page.evaluate("""() => sessionStorage.setItem('rawaa:choices:v1',
          JSON.stringify({size:'serum-999',zone:'bogus',method:'bogus',scent:'<img src=x onerror=alert(1)>',oil:{}}))""")
        page.goto(base + path, wait_until='load')
        check("الخيارات التالفة أو غير المعتمدة تُهمل دون حقن أو تعطل",
              '$12' in page.locator('[data-price-live]').text_content() and
              page.locator('[data-estimate-zone]').input_value() == 'hama' and
              page.locator('[data-estimate-method]').input_value() == 'shamcash' and
              page.locator('.chips [aria-pressed="true"]').count() == 0 and not errors, '; '.join(errors[:3]))
        ctx.close()

        # الرابط المشترك يدمج دون استبدال كميات سابقة، ولا يعيد صنفًا حُذف عند التحديث.
        ctx = browser.new_context(viewport={"width":390,"height":844}, locale="ar", ignore_https_errors=ignore_https)
        page = ctx.new_page(); page.goto(base + path, wait_until='load')
        page.evaluate("sessionStorage.setItem('rawaa:cart:v1', JSON.stringify({'serum-50':3}))")
        shared_path = base + path + '?cart=serum-50x1,serum-100x2&offer=cod'
        page.goto(shared_path, wait_until='load')
        page.locator('[data-cart-open]').first.click()
        check("رابط مشترك يحافظ على الكمية السابقة ويضيف الحجم الجديد مع توضيح الدمج",
              page.locator('[data-cart-count]').inner_text() == '5' and
              page.locator('[data-cart-item="serum-50"] [data-qty-value]').inner_text() == '3' and
              page.locator('[data-cart-item="serum-100"] [data-qty-value]').inner_text() == '2' and
              page.locator('[data-cart-shared-notice]').is_visible() and
              'تبقى الكميات الموجودة سابقًا' in page.locator('[data-cart-shared-notice]').inner_text())
        check("رابط العرض والسلة يعملان معًا", page.locator('[data-pay-select="cod"]').is_checked())
        page.locator('[data-remove-item="serum-100"]').click()
        page.locator('[data-pay-select="shamcash"]').check()
        page.reload(wait_until='load')
        page.locator('[data-cart-open]').first.click()
        check("تحديث الرابط لا يعيد الحجم المحذوف ولا يفرض العرض بعد تعديل الدفع",
              page.locator('[data-cart-item="serum-100"]').count() == 0 and
              page.locator('[data-cart-item="serum-50"] [data-qty-value]').inner_text() == '3' and
              page.locator('[data-pay-select="shamcash"]').is_checked())
        page.locator('[data-remove-item="serum-50"]').click()
        page.reload(wait_until='load')
        page.locator('[data-cart-open]').first.click()
        check("السلة المفرغة لا تمتلئ مجددًا عند تحديث الرابط نفسه",
              page.locator('[data-cart-empty]').is_visible() and page.locator('[data-cart-items] li').count() == 0)
        page.goto(base + path, wait_until='load')
        page.goto(shared_path, wait_until='load')
        page.locator('[data-cart-open]').first.click()
        check("فتح رابط مشترك من جديد يطبق أحجامه مرة جديدة",
              page.locator('[data-cart-item="serum-50"] [data-qty-value]').inner_text() == '1' and
              page.locator('[data-cart-item="serum-100"] [data-qty-value]').inner_text() == '2' and
              page.locator('[data-pay-select="cod"]').is_checked())
        ctx.close()

        # روابط العرض تُطبّق عند الوصول، ولا تعيد فرضها بعد تغيير الاختيار ثم التحديث.
        ctx = browser.new_context(viewport={"width":390,"height":844}, ignore_https_errors=ignore_https)
        page = ctx.new_page(); page.goto(base + path + '?offer=cod', wait_until='load')
        page.locator('.serum-estimate-details summary').click()
        page.locator('[data-estimate-method]').select_option('shamcash')
        page.reload(wait_until='load')
        check("اختيار الدفع اليدوي يبقى بعد تحديث رابط عرض الاستلام",
              page.locator('[data-estimate-method]').input_value() == 'shamcash' and page.locator('[data-estimate-total]').inner_text() == '$10.80')
        page.goto(base + path, wait_until='load')
        page.goto(base + path + '?offer=cod', wait_until='load')
        check("فتح رابط عرض جديد يختار الاستلام مجددًا",
              page.locator('[data-estimate-method]').input_value() == 'cod' and page.locator('[data-estimate-total]').inner_text() == '$14')
        page.goto(base + path + '?offer=invalid', wait_until='load')
        check("العرض غير الصالح لا يلغي الاختيار المحفوظ", page.locator('[data-estimate-method]').input_value() == 'cod')
        ctx.close()

        # إذا مُنع التخزين، يبقى الطلب قابلًا للاستعمال في الذاكرة دون أخطاء.
        ctx = browser.new_context(viewport={"width":390,"height":844}, ignore_https_errors=ignore_https)
        ctx.add_init_script("Object.defineProperty(window, 'sessionStorage', {get(){throw new DOMException('blocked','SecurityError')}})")
        page = ctx.new_page(); errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(base + path + '?offer=cod&utm_source=facebook&utm_campaign=demo%40example.invalid', wait_until='load')
        blocked_draft = parse_qs(urlparse(page.locator('[data-wa-selected]').get_attribute('href') or '').query).get('text', [''])[0]
        check("ترشيح المصدر يعمل حتى عند منع التخزين", 'demo@example.invalid' not in blocked_draft and '— المصدر: facebook' in blocked_draft)
        page.locator('[data-custom-scent="vanilla"]').click()
        page.locator('#products .size-option').nth(2).click()
        page.locator('[data-add-current]').click()
        check("عند منع التخزين تعمل السلة والاختيارات في الذاكرة",
              page.locator('[data-cart-total]').inner_text() == '$17' and
              'فانيلا' in page.locator('[data-cart-custom-summary]').inner_text() and not errors, '; '.join(errors[:3]))
        ctx.close()
        ctx = browser.new_context(viewport={"width":390,"height":844}, ignore_https_errors=ignore_https)
        ctx.add_init_script("Object.defineProperty(window, 'sessionStorage', {get(){throw new DOMException('blocked','SecurityError')}})")
        page = ctx.new_page(); page.goto(base + path + '?cart=serum-30x1', wait_until='load')
        page.locator('[data-cart-open]').first.click()
        check("رابط السلة المشترك يفتح حتى عند منع التخزين",
              page.locator('[data-cart-count]').inner_text() == '1' and page.locator('[data-cart-total]').inner_text() == '$9')
        ctx.close()

        # اختبر عجلة المستخدم الفعلية لا النقر الآلي الذي يمرّر overflow:hidden برمجيًا.
        for width, height in [(320,568), (320,640), (390,844), (844,390)]:
            ctx = browser.new_context(viewport={"width":width,"height":height}, locale="ar",
                                      reduced_motion="reduce", ignore_https_errors=ignore_https)
            ctx.add_init_script('window.open = () => null;')
            page = ctx.new_page(); page.goto(base + path, wait_until='load')
            page.locator('[data-add-current]').click()
            item = page.locator('.cart-item').bounding_box()
            head = page.locator('.cart-head').bounding_box()
            check(f"{width}×{height}: بند السلة ظاهر كاملًا عند الفتح",
                  bool(item and head and item['y'] >= head['y'] + head['height'] - 1 and item['y'] + item['height'] <= height))
            box = page.locator('#cart-dialog').bounding_box()
            page.mouse.move(box['x'] + box['width'] / 2, min(height * .45, 260))
            page.mouse.wheel(0, 2000)
            page.wait_for_timeout(250)
            scrolled = page.locator('.cart-inner').evaluate('(e) => e.scrollTop')
            share = page.locator('[data-cart-share]').bounding_box()
            foot = page.locator('.cart-foot').bounding_box()
            checkout = page.locator('[data-cart-checkout]').bounding_box()
            head = page.locator('.cart-head').bounding_box()
            # في الارتفاعات القصيرة لا يلزم بلوغ أسفل السلة تمامًا لإظهار المشاركة.
            if share and head and share['y'] < head['y'] + head['height']:
                page.mouse.wheel(0, -32)
                page.wait_for_timeout(180)
                share = page.locator('[data-cart-share]').bounding_box()
                foot = page.locator('.cart-foot').bounding_box()
                checkout = page.locator('[data-cart-checkout]').bounding_box()
                head = page.locator('.cart-head').bounding_box()
            check(f"{width}×{height}: عجلة التمرير تصل للمشاركة والملخص وزر واتساب",
                  bool(scrolled > 30 and share and foot and head and checkout and
                  share['y'] >= head['y'] + head['height'] - 2 and
                  share['y'] + share['height'] <= foot['y'] + 2 and
                  checkout['y'] >= 0 and checkout['y'] + checkout['height'] <= height + 2),
                  f"scroll={scrolled:.0f}")
            page.mouse.wheel(0, -500)
            page.wait_for_timeout(180)
            check(f"{width}×{height}: يمكن التمرير للأعلى والإغلاق يبقى ظاهرًا",
                  page.locator('.cart-inner').evaluate('(e) => e.scrollTop') < scrolled and
                  page.locator('[data-cart-close]').bounding_box()['y'] >= -1)
            page.locator('[data-cart-close]').click()
            check(f"{width}×{height}: الإغلاق يعيد التركيز لزر الإضافة",
                  page.evaluate("document.activeElement.hasAttribute('data-add-current')"))
            ctx.close()

        # تمرير لمس أصلي لمحرك Chromium؛ لا ندّعي أنه اختبار جهاز فعلي.
        if browser_name == 'chromium':
            ctx = browser.new_context(viewport={"width":320,"height":568}, is_mobile=True, has_touch=True,
                                      locale="ar", reduced_motion="reduce", ignore_https_errors=ignore_https)
            page = ctx.new_page(); page.goto(base + path, wait_until='load')
            page.locator('[data-add-current]').click()
            cdp = ctx.new_cdp_session(page)
            points = lambda y: [{'x':30, 'y':y, 'id':0, 'radiusX':2, 'radiusY':2, 'force':1}]
            cdp.send('Input.dispatchTouchEvent', {'type':'touchStart', 'touchPoints':points(275)})
            for y in [250,225,200,175,150,125,105]:
                cdp.send('Input.dispatchTouchEvent', {'type':'touchMove', 'touchPoints':points(y)})
                page.wait_for_timeout(30)
            cdp.send('Input.dispatchTouchEvent', {'type':'touchEnd', 'touchPoints':[]})
            page.wait_for_timeout(300)
            check("لمس Chromium المحاكى يمرّر محتوى السلة فعليًا",
                  page.locator('.cart-inner').evaluate('(e) => e.scrollTop') > 20)
            ctx.close()

        # لا تضيع بؤرة لوحة المفاتيح عند إعادة بناء الكمية أو المنطقة أو الدفع.
        ctx = browser.new_context(viewport={"width":320,"height":568}, locale="ar",
                                  reduced_motion="reduce", ignore_https_errors=ignore_https)
        ctx.add_init_script('window.open = () => null;')
        page = ctx.new_page(); page.goto(base + path, wait_until='load')
        page.locator('[data-add-current]').click()
        page.locator('[data-qty-increase]').focus(); page.keyboard.press('Enter')
        check("لوحة المفاتيح تحتفظ بالتركيز بعد تعديل الكمية",
              page.locator('[data-qty-value]').inner_text() == '2' and
              page.evaluate("document.activeElement.getAttribute('data-qty-increase')") == 'serum-50')
        page.locator('[data-zone-select="hama"]').focus(); page.keyboard.press('ArrowDown')
        check("لوحة المفاتيح تحتفظ بالتركيز بعد تغيير المنطقة",
              page.locator('[data-zone-select="other"]').is_checked() and
              page.evaluate("document.activeElement.getAttribute('data-zone-select')") == 'other')
        page.locator('[data-pay-select="shamcash"]').focus(); page.keyboard.press('ArrowDown')
        check("لوحة المفاتيح تحتفظ بالتركيز بعد تغيير الدفع",
              page.locator('[data-pay-select="cod"]').is_checked() and
              page.evaluate("document.activeElement.getAttribute('data-pay-select')") == 'cod')
        page.locator('[data-cart-checkout]').click(); page.keyboard.press('Tab')
        copy = page.locator('[data-cart-copy-number]').bounding_box()
        head = page.locator('.cart-head').bounding_box()
        foot = page.locator('.cart-foot').bounding_box()
        check("التركيز على رابط النسخ البديل غير محجوب بالتذييل الثابت",
              page.evaluate("document.activeElement.hasAttribute('data-cart-copy-number')") and
              bool(copy and head and foot and copy['y'] >= head['y'] + head['height'] - 2 and
                   copy['y'] + copy['height'] <= foot['y'] + 2))
        page.keyboard.press('Escape')
        check("Escape يغلق الحوار ويعيد التركيز للزر السابق",
              not page.locator('#cart-dialog').evaluate('(d) => d.open') and
              page.evaluate("document.activeElement.hasAttribute('data-add-current')"))
        ctx.close()

        # إعادة تدفق السلة وتركيز Tab المرئي عند ضيق الشاشة أو تكبير النص.
        for width, height, text_zoom in [(320,225,False), (320,568,False), (320,568,True),
                                         (844,390,False), (1440,900,False)]:
            ctx = browser.new_context(viewport={"width":width,"height":height}, locale="ar",
                                      reduced_motion="reduce", ignore_https_errors=ignore_https)
            page = ctx.new_page(); page.goto(base + path, wait_until='load')
            page.locator('[data-add-current]').click()
            if text_zoom:
                page.evaluate("document.documentElement.style.fontSize = '200%'")
                page.wait_for_timeout(250)  # ResizeObserver يعيد ضبط التذييل والحجم الفعلي.
                check("تكبير النص 200% يحوّل التذييل الطويل إلى تمرير عادي",
                      page.locator('.cart-foot').evaluate('(e) => getComputedStyle(e).position') == 'static')
            geometry = page.locator('.cart-inner').evaluate('(e) => ({width:e.clientWidth, scrollWidth:e.scrollWidth})')
            page.locator('[data-cart-close]').focus()
            obscured = []
            for _ in range(9):
                page.keyboard.press('Tab')
                page.wait_for_timeout(150)  # WebKit قد يحرّك العنصر تدريجيًا بعد التركيز.
                status = page.evaluate("""() => {
                  const e = document.activeElement, d = document.querySelector('#cart-dialog');
                  const r = e.getBoundingClientRect(), head = document.querySelector('.cart-head').getBoundingClientRect();
                  const foot = document.querySelector('.cart-foot'), f = foot.getBoundingClientRect();
                  const inHead = !!e.closest('.cart-head'), inFoot = !!e.closest('.cart-foot');
                  const visible = d.contains(e) && r.width > 0 && r.height > 0 && r.top >= -1 && r.bottom <= innerHeight + 1 &&
                    (inHead || r.top >= head.bottom - 1) &&
                    (getComputedStyle(foot).position !== 'sticky' || inFoot || r.bottom <= f.top + 1);
                  return {visible, label:e.getAttribute('aria-label') || e.textContent.trim().slice(0,30)};
                }""")
                if not status['visible']:
                    obscured.append(status['label'])
            label = f"{width}×{height}" + (" ونص 200%" if text_zoom else "")
            check(f"{label}: لا تمرير أفقي والتركيز المرئي يبقى داخل السلة",
                  geometry['scrollWidth'] <= geometry['width'] + 1 and not obscured, str(obscured[:3]))
            if text_zoom:
                page.evaluate("document.documentElement.style.fontSize = '100%'")
                page.wait_for_timeout(250)
                check("إعادة النص إلى حجمه تعيد تثبيت التذييل عندما تتسع الشاشة",
                      page.locator('.cart-foot').evaluate('(e) => getComputedStyle(e).position') == 'sticky')
            ctx.close()

        # القيم لا تُنشئ أسطرًا مزوّرة في الرسالة، وتبقى محدودة الطول.
        ctx = browser.new_context(viewport={"width":390,"height":844}, ignore_https_errors=ignore_https)
        page = ctx.new_page()
        page.goto(base + path + '?utm_campaign=launch%0Aforged&utm_content=scene%0Dextra', wait_until='load')
        note = page.evaluate('window.rawaaSourceNote()')
        check("رموز الحملة محدودة وآمنة من محارف التحكم", note.splitlines() == ['— المصدر: launch forged', '— نسخة المحتوى: scene extra'] and len(note) < 230, note)
        ctx.close()
        ctx = browser.new_context(viewport={"width":390,"height":844}, ignore_https_errors=ignore_https)
        page = ctx.new_page(); page.goto(base + path + '?utm_content=finish', wait_until='load')
        solo = parse_qs(urlparse(page.locator('[data-wa-direct]').first.get_attribute('href') or '').query).get('text', [''])[0]
        check("نسخة المحتوى تُرفق حتى دون اسم حملة", '— نسخة المحتوى: finish' in solo and '— المصدر:' not in solo)
        ctx.close()
        ctx = browser.new_context(viewport={"width":390,"height":844}, ignore_https_errors=ignore_https)
        page = ctx.new_page(); page.goto(base + path, wait_until='load')
        no_source = parse_qs(urlparse(page.locator('[data-wa-direct]').first.get_attribute('href') or '').query).get('text', [''])[0]
        check("زيارة بلا حملة لا تختلق مصدرًا", page.evaluate('window.rawaaSourceNote()') == '' and '— المصدر:' not in no_source and '— نسخة المحتوى:' not in no_source)
        ctx.close()

        # رموز حملات تجريبية فقط: لا تُرسل رسالة ولا يُفعّل قياس حقيقي.
        ctx = browser.new_context(viewport={"width":390,"height":844}, ignore_https_errors=ignore_https)
        page = ctx.new_page()
        q = urlencode({'utm_source':'facebook','utm_medium':'paid',
                       'utm_campaign':'demo@example.invalid','utm_content':'+963 999 111 222'})
        page.goto(base + path + '?' + q, wait_until='load')
        source = page.evaluate("JSON.parse(sessionStorage.getItem('rawaa_src') || '{}')")
        draft = parse_qs(urlparse(page.locator('[data-wa-selected]').get_attribute('href') or '').query).get('text', [''])[0]
        check("المصدر يتجاهل البريد ورقم الهاتف التجريبيين قبل الحفظ ورسالة واتساب",
              source == {'utm_source':'facebook', 'utm_medium':'paid'} and
              all(x not in draft for x in ['demo@example.invalid','+963 999 111 222']) and '— المصدر: facebook' in draft)
        page.evaluate("window.rawaaTrack('ViewContent', {})")
        log = page.evaluate("sessionStorage.getItem('rawaa_events') || ''")
        check("سجل الأحداث لا يكرر الرمز المستبعد", 'demo@example.invalid' not in log and '+963 999 111 222' not in log)
        ctx.close()

        ctx = browser.new_context(viewport={"width":390,"height":844}, ignore_https_errors=ignore_https)
        page = ctx.new_page()
        q = urlencode({'utm_campaign':'رواء-عناية-20261029','utm_content':'scene_1'})
        page.goto(base + path + '?' + q, wait_until='load')
        check("رمز عربي وتاريخ قصير صالحان يبقيان قابلين للإسناد",
              page.evaluate('window.rawaaSrcTag()') == 'رواء-عناية-20261029' and
              '— نسخة المحتوى: scene_1' in page.evaluate('window.rawaaSourceNote()'))
        page.goto(base + path + '?' + urlencode({'utm_campaign':'٠٩٩٧٣١٠٨٥٦','utm_content':'token=example'}), wait_until='load')
        check("رقم عربي أو سر معلَّم يزيلان المصدر القديم ولا ينشئان إسنادًا خاطئًا",
              page.evaluate('window.rawaaSourceNote()') == '' and page.evaluate("sessionStorage.getItem('rawaa_src')") is None)
        page.goto(base + path, wait_until='load')
        check("المصدر المستبعد لا يعود بعد التنقّل", page.evaluate('window.rawaaSourceNote()') == '')
        ctx.close()

        ctx = browser.new_context(viewport={"width":390,"height":844}, ignore_https_errors=ignore_https)
        page = ctx.new_page()
        q = urlencode({'utm_campaign':'x' * 513, 'utm_content':'demo%40example.invalid'})
        page.goto(base + path + '?' + q, wait_until='load')
        check("قيمة طويلة جدًا أو بريد مرمّز لا تُحفظ ولا تُرفق",
              page.evaluate("sessionStorage.getItem('rawaa_src')") is None and page.evaluate('window.rawaaSourceNote()') == '')
        ctx.close()

        ctx = browser.new_context(viewport={"width":390,"height":844}, ignore_https_errors=ignore_https)
        ctx.add_init_script("""sessionStorage.setItem('rawaa_src', JSON.stringify({utm_source:'facebook',utm_campaign:'demo@example.invalid'}));
          sessionStorage.setItem('rawaa_events', JSON.stringify([{e:'ViewContent',t:1,src:'+963 999 111 222'}]));""")
        page = ctx.new_page(); page.goto(base + path, wait_until='load')
        old_src = page.evaluate("sessionStorage.getItem('rawaa_src') || ''")
        old_log = page.evaluate("sessionStorage.getItem('rawaa_events') || ''")
        check("ترحيل جلسة قديمة ينقّي المصدر وسجل الأحداث قبل استعمالهما",
              'demo@example.invalid' not in old_src and '+963 999 111 222' not in old_log and 'facebook' in old_src)
        ctx.close()

        # مسار الصفحة النظيفة وصورة المشهد حتى بعد انقطاع الشبكة.
        # خادم CI البسيط لا ينفّذ تحويل /serum، لذا يُفحص ذلك على الخادم المهيأ والحي.
        if path == '/serum':
            ctx = browser.new_context(viewport={"width":390,"height":844}, device_scale_factor=3,
                                      locale="ar", ignore_https_errors=ignore_https)
            page = ctx.new_page()
            page.goto(base + '/?utm_campaign=offline_test&utm_content=finish', wait_until='load')
            controller = page.evaluate("""async () => {
              await navigator.serviceWorker.ready;
              if (navigator.serviceWorker.controller) return true;
              return new Promise(resolve => {
                navigator.serviceWorker.addEventListener('controllerchange', () => resolve(true), {once:true});
                setTimeout(() => resolve(false), 12000);
              });
            }""")
            cached = page.evaluate("""async () => !!(await caches.match('/serum')) &&
              !!(await caches.match('/assets/img/products/ritual-v5-480.avif'))""")
            check("عامل الخدمة يحفظ صفحة المنتج ومشهدًا صغيرًا", controller and cached)
            ctx.set_offline(True)
            with page.expect_navigation(wait_until='load'):
                page.locator('[data-discover-serum]').click()
            page.wait_for_selector('#products .size-option input')
            page.locator('#ritual img').scroll_into_view_if_needed()
            offline_image = page.locator('#ritual img').evaluate("""el => new Promise(resolve => {
              if (el.complete) return resolve(el.naturalWidth > 0);
              el.addEventListener('load', () => resolve(el.naturalWidth > 0), {once:true});
              el.addEventListener('error', () => resolve(false), {once:true});
              setTimeout(() => resolve(false), 12000);
            })""")
            check("المشهد وخيار الشراء يعملان بلا إنترنت", offline_image and page.locator('[data-add-current]').is_enabled() and '— نسخة المحتوى: finish' in page.evaluate('window.rawaaSourceNote()'))
            page.locator('[data-serum-control="sizes"]:visible').click()
            size_scene_offline = page.locator('[data-serum-view="sizes"] img').evaluate("""el => new Promise(resolve => {
              if (el.complete) return resolve(el.naturalWidth > 0);
              el.addEventListener('load', () => resolve(el.naturalWidth > 0), {once:true});
              el.addEventListener('error', () => resolve(false), {once:true});
              setTimeout(() => resolve(false), 12000);
            })""")
            check("معرض الأحجام يعمل لأول مرة بلا إنترنت بدقة شاشة عالية", size_scene_offline and
                  'لا يوضّح القياسات' in page.locator('[data-serum-caption]').inner_text())
            page.locator('#products .size-option').nth(0).click()
            bottle_offline = page.locator('[data-size-img]').evaluate("""el => new Promise(resolve => {
              if (el.complete) return resolve(el.naturalWidth > 0);
              el.addEventListener('load', () => resolve(el.naturalWidth > 0), {once:true});
              el.addEventListener('error', () => resolve(false), {once:true});
              setTimeout(() => resolve(false), 12000);
            })""")
            check("صورة 30 مل تتبع الاختيار وتعمل بلا إنترنت", bottle_offline and '30 مل' in (page.locator('[data-size-img]').get_attribute('alt') or ''))
            # استدعاء مقاسات لم تُحفظ بحالة مطابقة، لضمان الرجوع للنسخة الصغيرة المحفوظة.
            fallback_formats = page.evaluate("""async () => {
              const paths = [
                '/assets/img/products/trio-v6-1080.jpg',
                '/assets/img/products/size-30-v6-720.jpg',
                '/assets/img/products/size-100-v6-720.jpg',
                '/assets/img/products/size-100-v6-900.webp',
                '/assets/img/products/trio-v6-1080.avif'
              ];
              return Promise.all(paths.map(async (p) => {
                try { const r = await fetch(p + '?offline-probe=1'); return r.ok && (await r.arrayBuffer()).byteLength > 0; }
                catch { return false; }
              }));
            }""")
            check("بدائل JPG وWebP وAVIF للأحجام والمشهد تعمل بلا إنترنت", all(fallback_formats), str(fallback_formats))
            page.locator('#products .size-option').nth(1).click()
            check("تقدير العبوة يظهر بالقيم الصحيحة دون إنترنت", page.locator('[data-order-estimate]').is_visible() and page.locator('[data-estimate-total]').inner_text() == '$10.80')
            page.locator('#products .size-option').nth(2).click()
            page.locator('.serum-estimate-details summary').click()
            page.locator('[data-estimate-zone]').select_option('other')
            page.locator('[data-estimate-method]').select_option('cod')
            page.locator('[data-custom-scent="vanilla"]').click()
            page.locator('[data-add-current]').click()
            page.locator('[data-cart-close]').click()
            page.reload(wait_until='load')
            page.locator('[data-cart-open]').first.click()
            check("بلا إنترنت تبقى خيارات الطلب والسلة بعد التحديث",
                  page.locator('[data-cart-total]').inner_text() == '$19' and
                  page.locator('[data-custom-scent="vanilla"]').get_attribute('aria-pressed') == 'true' and
                  'فانيلا' in page.locator('[data-cart-custom-summary]').inner_text())
            ctx.close()

        # تكبير النص 200%: الترويسة وخيارات الأحجام والمشاهد لا تُقصّ أفقيًا.
        for zoom_path in ['/', path]:
            ctx = browser.new_context(viewport={"width":320,"height":844}, is_mobile=True, has_touch=True,
                                      locale="ar", ignore_https_errors=ignore_https)
            page = ctx.new_page(); page.goto(base + zoom_path, wait_until='load')
            page.wait_for_selector('#products .size-option input')
            page.add_style_tag(content='html { font-size: 200% !important; }')
            target_selector = ('.header-actions button, .price-strip li' if zoom_path == '/' else
                               '.header-actions button, #products .size-option, [data-serum-controls]:visible button')
            target_selector += ', .unit-comparison-list li, .purchase-shortcuts a'
            in_bounds = page.locator(target_selector).evaluate_all("""els => els.every(e => {
              const r = e.getBoundingClientRect();
              return r.width > 0 && r.left >= -1 && r.right <= innerWidth + 1 && e.scrollWidth <= e.clientWidth + 1;
            })""")
            check(f"{zoom_path}: تكبير النص 200% لا يقص الترويسة أو الاختيارات", in_bounds and
                  page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1') and
                  page.locator('.topbar-short').evaluate("e => getComputedStyle(e).whiteSpace === 'normal'"))
            if zoom_path == path:
                page.locator('[data-serum-control="ritual"]:visible').click()
                page.locator('[data-size-for="serum-100"]').click()
                page.locator('[data-add-current]').click()
                check("عند تكبير النص: تبديل المشهد والحجم وفتح السلة ممكن", page.locator('#cart-dialog').evaluate('(e) => e.open') and
                      '100 مل' in (page.locator('[data-size-img]').get_attribute('alt') or ''))
            ctx.close()

        # الإلغاء يزيل الخيارات من الاستفسار؛ رابط الشروط يبقى مستقلاً عنه.
        ctx = browser.new_context(viewport={"width":390,"height":844}, ignore_https_errors=ignore_https)
        ctx.add_init_script('window.__waCalls = []; window.open = url => { window.__waCalls.push(url); return null; };')
        page = ctx.new_page(); page.goto(base + path + '?utm_campaign=reset', wait_until='load')
        page.locator('[data-size-for="serum-30"]').click()
        page.locator('[data-custom-scent="vanilla"]').click()
        page.locator('[data-custom-oil="argan"]').click()
        page.locator('[data-custom-scent="vanilla"]').click()
        page.locator('[data-custom-oil="argan"]').click()
        cleared = parse_qs(urlparse(page.locator('[data-wa-selected]').get_attribute('href') or '').query).get('text', [''])[0]
        terms = parse_qs(urlparse(page.locator('#returns [data-wa-direct]').get_attribute('href') or '').query).get('text', [''])[0]
        check("إلغاء العطر والزيت يزيلهما من رسالة الحجم، ولا يرسل شيئًا",
              all(x in cleared for x in ['30 مل','$10']) and all(x not in cleared for x in ['فانيلا','أرجان']) and
              cleared.count('— المصدر: reset') == 1 and not page.evaluate('window.__waCalls.length'))
        check("رابط سؤال الإرجاع منفصل عن اختيار الحجم",
              'شروط الاستبدال والإرجاع' in terms and '30 مل' not in terms and terms.count('— المصدر: reset') == 1)
        ctx.close()

        # الرابط يفتح سؤال الإرجاع بلوحة المفاتيح، بلا اختلاق سياسة.
        ctx = browser.new_context(viewport={"width":320,"height":640}, locale="ar", ignore_https_errors=ignore_https)
        page = ctx.new_page(); page.goto(base + path, wait_until='load')
        return_link = page.locator('.purchase-shortcuts a[href="#returns"]')
        return_link.focus(); page.keyboard.press('Enter')
        check("اختصار الإرجاع يفتح السؤال بلوحة المفاتيح دون اختلاق سياسة",
              urlparse(page.url).fragment == 'returns' and page.locator('#returns').evaluate('(e) => e.open') and
              'الاستفسار عن الشروط على واتساب' in page.locator('#returns').inner_text())
        ctx.close()

        # تغيير الإعدادات أثناء الاختبار فقط يثبت أن الحاسبة ورابط السؤال لا يخمّنان السعر.
        ctx = browser.new_context(viewport={"width":390,"height":844}, ignore_https_errors=ignore_https)
        def mock_prices(route):
            response = route.fetch()
            code = response.text()
            marker = 'price: 10,'
            if marker not in code: raise RuntimeError('اختبار الحساب: لم نجد سعر 30 مل المرجعي')
            route.fulfill(response=response, body=code.replace(marker, 'price: 11,', 1))
        ctx.route('**/js/config.js', mock_prices)
        page = ctx.new_page(); page.goto(base + path, wait_until='load')
        page.locator('[data-size-for="serum-30"]').click()
        fake_msg = parse_qs(urlparse(page.locator('[data-wa-selected]').get_attribute('href') or '').query).get('text', [''])[0]
        check("تغيير سعر اختباري في الذاكرة يحدّث المقارنة والاستفسار من الإعدادات",
              page.locator('[data-unit-for="serum-30"] bdi').inner_text() == '$3.67' and
              '30 مل' in fake_msg and '$11' in fake_msg and page.locator('[data-size-for="serum-30"] .size-option-price').inner_text() == '$11')
        ctx.close()

        # لا JavaScript: أسعار حقيقية وزر واتساب يعمل، وزر السلة معطّل بدل وهم وظيفي.
        ctx = browser.new_context(java_script_enabled=False, ignore_https_errors=ignore_https, viewport={"width":390,"height":844})
        page = ctx.new_page(); page.goto(base + path, wait_until='load')
        check("بدون JavaScript: الأسعار وواتساب ظاهرة وزر السلة معطّل", all(s in page.locator('#products').inner_text() for s in ['$10','$12','$15']) and page.locator('[data-add-current]').is_disabled() and page.locator('[data-wa-direct]').first.is_visible())
        check("دون JavaScript: مقارنة الأحجام كاملة ورابط التخصيص بديل مباشر",
              [x.inner_text().replace('\n', ' ') for x in page.locator('[data-unit-comparison] li').all()] ==
              ['30 مل $3.33', '50 مل $2.40', '100 مل $1.50'] and
              page.locator('[data-wa-context]').is_visible() and 'قد تتضمن' in page.locator('[data-wa-context]').inner_text() and
              page.locator('#custom noscript a').count() == 1)
        page.locator('.purchase-shortcuts a[href="#returns"]').click()
        page.locator('#returns summary').click()
        check("دون JavaScript: رابط الإرجاع والأسئلة يعملان",
              urlparse(page.url).fragment == 'returns' and 'الاستفسار عن الشروط على واتساب' in page.locator('#returns').inner_text())
        check("بدون JavaScript: صورة العبوة والبيان ظاهران وأزرار المعرض مخفية",
              page.locator('[data-serum-view="bottle"]').is_visible() and
              'تصوّر تصميمي' in page.locator('[data-serum-caption]').inner_text() and
              page.locator('[data-serum-controls]:visible').count() == 0)
        check("دون JavaScript: لا مبلغ تقديري وهمي ويوجد بديل للاستفسار",
              page.locator('[data-estimate-interface]').is_hidden() and
              page.locator('[data-estimate-fallback]').is_visible() and
              'واتساب' in page.locator('[data-estimate-fallback]').inner_text())
        ctx.close()
        ctx = browser.new_context(java_script_enabled=False, ignore_https_errors=ignore_https, viewport={"width":390,"height":844})
        page = ctx.new_page(); page.goto(base + '/', wait_until='load')
        check("الرئيسية دون JavaScript تعرض المقارنة وبديل التخصيص",
              [x.inner_text().replace('\n', ' ') for x in page.locator('[data-unit-comparison] li').all()] ==
              ['30 مل $3.33', '50 مل $2.40', '100 مل $1.50'] and page.locator('#custom noscript a').count() == 1 and
              page.locator('#products [data-add-current]').is_disabled() and
              page.locator('#products noscript a[href^="https://wa.me/"]').count() >= 1)
        ctx.close()

        # فحص الموافقة على بكسل وهمي في الذاكرة فقط؛ كل طلب Meta يُعترض محليًا.
        ctx = browser.new_context(viewport={"width":390,"height":844}, ignore_https_errors=ignore_https)
        seen_meta: list[str] = []
        def mock_config(route):
            response = route.fetch()
            code = response.text()
            marker = "facebookPixelId: ''"
            if marker not in code: raise RuntimeError('اختبار الموافقة: لم نجد إعداد البكسل الفارغ')
            route.fulfill(response=response, body=code.replace(marker, "facebookPixelId: 'TEST-ONLY'", 1))
        def fake_meta(route):
            seen_meta.append(route.request.url)
            route.fulfill(status=200, content_type='application/javascript', body='/* intercepted locally */')
        ctx.route('**/js/config.js', mock_config)
        ctx.route('https://connect.facebook.net/**', fake_meta)
        page = ctx.new_page(); page.goto(base + path + '?' + urlencode({'utm_source':'facebook','utm_campaign':'demo@example.invalid'}), wait_until='load')
        check('عند تهيئة معرّف تجريبي: لا بكسل قبل الموافقة', page.locator('[data-consent-bar]').is_visible() and not seen_meta and not page.evaluate('!!window.fbq'))
        with page.expect_response('https://connect.facebook.net/**', timeout=10000):
            page.locator('[data-consent-bar] button').first.click()
        check('الموافقة تشغّل مكتبة تجريبية معترضة محليًا فقط', len(seen_meta) == 1 and page.evaluate('!!window.fbq') and page.locator('[data-consent-bar]').is_hidden(), f"طلبات={len(seen_meta)} fbq={page.evaluate('!!window.fbq')} مخفي={page.locator('[data-consent-bar]').is_hidden()}")
        page.evaluate("window.rawaaTrack('ViewContent', {})")
        queued = page.evaluate("JSON.stringify(window.fbq.queue || [])")
        check('بيانات الحدث التجريبي لا تتضمن البريد المستبعد', 'demo@example.invalid' not in queued)
        page.locator('[data-consent-settings]').click()
        with page.expect_navigation(wait_until='load'):
            page.locator('[data-consent-bar] button').nth(1).click()
        check('سحب الموافقة يوقف البكسل بعد إعادة التحميل', page.evaluate("localStorage.getItem('rawaa_tracking_consent')") == 'no' and not page.evaluate('!!window.fbq') and len(seen_meta) == 1, f"طلبات={len(seen_meta)} fbq={page.evaluate('!!window.fbq')}")
        ctx.close(); browser.close()
    failed = [x for x in checks if not x[1]]
    print(f"\nالنتيجة: {len(checks) - len(failed)} نجح · {len(failed)} فشل · {len(checks)} إجمالي")
    return 1 if failed else 0


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--base', default='http://127.0.0.1:8080')
    ap.add_argument('--path', default='/serum.html')
    ap.add_argument('--browser', choices=['chromium', 'webkit'], default='chromium')
    ap.add_argument('--ignore-https-errors', action='store_true')
    ap.add_argument('--screenshot-dir')
    args = ap.parse_args()
    sys.exit(run(args.base, args.path, args.browser, args.ignore_https_errors, args.screenshot_dir))
