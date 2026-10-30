#!/usr/bin/env python3
"""اختبار رحلة صفحة الهبوط للحملات على Chromium أو WebKit؛ لا يرسل أي رسالة."""
from __future__ import annotations
import argparse
import json
import os
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
AXE = (ROOT / "scripts/vendor/axe.min.js").read_text(encoding="utf-8")
checks: list[tuple[str, bool, str]] = []


def report_exception(exc_type, value, traceback):
    if os.environ.get('GITHUB_ACTIONS') == 'true':
        frame = traceback
        location = 'unknown'
        while frame:
            if Path(frame.tb_frame.f_code.co_filename).name == 'campaign-browser-test.py':
                location = f'campaign-browser-test.py:{frame.tb_lineno}'
            frame = frame.tb_next
        print(f'::error::Campaign browser test raised {exc_type.__name__} ({location})', flush=True)
    sys.__excepthook__(exc_type, value, traceback)


sys.excepthook = report_exception


def check(name: str, condition: bool, detail: str = "") -> None:
    checks.append((name, bool(condition), detail))
    print(f"  {'✓' if condition else '✗'} {name}" + (f" — {detail}" if detail else ""))
    if not condition and os.environ.get('GITHUB_ACTIONS') == 'true':
        print(f'::error::{name}', flush=True)


def run(base: str, browser_name: str, ignore_https: bool) -> int:
    base = base.rstrip('/')
    same_origin = urlparse(base).netloc
    with sync_playwright() as p:
        browser = getattr(p, browser_name).launch()
        for width, height in [(320, 640), (390, 844), (768, 1024), (1440, 900)]:
            print(f"\n{browser_name} · حملة رواء · {width}×{height}")
            ctx = browser.new_context(viewport={"width": width, "height": height},
                                      is_mobile=width < 600, has_touch=width < 600,
                                      locale='ar', reduced_motion='reduce',
                                      ignore_https_errors=ignore_https)
            page = ctx.new_page()
            errors: list[str] = []
            failures: list[str] = []
            external: list[str] = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
            page.on('response', lambda r: failures.append(f'{r.status} {r.url}') if r.status >= 400 else None)
            page.on('request', lambda r: external.append(r.url) if urlparse(r.url).netloc != same_origin else None)
            response = page.goto(base + '/campaign.html?utm_source=facebook&utm_medium=organic&utm_campaign=pilot_14day&utm_content=reference_prices', wait_until='load', timeout=45000)
            page.wait_for_selector('.campaign-product-card', timeout=10000)
            page.evaluate('document.fonts.ready')
            check('صفحة الهبوط تفتح بنجاح', bool(response and response.status == 200))
            check('عنوان عربي واحد واتجاه RTL', page.locator('h1').count() == 1 and page.evaluate("getComputedStyle(document.body).direction") == 'rtl')
            check('نسخة المحتوى تختار زاوية الأسعار من UTM', page.locator('html').get_attribute('data-campaign-angle') == 'reference_prices' and 'قارني الأحجام' in page.locator('h1').inner_text())
            check('ثلاثة أسعار تطابق config.js', page.locator('.campaign-product-price').all_inner_texts() == ['$19', '$26', '$29'])
            check('روابط المنتج تحمل وسوم الحملة المسموح بها', all(
                all(value in (link.get_attribute('href') or '') for value in ['utm_source=facebook','utm_medium=organic','utm_campaign=pilot_14day','utm_content=reference_prices'])
                for link in page.locator('.campaign-product-card a').all()))
            hero = page.locator('.campaign-hero-visual img')
            check('صورة العبوة المحورية محمّلة ومفصح عنها كتصور', hero.evaluate('(img) => img.complete && img.naturalWidth > 0') and 'ليست صورة للعبوات الفعلية' in hero.get_attribute('alt') and 'تصور تصميمي' in page.locator('.campaign-hero-visual figcaption').inner_text())
            editorial = page.locator('.campaign-editorial-image img')
            check('المشهد التحريري يحمل وصفًا يمنع ادعاء نتيجة', editorial.evaluate('(img) => img.complete && img.naturalWidth > 0') and 'مولّد' in page.locator('.campaign-editorial-image figcaption').inner_text())
            check('الدفع والتوصيل مأخوذان من الإعدادات', all(s in page.locator('[data-campaign-delivery]').inner_text() for s in ['شام كاش','$2','$4','الدفع عند الاستلام']))
            wa = page.locator('[data-campaign-whatsapp]').get_attribute('href') or ''
            message = parse_qs(urlparse(wa).query).get('text', [''])[0]
            check('رابط واتساب يحمل مصدر الحملة ولا يرسل تلقائيًا', 'wa.me/' in wa and 'المصدر: pilot_14day' in message and 'نسخة المحتوى: reference_prices' in message and not page.evaluate('window.__waCalls?.length'))
            check('لا بكسل أو اتصال بخدمة تحليل خارجية', not page.evaluate('!!window.fbq') and not any('facebook.net' in u for u in external))
            check('لا تمرير أفقي على هذا العرض', page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), str(page.evaluate('({scroll:document.documentElement.scrollWidth,width:innerWidth})')))
            page.add_script_tag(content=AXE)
            violations = page.evaluate("""async () => (await axe.run(document, {
              runOnly: {type:'tag', values:['wcag2a','wcag2aa','wcag21a','wcag21aa','best-practice']}
            })).violations.map(v => `${v.impact}:${v.id}:${v.nodes.length}`)""")
            check('axe: لا مخالفات إتاحة', not violations, json.dumps(violations, ensure_ascii=False))
            check('لا أخطاء JavaScript ولا طلبات ملفات فاشلة', not errors and not failures,
                  json.dumps({'errors':errors[:2],'failed':failures[:2]}, ensure_ascii=False))
            ctx.close()
        browser.close()
    failed = [item for item in checks if not item[1]]
    print(f"\nالنتيجة: {len(checks)-len(failed)} نجح · {len(failed)} فشل · {len(checks)} إجمالي")
    return 1 if failed else 0


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--base', default='http://127.0.0.1:8080')
    ap.add_argument('--browser', choices=['chromium','webkit'], default='chromium')
    ap.add_argument('--ignore-https-errors', action='store_true')
    args = ap.parse_args()
    sys.exit(run(args.base, args.browser, args.ignore_https_errors))
