#!/usr/bin/env python3
"""اختبار صفحة الإعلان: المتصفح، السلة، واتساب، مصدر الحملة وaxe.

لا تُرسل رسالة ولا تفتح واتساب: نستبدل window.open بجامع روابط محلي.
يمكن اختبار /serum على الموقع الحي أو /serum.html على خادم ملفات بسيط.
"""
from __future__ import annotations
import argparse
import json
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
AXE = (ROOT / "scripts/vendor/axe.min.js").read_text(encoding="utf-8")
checks: list[tuple[str, bool, str]] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    checks.append((name, bool(condition), detail))
    print(f"  {'✓' if condition else '✗'} {name}" + (f" — {detail}" if detail else ""))


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
            response = page.goto(base + path + "?utm_source=facebook&utm_medium=paid&utm_campaign=serum-oct", wait_until="load", timeout=45000)
            page.wait_for_selector('#products .size-option input')
            page.evaluate('document.fonts.ready')
            check("صفحة حقيقية HTTP 200", bool(response and response.status == 200), str(response.status if response else None))
            check("عنوان عربي واحد واتجاه RTL", page.locator('h1').count() == 1 and page.evaluate("getComputedStyle(document.body).direction") == 'rtl')
            check("الأحجام والأسعار من الإعدادات", page.locator('#products .size-option-size').all_inner_texts() == ['30 مل','50 مل','100 مل'] and page.locator('#products .size-option-price').all_inner_texts() == ['$10','$12','$15'])
            check("شارة 50 مل مطابقة لتوجيه المالك", page.locator('[data-size-for="serum-50"] .size-option-flag').inner_text() == 'الأنسب للاستعمال اليومي')
            check("لا تمرير أفقي", page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'))
            check("الصورة توضيحية وليست صورة منتج", 'ليست صورة للمنتج الفعلي' in (page.locator('[data-size-img]').get_attribute('alt') or '') and 'ليس صورة العبوة الفعلية' in page.locator('.serum-photo figcaption').inner_text())
            check("المكوّنات غير مكتملة ولا نِسب فيها", 'البانثينول' in page.locator('#ingredients').inner_text() and 'ليست القائمة الكاملة' in page.locator('#ingredients').inner_text() and '%' not in page.locator('#ingredients').inner_text())
            check("المصدر محفوظ في الجلسة", page.evaluate('window.rawaaSrcTag()') == 'serum-oct')
            direct = page.locator('[data-wa-direct]').first.get_attribute('href') or ''
            direct_msg = parse_qs(urlparse(direct).query).get('text', [''])[0]
            check("المصدر في رابط واتساب المباشر", '— المصدر: serum-oct' in direct_msg)
            check("لا بكسل مفعّل بلا معرّف", not page.evaluate('!!window.fbq') and page.locator('[data-consent-bar]').is_hidden())
            if screenshot_dir and width == 390:
                Path(screenshot_dir).mkdir(parents=True, exist_ok=True)
                page.screenshot(path=str(Path(screenshot_dir) / f'serum-{browser_name}-390.png'), full_page=False)
            audit(page, 'الصفحة')

            # إضافة الحجم الافتراضي تفتح السلة؛ لا يُحسب فتحها محادثة.
            page.locator('[data-add-current]').click()
            dialog = page.locator('#cart-dialog')
            check("الزر يضيف ويفتح السلة", dialog.evaluate('(d) => d.open') and page.locator('[data-cart-count]').inner_text() == '1')
            ev = page.evaluate("JSON.parse(sessionStorage.getItem('rawaa_events') || '[]').map(x => x.e)")
            check("فتح السلة ليس Contact أو طلبًا مكتملًا", 'Contact' not in ev and 'InitiateCheckout' not in ev and 'Purchase' not in ev, str(ev))
            check("50 مل + شام كاش حماة = $10.80", page.locator('[data-cart-subtotal]').inner_text() == '$12' and page.locator('[data-cart-total]').inner_text() == '$10.80' and page.locator('[data-cart-delivery]').inner_text() == 'مجاني')
            page.locator('[data-zone-select="other"]').check()
            check("50 مل + شام كاش المحافظات = $14.80", page.locator('[data-cart-total]').inner_text() == '$14.80')
            page.locator('[data-pay-select="cod"]').check()
            check("50 مل + استلام المحافظات = $16", page.locator('[data-cart-total]').inner_text() == '$16')
            page.locator('[data-zone-select="hama"]').check()
            check("50 مل + استلام حماة = $14", page.locator('[data-cart-total]').inner_text() == '$14')
            audit(page, 'السلة المفتوحة')
            page.locator('[data-cart-close]').click()

            # الخيارات للاستفسار فقط، وتُرفق برسالة السلة.
            page.locator('[data-custom-scent="vanilla"]').click()
            page.locator('[data-custom-oil="argan"]').click()
            for index in [0, 2]:
                page.locator('#products .size-option').nth(index).click()
                page.locator('[data-add-current]').click()
                page.locator('[data-cart-close]').click()
            page.locator('[data-cart-open]').first.click()
            check("الأحجام الثلاثة = $37 قبل الخصم", page.locator('[data-cart-subtotal]').inner_text() == '$37')
            page.locator('[data-pay-select="shamcash"]').check()
            check("شام كاش حماة = $33.30", page.locator('[data-cart-total]').inner_text() == '$33.30')
            page.locator('[data-zone-select="other"]').check()
            check("شام كاش المحافظات = $37.30", page.locator('[data-cart-total]').inner_text() == '$37.30')
            page.locator('[data-cart-checkout]').click()
            calls = page.evaluate('window.__waCalls')
            url = calls[-1] if calls else ''
            msg = parse_qs(urlparse(url).query).get('text', [''])[0]
            check("رابط الطلب للرقم الصحيح، دون إرسال", url.startswith('https://wa.me/963997310856?') and bool(msg))
            check("الرسالة تحمل الخيارات والمصدر والمجموع", all(x in msg for x in ['30 مل','50 مل','100 مل','فانيلا','أرجان','$37.30','— المصدر: serum-oct']))
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

        # لا JavaScript: أسعار حقيقية وزر واتساب يعمل، وزر السلة معطّل بدل وهم وظيفي.
        ctx = browser.new_context(java_script_enabled=False, ignore_https_errors=ignore_https, viewport={"width":390,"height":844})
        page = ctx.new_page(); page.goto(base + path, wait_until='load')
        check("بدون JavaScript: الأسعار وواتساب ظاهرة وزر السلة معطّل", all(s in page.locator('#products').inner_text() for s in ['$10','$12','$15']) and page.locator('[data-add-current]').is_disabled() and page.locator('[data-wa-direct]').is_visible())
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
        page = ctx.new_page(); page.goto(base + path, wait_until='load')
        check('عند تهيئة معرّف تجريبي: لا بكسل قبل الموافقة', page.locator('[data-consent-bar]').is_visible() and not seen_meta and not page.evaluate('!!window.fbq'))
        with page.expect_response('https://connect.facebook.net/**', timeout=10000):
            page.locator('[data-consent-bar] button').first.click()
        check('الموافقة تشغّل مكتبة تجريبية معترضة محليًا فقط', len(seen_meta) == 1 and page.evaluate('!!window.fbq') and page.locator('[data-consent-bar]').is_hidden(), f"طلبات={len(seen_meta)} fbq={page.evaluate('!!window.fbq')} مخفي={page.locator('[data-consent-bar]').is_hidden()}")
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
