#!/usr/bin/env python3
"""RAWAA — فحص متصفح مستقل للصفحة الرئيسية الجديدة.

يفحص الصفحة التسويقية فقط. اختبارات السلة والشراء موجودة في
scripts/serum-browser-test.py لأنها تعمل على /serum.
"""
from __future__ import annotations
import argparse
import sys
from playwright.sync_api import sync_playwright


def run(base: str) -> int:
    base = base.rstrip("/")
    failures: list[str] = []
    passed = 0

    def check(label: str, ok: bool, detail: str = "") -> None:
        nonlocal passed
        if ok:
            passed += 1
            print(f"✓ {label}")
        else:
            failures.append(label)
            print(f"✗ {label}" + (f" — {detail}" if detail else ""))

    with sync_playwright() as p:
        browser = p.chromium.launch()
        for width, height in [(320, 720), (390, 844), (1440, 900)]:
            context = browser.new_context(viewport={"width": width, "height": height},
                                          is_mobile=width < 600, has_touch=width < 600,
                                          locale="ar", reduced_motion="reduce")
            page = context.new_page()
            errors: list[str] = []
            bad: list[str] = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            page.on("response", lambda r: bad.append(f"{r.status} {r.url}") if r.status >= 400 else None)
            response = page.goto(base + "/", wait_until="load", timeout=45000)
            page.evaluate("document.fonts.ready")
            check(f"{width}px: HTTP 200", bool(response and response.status == 200))
            check(f"{width}px: RTL وعنوان رئيسي واحد",
                  page.evaluate("document.documentElement.lang === 'ar' && document.documentElement.dir === 'rtl'") and
                  page.locator("h1").count() == 1)
            check(f"{width}px: الشعار الرسمي محمّل",
                  page.locator(".brand-logo").count() == 1 and
                  page.locator(".brand-logo").evaluate("(img) => img.complete && img.naturalWidth > 0"))
            check(f"{width}px: صورة المنتج الرئيسية محمّلة",
                  page.locator(".visual-panel img").evaluate("(img) => img.complete && img.naturalWidth > 0"))
            check(f"{width}px: ثلاثة أحجام معروضة",
                  page.locator(".product-card").count() == 3)
            check(f"{width}px: زر الانتقال لصفحة المنتج",
                  page.locator("[data-discover-serum]").first.get_attribute("href") == "/serum")
            check(f"{width}px: لا تمرير أفقي",
                  page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"))
            check(f"{width}px: الروابط الخارجية آمنة",
                  page.locator('a[target="_blank"]').evaluate_all(
                      "els => els.every(a => /noopener/.test(a.rel) && /noreferrer/.test(a.rel))"))
            if width < 600:
                toggle = page.locator("#navToggle")
                toggle.click()
                check(f"{width}px: قائمة الهاتف تفتح", page.locator("#mobileNav").is_visible())
                toggle.click()
                check(f"{width}px: قائمة الهاتف تغلق", page.locator("#mobileNav").is_hidden())
            check(f"{width}px: لا أخطاء JavaScript", not errors, "; ".join(errors[:3]))
            check(f"{width}px: لا استجابات فاشلة", not bad, "; ".join(bad[:3]))
            context.close()
        browser.close()

    print(f"\nالنتيجة: {passed} نجح · {len(failures)} فشل")
    return 1 if failures else 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:8080")
    args = parser.parse_args()
    sys.exit(run(args.base))
