#!/usr/bin/env python3
"""
RAWAA — تدقيق إتاحة فعلي مع axe-core (WCAG 2.1 AA) + قياس وزن الصفحة.

يتطلب: axe-core (npm i axe-core) — يُحمَّل محليًا فقط، لا يُنشر مع الموقع.
الاستخدام: python3 scripts/a11y-audit.py [--base http://127.0.0.1:8080]
"""
import argparse
import json
import sys
import os
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
def _find_axe():
    """يبحث عن axe.min.js في المواضع المعتادة: محليًا وفي CI."""
    candidates = [
        os.environ.get("AXE_PATH"),
        "/tmp/node_modules/axe-core/axe.min.js",
        str(Path.cwd() / "node_modules/axe-core/axe.min.js"),
        str(Path(__file__).resolve().parent.parent / "node_modules/axe-core/axe.min.js"),
        "/usr/lib/node_modules/axe-core/axe.min.js",
        "/usr/local/lib/node_modules/axe-core/axe.min.js",
    ]
    for c in candidates:
        if c and Path(c).is_file():
            return Path(c)
    return None


AXE = _find_axe()
OUT = ROOT / "docs" / "a11y-report.json"


def run(base: str) -> int:
    if not AXE.exists():
        print("! axe-core غير مثبّت: npm install axe-core (في /tmp)")
        return 2

    axe_src = AXE.read_text(encoding="utf-8")
    findings = {}
    weights = {}

    with sync_playwright() as p:
        browser = p.chromium.launch()

        for label, width, height, mobile in [
            ("iPhone SE", 320, 640, True),
            ("iPhone 14", 390, 844, True),
            ("iPad", 768, 1024, True),
            ("سطح المكتب", 1440, 900, False),
        ]:
            ctx = browser.new_context(
                viewport={"width": width, "height": height},
                is_mobile=mobile, has_touch=mobile, locale="ar",
                reduced_motion="no-preference",
            )
            page = ctx.new_page()

            # قياس الوزن الفعلي للتحميل الأول
            transfer = {"total": 0, "by_type": {}}
            page.on("response", lambda r: _account(r, transfer))

            page.goto(base + "/index.html", wait_until="load")
            page.wait_for_selector("#products [data-add-current]")
            page.evaluate("document.fonts.ready")
            page.wait_for_timeout(900)

            weights[label] = {
                "requests": len(transfer["by_type"]),
                "total_kb": round(transfer["total"] / 1024, 1),
                "by_type_kb": {k: round(v / 1024, 1) for k, v in transfer["by_type"].items()},
            }

            page.add_script_tag(content=axe_src)
            result = page.evaluate(
                """async () => {
                    const r = await axe.run(document, {
                      runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21a','wcag21aa','best-practice'] }
                    });
                    return {
                      violations: r.violations.map(v => ({
                        id: v.id, impact: v.impact, help: v.help,
                        nodes: v.nodes.length,
                        targets: v.nodes.slice(0, 3).map(n => n.target.join(' '))
                      })),
                      passes: r.passes.length,
                      incomplete: r.incomplete.map(i => i.id)
                    };
                }"""
            )
            findings[label] = result

            # نافذة السلة مفتوحة أيضًا
            page.locator("#products .size-option").nth(1).click()
            page.wait_for_timeout(120)
            page.locator("#products [data-add-current]").click()
            page.locator("[data-cart-open]").first.click()
            page.wait_for_timeout(350)
            cart_result = page.evaluate(
                """async () => {
                    const r = await axe.run(document.getElementById('cart-dialog'), {
                      runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21a','wcag21aa','best-practice'] }
                    });
                    return r.violations.map(v => ({
                      id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length,
                      targets: v.nodes.slice(0,3).map(n => n.target.join(' '))
                    }));
                }"""
            )
            findings[label + " — السلة مفتوحة"] = {"violations": cart_result, "passes": 0, "incomplete": []}
            ctx.close()

        browser.close()

    # التقرير
    print("\n" + "=" * 62)
    print("تدقيق الإتاحة (axe-core · WCAG 2.1 AA + best-practice)")
    print("=" * 62)
    total_violations = 0
    for label, data in findings.items():
        v = data["violations"]
        total_violations += len(v)
        status = "✓ نظيف" if not v else f"✗ {len(v)} مخالفة"
        print(f"\n▸ {label}: {status} · عناصر ناجحة: {data['passes']}")
        for item in v:
            print(f"   ✗ [{item['impact']}] {item['id']} — {item['help']}")
            print(f"      عدد العناصر: {item['nodes']} · أمثلة: {item['targets']}")

    print("\n" + "=" * 62)
    print("وزن الصفحة الفعلي (تحميل أول)")
    print("=" * 62)
    for label, w in weights.items():
        print(f"\n▸ {label}: {w['total_kb']} KB · {w['requests']} طلب")
        for k, v in sorted(w["by_type_kb"].items(), key=lambda x: -x[1]):
            print(f"   {k:12s} {v:8.1f} KB")

    OUT.write_text(json.dumps({
        "violations_total": total_violations,
        "viewports": findings,
        "weights": weights,
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nالتقرير الكامل: {OUT}")
    print(f"\nالإجمالي: {total_violations} مخالفة إتاحة")
    return 0 if total_violations == 0 else 1


def _account(response, transfer):
    try:
        rtype = response.request.resource_type
        body_len = response.header_value("content-length")
        size = int(body_len) if body_len else 0
        transfer["total"] += size
        transfer["by_type"][rtype] = transfer["by_type"].get(rtype, 0) + size
    except Exception:
        pass


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8080")
    sys.exit(run(ap.parse_args().base))
