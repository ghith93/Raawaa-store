#!/usr/bin/env python3
"""
RAWAA | رواء — تركيب الصور التحريرية من متجهات الهوية.

كل صورة تُبنى تركيبيًا (SVG) من نفس ملفات العبوة واللوجو، ثم تُصدَّر PNG
عبر Chromium. النتيجة: المنتج متطابق 100% بين كل الصور (بلا تشويه، بلا
نصوص مولّدة، بلا علامات تجارية دخيلة).

هذه **تصورات تصميمية** وليست صورًا فوتوغرافية لمنتج مُصنَّع.
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from brand import SPECS, bottle_svg, C, logo_mark, _label_art
from textpath import text_path, text_width

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "img" / "design"
RAW = ROOT / "assets" / "img" / "design-raw"


# ----------------------------------------------------------------- أدوات

def bottle_inner(ml: int, *, shadow: bool = False, back: bool = False) -> tuple[str, float, float]:
    svg, w, h = bottle_svg(ml, shadow=shadow, back_label=back, transparent=True)
    # نُزيل وسم <svg> ونحتفظ بالتعريفات والمحتوى
    body = svg.split(">", 1)[1].rsplit("</svg>", 1)[0]
    return body, w, h


def defs_bg(uid: str, top: str, bottom: str, light_x: float, light_y: float) -> str:
    return f'''
    <linearGradient id="bg{uid}" x1="0" y1="0" x2="0.35" y2="1">
      <stop offset="0%" stop-color="{top}"/>
      <stop offset="100%" stop-color="{bottom}"/>
    </linearGradient>
    <radialGradient id="light{uid}" cx="{light_x}" cy="{light_y}" r="0.75">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.85"/>
      <stop offset="45%" stop-color="#ffffff" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="vig{uid}" cx="0.5" cy="0.5" r="0.78">
      <stop offset="60%" stop-color="#000000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#4A3A28" stop-opacity="0.16"/>
    </radialGradient>
    <filter id="grain{uid}" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" seed="7"/>
      <feColorMatrix type="saturate" values="0"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.045"/></feComponentTransfer>
    </filter>
    <filter id="shadow{uid}" x="-80%" y="-80%" width="260%" height="260%">
      <feGaussianBlur stdDeviation="26"/>
    </filter>
    <filter id="soft{uid}" x="-80%" y="-80%" width="260%" height="260%">
      <feGaussianBlur stdDeviation="7"/>
    </filter>
    '''


def linen_fold(x: float, y: float, w: float, h: float, uid: str, tone: str = "#D8CEB9") -> str:
    """ثنية قماش كتاني بسيطة (شكل متجهي هادئ)."""
    return (
        f'<path d="M {x:.0f} {y:.0f} '
        f'C {x+w*0.22:.0f} {y-h*0.22:.0f} {x+w*0.55:.0f} {y-h*0.10:.0f} {x+w:.0f} {y+h*0.06:.0f} '
        f'L {x+w*0.97:.0f} {y+h*0.72:.0f} '
        f'C {x+w*0.58:.0f} {y+h*0.92:.0f} {x+w*0.24:.0f} {y+h*0.86:.0f} {x:.0f} {y+h*0.58:.0f} Z" '
        f'fill="{tone}" opacity="0.72"/>'
        f'<path d="M {x+w*0.08:.0f} {y+h*0.30:.0f} C {x+w*0.36:.0f} {y+h*0.22:.0f} '
        f'{x+w*0.68:.0f} {y+h*0.26:.0f} {x+w*0.94:.0f} {y+h*0.44:.0f}" '
        f'fill="none" stroke="#B9AC93" stroke-width="1.6" opacity="0.5"/>'
    )


def ceramic_dish(cx: float, cy: float, r: float, uid: str, tone: str = "#B98A4B") -> str:
    """صحن زجاجي عنبري صغير — عنصر خامات."""
    return (
        f'<ellipse cx="{cx:.0f}" cy="{cy:.0f}" rx="{r:.0f}" ry="{r*0.34:.0f}" fill="{tone}" opacity="0.92"/>'
        f'<ellipse cx="{cx:.0f}" cy="{cy:.0f}" rx="{r*0.80:.0f}" ry="{r*0.26:.0f}" fill="#8C5A2B" opacity="0.55"/>'
        f'<ellipse cx="{cx-r*0.22:.0f}" cy="{cy-r*0.06:.0f}" rx="{r*0.20:.0f}" ry="{r*0.07:.0f}" '
        f'fill="#FFFFFF" opacity="0.35"/>'
    )


def stone_ledge(w: int, h: int, top_y: float, slope: float = -22, uid: str = "") -> str:
    """حافة حجرية أفقية (سطح عرض)."""
    return (
        f'<path d="M 0 {top_y:.0f} L {w} {top_y + slope:.0f} L {w} {h} L 0 {h} Z" fill="#E3D6C2"/>'
        f'<path d="M 0 {top_y:.0f} L {w} {top_y + slope:.0f} L {w} {top_y + slope + 18:.0f} L 0 {top_y + 18:.0f} Z" '
        f'fill="#EFE5D6" opacity="0.95"/>'
        f'<path d="M 0 {top_y + 18:.0f} L {w} {top_y + slope + 18:.0f} L {w} {top_y + slope + 30:.0f} L 0 {top_y + 30:.0f} Z" '
        f'fill="#D9CAB3" opacity="0.55"/>'
    )


def scene(uid: str, w: int, h: int, *, top: str, bottom: str, light=(0.28, 0.18),
          grain: bool = True) -> list[str]:
    p = [f'<defs>{defs_bg(uid, top, bottom, light[0], light[1])}</defs>']
    p.append(f'<rect width="{w}" height="{h}" fill="url(#bg{uid})"/>')
    p.append(f'<rect width="{w}" height="{h}" fill="url(#light{uid})"/>')
    if grain:
        p.append(f'<rect width="{w}" height="{h}" filter="url(#grain{uid})" opacity="0.9"/>')
    p.append(f'<rect width="{w}" height="{h}" fill="url(#vig{uid})"/>')
    return p


def ground_shadow(cx: float, cy: float, rx: float, uid: str, opacity: float = 0.20) -> str:
    return (f'<ellipse cx="{cx:.1f}" cy="{cy:.1f}" rx="{rx:.1f}" ry="{rx*0.16:.1f}" '
            f'fill="#4A3A28" opacity="{opacity}" filter="url(#shadow{uid})"/>')


def hairline(x1, y1, x2, y2, color=C["gold"], op=0.45, w=1.2) -> str:
    return (f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{color}" '
            f'stroke-width="{w}" opacity="{op}"/>')


def caption(x: float, y: float, text: str, size: float = 22, color=C["taupe"],
            anchor: str = "middle", font: str = "almarai") -> str:
    d = text_path(text, font, size, x, y, anchor=anchor)
    return f'<path d="{d}" fill="{color}" opacity="0.9"/>'


def svg_wrap(w, h, body: list[str], label: str = "RAWAA") -> str:
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" '
            f'role="img" aria-label="{label}">' + "".join(body) + "</svg>")


# ----------------------------------------------------------------- المشاهد

def hero_wide() -> str:
    """صورة أفقية واسعة للقسم الرئيسي (1600×1000)."""
    W, H = 1600, 1000
    uid = "hero"
    b, bw, bh = bottle_inner(50, shadow=False)
    s = 6.3
    bx = 1046
    by = 96
    p = scene(uid, W, H, top="#FDFBF7", bottom="#EADFCE", light=(0.72, 0.14))
    p.append(stone_ledge(W, H, 806, slope=-18, uid=uid))
    # خامات خلفية
    p.append(linen_fold(60, 852, 380, 130, uid))
    p.append(ceramic_dish(700, 858, 62, uid))
    p.append(ground_shadow(bx + bw * s / 2, by + bh * s - 4, bw * s * 0.56, uid, 0.24))
    p.append(f'<g transform="translate({bx},{by}) scale({s})">{b}</g>')

    # كتلة نصية
    p.append(caption(120, 246, "RAWAA", 78, C["ink"], "start", "cormorant"))
    p.append(caption(122, 350, "رواء", 92, C["olive"], "start", "amiri"))
    p.append(hairline(124, 392, 470, 392))
    p.append(caption(124, 448, "سيروم للشعر", 30, C["taupe"], "start", "almarai"))
    p.append(caption(124, 560, "30 · 50 · 100 ML", 25, C["ink"], "start", "almarai-latin"))
    p.append(caption(124, 604, "الرقة، سوريا", 22, C["taupe"], "start", "almarai"))
    # تذييل إخلاء المسؤولية
    p.append(caption(120, 946, "تصور تصميمي للعبوة — ليس صورة منتج مُصنَّع", 20,
                     C["taupe"], "start", "almarai"))
    return svg_wrap(W, H, p, "تصور تصميمي لعبوة سيروم رواء")


def product_card(ml: int, w=900, h=1125) -> str:
    """صورة بطاقة منتج عمودية 4:5."""
    uid = f"p{ml}"
    b, bw, bh = bottle_inner(ml, shadow=False)
    s = 7.0 if ml < 100 else 7.0
    bx = w / 2 - bw * s / 2
    by = h * 0.10
    p = scene(uid, w, h, top="#FCF9F5", bottom="#EFE5D6", light=(0.5, 0.14))
    p.append(f'<path d="M 0 {h*0.72:.0f} L {w} {h*0.69:.0f} L {w} {h} L 0 {h} Z" fill="#E6D9C6"/>')
    p.append(ground_shadow(w / 2, by + bh * s - 4, bw * s * 0.60, uid, 0.22))
    p.append(f'<g transform="translate({bx:.1f},{by:.1f}) scale({s})">{b}</g>')
    p.append(ceramic_dish(w * 0.30, h * 0.785, 58, uid))
    p.append(caption(w / 2, h - 54, f"{ml} ML", 26, C["taupe"], "middle", "almarai-latin"))
    return svg_wrap(w, h, p, f"تصور تصميمي لعبوة سيروم رواء {ml} مل")


def trio(w=1400, h=1000) -> str:
    uid = "trio"
    p = scene(uid, w, h, top="#FCFAF6", bottom="#E9DECD", light=(0.5, 0.12))
    p.append(f'<path d="M 0 {h*0.74:.0f} L {w} {h*0.72:.0f} L {w} {h} L 0 {h} Z" fill="#E5D8C4"/>')
    s = 5.0
    xs = [w * 0.24, w * 0.50, w * 0.76]
    for i, ml in enumerate((30, 50, 100)):
        b, bw, bh = bottle_inner(ml)
        bx = xs[i] - bw * s / 2
        by = h * 0.78 - bh * s
        p.append(ground_shadow(xs[i], h * 0.78 - 4, bw * s * 0.58, uid, 0.20))
        p.append(f'<g transform="translate({bx:.1f},{by:.1f}) scale({s})">{b}</g>')
        p.append(caption(xs[i], h * 0.86, f"{ml} ML", 24, C["taupe"], "middle", "almarai-latin"))
    p.append(linen_fold(w * 0.03, h * 0.80, w * 0.26, h * 0.11, uid))
    p.append(caption(w / 2, 92, "RAWAA", 40, C["ink"], "middle", "cormorant"))
    p.append(caption(w / 2, 146, "رواء", 44, C["olive"], "middle", "amiri"))
    return svg_wrap(w, h, p, "الأحجام الثلاثة — تصور تصميمي")


def detail_closeup(w=1200, h=900) -> str:
    """مقربة من الغطاء والملصق."""
    uid = "detail"
    b, bw, bh = bottle_inner(50)
    s = 15.0
    bx = w / 2 - bw * s / 2
    by = -h * 0.30
    p = scene(uid, w, h, top="#FAF7F1", bottom="#E7DBC9", light=(0.35, 0.1))
    p.append(f'<g transform="translate({bx:.1f},{by:.1f}) scale({s})">{b}</g>')
    p.append(f'<rect width="{w}" height="{h}" fill="url(#vig{uid})" opacity="0.7"/>')
    return svg_wrap(w, h, p, "مقربة من غطاء وملصق العبوة — تصور تصميمي")


def social_square(w=1080, h=1080) -> str:
    uid = "sq"
    b, bw, bh = bottle_inner(100)
    s = 5.6
    bx = w * 0.60 - bw * s / 2
    by = h * 0.16
    p = scene(uid, w, h, top="#FBF8F3", bottom="#EADFCE", light=(0.7, 0.12))
    p.append(f'<path d="M 0 {h*0.70:.0f} L {w} {h*0.67:.0f} L {w} {h} L 0 {h} Z" fill="#E4D6C1"/>')
    p.append(ground_shadow(bx + bw * s / 2, by + bh * s - 6, bw * s * 0.6, uid, 0.22))
    p.append(f'<g transform="translate({bx:.1f},{by:.1f}) scale({s})">{b}</g>')
    p.append(caption(80, h * 0.30, "RAWAA", 56, C["ink"], "start", "cormorant"))
    p.append(caption(80, h * 0.40, "رواء", 62, C["olive"], "start", "amiri"))
    p.append(hairline(80, h * 0.44, 340, h * 0.44))
    p.append(caption(80, h * 0.50, "سيروم للشعر", 28, C["taupe"], "start", "almarai"))
    p.append(caption(80, h * 0.555, "30 · 50 · 100 ML", 24, C["taupe"], "start", "almarai-latin"))
    return svg_wrap(w, h, p, "منشور مربع — تصور تصميمي")


def social_vertical(w=1080, h=1920) -> str:
    uid = "vt"
    b, bw, bh = bottle_inner(50)
    s = 7.0
    bx = w / 2 - bw * s / 2
    by = h * 0.22
    p = scene(uid, w, h, top="#FCF9F4", bottom="#E7DCCA", light=(0.5, 0.14))
    p.append(f'<path d="M 0 {h*0.66:.0f} L {w} {h*0.64:.0f} L {w} {h} L 0 {h} Z" fill="#E4D6C1"/>')
    p.append(ground_shadow(w / 2, by + bh * s - 6, bw * s * 0.62, uid, 0.22))
    p.append(f'<g transform="translate({bx:.1f},{by:.1f}) scale({s})">{b}</g>')
    p.append(caption(w / 2, h * 0.09, "RAWAA", 54, C["ink"], "middle", "cormorant"))
    p.append(caption(w / 2, h * 0.125, "رواء", 58, C["olive"], "middle", "amiri"))
    p.append(caption(w / 2, h * 0.86, "سيروم للشعر", 30, C["taupe"], "middle", "almarai"))
    p.append(caption(w / 2, h * 0.90, "الطلب عبر واتساب", 24, C["taupe"], "middle", "almarai"))
    return svg_wrap(w, h, p, "قصة عمودية — تصور تصميمي")


def label_artwork(ml: int, which: str = "front") -> str:
    """ملف الملصق القابل للتحرير بمقاسه الحقيقي (مم) مع علامات قطع."""
    spec = SPECS[ml]
    # محيط الأسطوانة ≈ π × القطر، نأخذ 80% منه للملصق
    import math
    label_w = round(math.pi * spec.body_d * 0.80)
    label_h = spec.label_h
    bleed = 2.0
    W = label_w + bleed * 2
    H = label_h + bleed * 2

    body = [f'<rect width="{W}" height="{H}" fill="#FFFFFF"/>']
    body.append(f'<g transform="translate({bleed},{bleed})">')
    body.append(_label_art(ml, label_w, label_h, show_back=(which == "back")))
    body.append("</g>")
    # علامات قطع
    for (x1, y1, x2, y2) in [
        (0, bleed, -4, bleed), (W, bleed, W + 4, bleed),
        (0, H - bleed, -4, H - bleed), (W, H - bleed, W + 4, H - bleed),
        (bleed, 0, bleed, -4), (bleed, H, bleed, H + 4),
        (W - bleed, 0, W - bleed, -4), (W - bleed, H, W - bleed, H + 4),
    ]:
        body.append(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="#C0392B" stroke-width="0.25"/>')
    body.append(f'<rect x="{bleed}" y="{bleed}" width="{label_w}" height="{label_h}" '
                f'fill="none" stroke="#C0392B" stroke-width="0.25" stroke-dasharray="1.2 1.2"/>')

    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="-6 -6 {W+12} {H+12}" '
            f'width="{W+12}mm" height="{H+12}mm">' + "".join(body) + "</svg>")


# ----------------------------------------------------------------- التشغيل

JOBS = [
    ("hero-wide.svg", hero_wide, 1600, 2),
    ("product-30.svg", lambda: product_card(30), 900, 2),
    ("product-50.svg", lambda: product_card(50), 900, 2),
    ("product-100.svg", lambda: product_card(100), 900, 2),
    ("trio.svg", trio, 1400, 2),
    ("detail-closeup.svg", detail_closeup, 1200, 2),
    ("social-square.svg", social_square, 1080, 2),
    ("social-vertical.svg", social_vertical, 1080, 1.6),
]


def main(render: bool = True) -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    RAW.mkdir(parents=True, exist_ok=True)

    written = []
    for name, fn, width, scale in JOBS:
        path = OUT / name
        path.write_text(fn(), encoding="utf-8")
        written.append((path, width, scale))
        print("svg:", path.name)

    for ml in (30, 50, 100):
        for which in ("front", "back"):
            p = OUT / f"label-{ml}ml-{which}.svg"
            p.write_text(label_artwork(ml, which), encoding="utf-8")
            print("svg:", p.name)

    if render:
        cmd = [sys.executable, str(ROOT / "scripts" / "render_svg.py")]
        for path, width, scale in written:
            subprocess.run(
                cmd + [str(path), "--width", str(width), "--scale", str(scale),
                       "--outdir", str(RAW)],
                check=True, capture_output=True
            )
            print("png:", path.stem)
    print("done")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-render", action="store_true")
    a = ap.parse_args()
    sys.exit(main(render=not a.no_render))
