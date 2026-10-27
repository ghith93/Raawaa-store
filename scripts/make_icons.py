#!/usr/bin/env python3
"""
RAWAA — توليد أيقونات التطبيق وأيقونة المشاركة من ملف اللوجو المتجه.
لا خدمات خارجية. كل المخرجات PNG مسطّحة على خلفية الهوية.
"""
from pathlib import Path
from PIL import Image
import io, subprocess, sys

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "icons"
OUT.mkdir(parents=True, exist_ok=True)

# لوحة الألوان من الهوية
IVORY = (251, 248, 243)
BROWN = (107, 85, 68)
INK   = (42, 38, 34)
CREAM = (244, 238, 228)

def render_svg(svg_path: Path, png_path: Path, size: int, bg=None):
    """يرسم SVG بمقاس مربّع عبر Chromium."""
    from playwright.sync_api import sync_playwright
    bgcss = f"#{bg[0]:02x}{bg[1]:02x}{bg[2]:02x}" if bg else "transparent"
    html = f"""<!doctype html><html><head><meta charset="utf-8">
<style>html,body{{margin:0;padding:0;background:{bgcss}}}
img{{display:block;width:{size}px;height:{size}px}}</style></head>
<body><img src="{svg_path.resolve().as_uri()}"></body></html>"""
    tmp = OUT / "_tmp.html"
    tmp.write_text(html, encoding="utf-8")
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={"width": size, "height": size}, device_scale_factor=1)
        pg.goto(tmp.as_uri())
        pg.wait_for_timeout(200)
        pg.screenshot(path=str(png_path), omit_background=(bg is None))
        b.close()
    tmp.unlink(missing_ok=True)

def flatten(src: Path, dst: Path, bg) -> Image.Image:
    """يجعل الخلفية صلبة (مطلوب لأيقونات iOS التي لا تدعم الشفافية)."""
    im = Image.open(src).convert("RGBA")
    base = Image.new("RGBA", im.size, bg + (255,))
    base.alpha_composite(im)
    out = base.convert("RGB")
    out.save(dst, "PNG", optimize=True)
    return out


def tighten(img: Image.Image, pad_ratio: float = 0.10, bg=IVORY, dark=200) -> Image.Image:
    """
    يقصّ على الشعار نفسه (البكسلات الداكنة فقط) ثم يعيد توسيطه بهامش نسبي.
    إطار الملصق الفاتح في SVG ليس جزءًا من الشعار، لذلك لا يُحتسب في القصّ.
    بدون هذه الخطوة يظهر الحرف صغيرًا جدًا في أيقونة الشاشة الرئيسية.
    """
    import numpy as np
    rgb = img.convert("RGB")
    w, h = rgb.size
    a = np.array(rgb.convert("L"))
    ys, xs = np.where(a < dark)          # الحرف والنقطة فقط
    if len(xs) == 0:
        return rgb

    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    glyph = rgb.crop((x0, y0, x1 + 1, y1 + 1))

    side = max(glyph.size)
    pad = int(side * pad_ratio)
    target = side + pad * 2
    canvas = Image.new("RGB", (target, target), bg)
    canvas.paste(glyph, ((target - glyph.width) // 2, (target - glyph.height) // 2))
    return canvas.resize((w, h), Image.LANCZOS)


def main():
    mark = ROOT / "assets" / "brand" / "logo-mark.svg"
    if not mark.is_file():
        sys.exit("لوجو الأيقونة مفقود")

    produced = []

    # 1) أيقونة PWA — 192 و512 (الشفافية مسموحة)
    for size in (192, 512):
        raw = OUT / f"_raw-{size}.png"
        render_svg(mark, raw, size)
        flat = OUT / f"icon-{size}.png"
        tighten(flatten(raw, flat, IVORY)).save(flat, "PNG", optimize=True)
        raw.unlink(missing_ok=True)
        produced.append(flat)

    # 2) أيقونة iOS — 180×180، خلفية صلبة إلزاميًا
    raw = OUT / "_raw-180.png"
    render_svg(mark, raw, 180)
    apple = OUT / "apple-touch-icon.png"
    tighten(flatten(raw, apple, IVORY)).save(apple, "PNG", optimize=True)
    raw.unlink(missing_ok=True)
    produced.append(apple)

    # 3) maskable — المحتوى داخل 80% آمنة (هوامش 10%)
    raw = OUT / "_raw-512m.png"
    render_svg(mark, raw, 512)
    m = tighten(Image.open(raw).convert("RGBA").convert("RGB")).convert("RGBA")
    canvas = Image.new("RGBA", (512, 512), IVORY + (255,))
    inner = m.resize((410, 410), Image.LANCZOS)
    canvas.alpha_composite(inner, (51, 51))
    maskable = OUT / "icon-maskable-512.png"
    canvas.convert("RGB").save(maskable, "PNG", optimize=True)
    raw.unlink(missing_ok=True)
    produced.append(maskable)

    # 4) favicon 32
    raw = OUT / "_raw-64.png"
    render_svg(mark, raw, 64)
    fav = OUT / "favicon-64.png"
    tighten(flatten(raw, fav, IVORY), pad_ratio=0.10).save(fav, "PNG", optimize=True)
    raw.unlink(missing_ok=True)
    produced.append(fav)

    for f in produced:
        im = Image.open(f)
        print(f"  ✓ {f.name:26s} {im.size[0]}×{im.size[1]}  {f.stat().st_size/1024:.1f} KB")

if __name__ == "__main__":
    main()
