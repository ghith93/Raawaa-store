#!/usr/bin/env python3
"""
RAWAA — تدقيق إمكانية الوصول بـ axe-core (المعيار الصناعي، MPL-2.0).

يختلف عن a11y-audit.py القديم: هذا يستخدم axe-core نفسها التي تستخدمها
Google وMicrosoft، ويفحص WCAG 2.0/2.1/2.2 مستوى A وAA.

الاستخدام:
    python3 scripts/axe-audit.py                      # على الموقع الحي
    python3 scripts/axe-audit.py --base http://...    # على نسخة محلية
    python3 scripts/axe-audit.py --fail-on serious    # عتبة الفشل
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

AXE = (Path(__file__).parent / "vendor" / "axe.min.js").read_text(encoding="utf-8")

PAGES = ["/", "/privacy.html", "/404.html"]
SEVERITY = {"critical": 3, "serious": 2, "moderate": 1, "minor": 0}


def audit(base: str, threshold: str, viewport: tuple[int, int]) -> int:
    limit = SEVERITY[threshold]
    total_fail = 0
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": viewport[0], "height": viewport[1]},
                                  locale="ar")
        for path in PAGES:
            page = ctx.new_page()
            try:
                page.goto(base.rstrip("/") + path, wait_until="load", timeout=45000)
                page.wait_for_timeout(900)
                page.add_script_tag(content=AXE)
                res = page.evaluate("""async () => {
                    const r = await axe.run(document, {
                      runOnly: { type: 'tag',
                        values: ['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa','best-practice'] }
                    });
                    return r.violations.map(v => ({
                      id: v.id, impact: v.impact, help: v.help,
                      count: v.nodes.length,
                      nodes: v.nodes.slice(0,3).map(n => n.target.join(' '))
                    }));
                }""")
                blocking = [v for v in res if SEVERITY.get(v["impact"], 0) >= limit]
                mark = "✓" if not blocking else "✗"
                print(f"  {mark} {path:16} {len(res)} مخالفة · {len(blocking)} تتجاوز العتبة")
                for v in blocking:
                    print(f"      [{v['impact']}] {v['id']} — {v['count']} عنصر")
                    for n in v["nodes"]:
                        print(f"          {n[:90]}")
                total_fail += len(blocking)
            except Exception as e:
                print(f"  ✗ {path:16} خطأ: {type(e).__name__}: {str(e)[:80]}")
                total_fail += 1
            finally:
                page.close()
        browser.close()
    return total_fail


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="https://raawaa-store.pages.dev")
    ap.add_argument("--fail-on", default="serious", choices=list(SEVERITY))
    ap.add_argument("--viewport", default="390x844",
                    help="العرض×الارتفاع، مثل 390x844 (هاتف) أو 1280x800 (سطح مكتب)")
    a = ap.parse_args()
    w, h = (int(x) for x in a.viewport.split("x"))

    print(f"═══ تدقيق axe-core · {a.base} · {w}×{h} · عتبة: {a.fail_on} ═══")
    fails = audit(a.base, a.fail_on, (w, h))
    print()
    if fails:
        print(f"النتيجة: {fails} مخالفة تتجاوز العتبة")
        return 1
    print("النتيجة: لا مخالفات تتجاوز العتبة ✓")
    return 0


if __name__ == "__main__":
    sys.exit(main())
