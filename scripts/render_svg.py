#!/usr/bin/env python3
"""
RAWAA — تحويل SVG إلى PNG عالي الدقة (Playwright/Chromium، بلا خدمات خارجية).
الاستخدام:
  python3 scripts/render_svg.py in.svg out.png [--width 1200] [--scale 2] [--bg '#FBF8F3']
"""
import argparse, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

def render(src: Path, out: Path, width: int, scale: float, bg: str | None, pad: int = 0):
    out.parent.mkdir(parents=True, exist_ok=True)
    html = f"""<!doctype html><html><head><meta charset="utf-8">
<style>
  html,body{{margin:0;padding:{pad}px;background:{bg or 'transparent'};}}
  img{{display:block;width:{width}px;height:auto;}}
</style></head><body>
<img src="{src.as_uri()}" id="a">
</body></html>"""
    tmp = out.with_suffix(".html")
    tmp.write_text(html, encoding="utf-8")
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_context(viewport={"width": width + pad*2, "height": 800},
                           device_scale_factor=scale).new_page()
        pg.goto(tmp.as_uri())
        pg.wait_for_load_state("load")
        pg.wait_for_function("document.getElementById('a').complete")
        pg.wait_for_timeout(120)
        el = pg.query_selector("#a")
        el.screenshot(path=str(out), omit_background=(bg is None))
        b.close()
    tmp.unlink(missing_ok=True)
    return out

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("srcs", nargs="+")
    ap.add_argument("--outdir", default=None)
    ap.add_argument("--width", type=int, default=1200)
    ap.add_argument("--scale", type=float, default=2)
    ap.add_argument("--bg", default=None)
    ap.add_argument("--pad", type=int, default=0)
    a = ap.parse_args()
    for s in a.srcs:
        src = Path(s).resolve()
        outdir = (Path(a.outdir) if a.outdir else src.parent).resolve()
        render(src, outdir / (src.stem + ".png"), a.width, a.scale, a.bg, a.pad)
        print("rendered", outdir / (src.stem + ".png"))
