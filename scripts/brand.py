#!/usr/bin/env python3
"""
RAWAA | رواء — نظام الهوية البصرية (متجهات SVG قابلة للتحرير).

يولّد:
  • اللوجو: النسخة الأفقية، العمودية، العلامة المختصرة، والنسخ أحادية اللون.
  • العبوة: رسم متجهي دقيق (زجاج كهرماني مطفي + ملصق عاجي) بثلاثة أحجام.
  • الملصقات: أمامي/خلفي بأبعاد الطباعة.

كل النصوص مسارات (paths) لا نصوص حيّة، لضمان طباعة دقيقة بلا اختلاف خطوط.
المقاسات الهندسية **تقديرية** وليست معتمدة من مصنع.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path

from textpath import text_path, text_width, text_bbox

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "brand"

# ---------------------------------------------------------------- الهوية
C = {
    "ivory": "#FBF8F3",
    "cream": "#F4EEE4",
    "sand": "#E9DECE",
    "sand_deep": "#DFD0BC",
    "taupe": "#A8937C",
    "brown": "#6B5544",
    "ink": "#2A2622",
    "ink_soft": "#554C43",
    "olive": "#5F6653",
    "olive_soft": "#7C8370",
    "gold": "#B08D57",
    "amber": "#8C5A2B",
    "amber_light": "#B67A3D",
    "white": "#FFFDFA",
}

FONT_AR = "amiri"          # عربي كلاسيكي واضح
FONT_AR_UI = "almarai"     # عربي للاستخدامات الصغيرة
FONT_LAT = "cormorant"     # لاتيني راقٍ
FONT_UI_LAT = "almarai-latin"  # أرقام وحروف لاتينية واضحة


def esc(s: str) -> str:
    return (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def t(text: str, size: float, x: float, y: float, *, font: str = FONT_AR,
      fill: str = C["ink"], anchor: str = "start", spacing: float = 0.0,
      opacity: float = 1.0) -> str:
    d = text_path(text, font, size, x, y, letter_spacing=spacing, anchor=anchor)
    o = f' opacity="{opacity}"' if opacity != 1 else ""
    return f'<path d="{d}" fill="{fill}"{o}/>'


def t_mixed(text: str, size: float, x: float, y: float, *, fill: str = C["ink"],
            font_ar: str = FONT_AR, font_lat: str = FONT_UI_LAT,
            anchor: str = "start", spacing: float = 0.0) -> str:
    """يرسم نصًا مختلطًا بتقسيمه إلى مقاطع عربية ولاتينية بخطوط مناسبة."""
    import re as _re
    runs = _re.findall(r"[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF\s]+|[^\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]+", text)
    total = 0.0
    widths = []
    for r in runs:
        f = font_ar if _re.search(r"[\u0600-\u06FF]", r) else font_lat
        w = text_width(r, f, size, spacing)
        widths.append((r, f, w))
        total += w
    if anchor == "middle":
        x -= total / 2
    elif anchor == "end":
        x -= total
    out = []
    for r, f, w in widths:
        # المسافات النقية لا تُرسم
        if r.strip():
            out.append(t(r, size, x, y, font=f, fill=fill, spacing=spacing))
        x += w
    return "".join(out)


def measured(text: str, size: float, font: str = FONT_AR, spacing: float = 0.0) -> float:
    return text_width(text, font, size, spacing)


# ---------------------------------------------------------------- اللوجو


def split_svg(svg: str) -> tuple[str, str]:
    """يفصل <defs> عن بقية محتوى SVG حتى يمكن تضمينه بأمان داخل SVG آخر."""
    import re as _re
    m = _re.search(r"<defs>.*?</defs>", svg, _re.S)
    defs = m.group(0) if m else ""
    body = svg.replace(defs, "") if defs else svg
    body = body.split(">", 1)[1].rsplit("</svg>", 1)[0]
    return defs, body


def logo_primary(color_ink: str = C["ink"], color_accent: str = C["olive"],
                 scale: float = 1.0, bg: str | None = None) -> str:
    """
    النسخة الأفقية: RAWAA بحروف متباعدة + «رواء» أسفلها بخط عربي.
    مساحة العمل: 220 × 96 وحدة.
    """
    w, h = 240.0, 104.0
    latin_size = 34.0
    spacing = latin_size * 0.30
    latin_w = measured("RAWAA", latin_size, FONT_LAT, spacing)
    arabic_size = 30.0
    arabic_w = measured("رواء", arabic_size, FONT_AR)

    cx = w / 2

    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w*scale:.0f}" height="{h*scale:.0f}" role="img" aria-label="RAWAA رواء">']
    if bg:
        parts.append(f'<rect width="{w}" height="{h}" fill="{bg}"/>')

    # RAWAA
    parts.append(t("RAWAA", latin_size, cx, 46, font=FONT_LAT, fill=color_ink,
                   anchor="middle", spacing=spacing))
    # خط فاصل رقيق
    line_w = min(latin_w * 0.62, 120)
    parts.append(
        f'<line x1="{cx-line_w/2:.2f}" y1="56" x2="{cx+line_w/2:.2f}" y2="56" '
        f'stroke="{C["gold"]}" stroke-width="0.7" opacity="0.75"/>'
    )
    # رواء
    parts.append(t("رواء", arabic_size, cx, 88, font=FONT_AR, fill=color_accent, anchor="middle"))

    # نقاط زخرفية دقيقة على جانبي الخط
    for dx in (-line_w / 2 - 6, line_w / 2 + 6):
        parts.append(f'<circle cx="{cx+dx:.2f}" cy="56" r="1.5" fill="{C["gold"]}" opacity="0.8"/>')

    parts.append("</svg>")
    return "\n".join(parts)


def logo_stacked(color_ink: str = C["ink"], color_accent: str = C["olive"],
                 scale: float = 1.0, bg: str | None = None) -> str:
    """نسخة عمودية للعبوة والملصقات (مساحة 160×160)."""
    w, h = 160.0, 170.0
    cx = w / 2
    latin_size = 30.0
    spacing = latin_size * 0.32

    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w*scale:.0f}" height="{h*scale:.0f}" role="img" aria-label="RAWAA رواء">']
    if bg:
        parts.append(f'<rect width="{w}" height="{h}" fill="{bg}"/>')

    # إطار رقيق جدًا (اختياري بصري)
    parts.append(t("RAWAA", latin_size, cx, 44, font=FONT_LAT, fill=color_ink,
                   anchor="middle", spacing=spacing))
    parts.append(t("رواء", 40.0, cx, 104, font=FONT_AR, fill=color_accent, anchor="middle"))
    # سطر تعريفي
    parts.append(t("سيروم للشعر", 12.5, cx, 138, font=FONT_AR_UI, fill=C["taupe"], anchor="middle",
                   spacing=1.4))
    parts.append("</svg>")
    return "\n".join(parts)


def logo_mark(color_ink: str = C["ink"], color_accent: str = C["gold"],
              scale: float = 1.0, bg: str | None = None, rounded: bool = True) -> str:
    """
    العلامة المختصرة (أيقونة): حرف R داخل إطار رفيع + نقطة ذهبية.
    مناسبة لصورة الحساب وأيقونة الموقع.
    """
    s = 64.0
    r = 12.0 if rounded else 0
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {s} {s}" width="{s*scale:.0f}" height="{s*scale:.0f}" role="img" aria-label="RAWAA">']
    parts.append(f'<rect width="{s}" height="{s}" rx="{r}" fill="{bg or C["ivory"]}"/>')
    parts.append(f'<rect x="4.5" y="4.5" width="{s-9}" height="{s-9}" rx="{r-3 if rounded else 0}" '
                 f'fill="none" stroke="{C["sand_deep"]}" stroke-width="0.9"/>')
    parts.append(t("R", 30.0, s / 2, 40, font=FONT_LAT, fill=color_ink, anchor="middle"))
    parts.append(f'<circle cx="{s/2}" cy="48" r="1.8" fill="{color_accent}"/>')
    parts.append("</svg>")
    return "\n".join(parts)


def logo_mono(color: str = C["ink"], scale: float = 1.0) -> str:
    """نسخة أحادية اللون للفويل/الطباعة بلون واحد."""
    return logo_primary(color_ink=color, color_accent=color, scale=scale)


# ---------------------------------------------------------------- العبوة

@dataclass(frozen=True)
class Spec:
    ml: int
    body_h: float      # ارتفاع الجسم مم (تقديري)
    body_d: float      # قطر الجسم مم (تقديري)
    label_h: float     # ارتفاع الملصق مم
    cap_h: float       # ارتفاع القطارة مم


SPECS = {
    30: Spec(30, body_h=60, body_d=29, label_h=33, cap_h=36),
    50: Spec(50, body_h=72, body_d=33, label_h=40, cap_h=38),
    100: Spec(100, body_h=88, body_d=39, label_h=46, cap_h=41),
}


def _label_art(ml: int, w_mm: float, h_mm: float, *, ink: str = C["brown"],
               accent: str = C["olive"], paper: str = C["ivory"],
               show_back: bool = False) -> str:
    """
    فنّ الملصق بمقاساته الحقيقية (مم). المساحة: w×h.
    يعيد مجموعة SVG (بلا وسم svg) لتُرسم داخل مساحة العبوة.
    """
    pad = min(w_mm, h_mm) * 0.10
    cx = w_mm / 2

    parts: list[str] = []
    parts.append(f'<rect x="0" y="0" width="{w_mm}" height="{h_mm}" fill="{paper}"/>')

    if show_back:
        # ظهر الملصق: حقول تُعبَّأ بعد اعتماد البيانات الحقيقية
        parts.append(t("رواء", h_mm * 0.30, cx, h_mm * 0.30, font=FONT_AR,
                       fill=accent, anchor="middle"))
        parts.append(f'<line x1="{pad}" y1="{h_mm*0.37:.2f}" x2="{w_mm-pad}" y2="{h_mm*0.37:.2f}" '
                     f'stroke="{C["sand_deep"]}" stroke-width="0.35"/>')
        for i, label in enumerate(["المكونات", "طريقة الاستخدام", "التحذيرات"]):
            y = h_mm * 0.50 + i * h_mm * 0.14
            parts.append(t(label, h_mm * 0.055, w_mm - pad, y, font=FONT_AR_UI, fill=ink))
            parts.append(f'<line x1="{pad}" y1="{y + h_mm*0.035:.2f}" x2="{w_mm-pad}" y2="{y + h_mm*0.035:.2f}" '
                         f'stroke="{C["sand_deep"]}" stroke-width="0.3" opacity="0.8"/>')
        parts.append(t("—", h_mm * 0.05, cx, h_mm * 0.93, font=FONT_AR_UI,
                       fill=C["taupe"], anchor="middle"))
        return "".join(parts)

    # أمامي: لوجو + الاسم + الحجم
    parts.append(t("RAWAA", h_mm * 0.145, cx, h_mm * 0.30, font=FONT_LAT,
                   fill=ink, anchor="middle", spacing=h_mm * 0.045))
    parts.append(f'<line x1="{cx - w_mm*0.16:.2f}" y1="{h_mm*0.365:.2f}" '
                 f'x2="{cx + w_mm*0.16:.2f}" y2="{h_mm*0.365:.2f}" '
                 f'stroke="{C["gold"]}" stroke-width="0.4"/>')
    parts.append(t("رواء", h_mm * 0.235, cx, h_mm * 0.585, font=FONT_AR,
                   fill=accent, anchor="middle"))
    parts.append(t("سيروم للشعر", h_mm * 0.062, cx, h_mm * 0.695, font=FONT_AR_UI,
                   fill=C["taupe"], anchor="middle", spacing=w_mm * 0.006))
    parts.append(t(f"{ml} ML", h_mm * 0.085, cx, h_mm * 0.895, font=FONT_UI_LAT,
                   fill=ink, anchor="middle", spacing=w_mm * 0.018))
    return "".join(parts)


def bottle_svg(ml: int, *, transparent: bool = False, shadow: bool = True,
               show_label: bool = True, back_label: bool = False,
               palette: str = "amber") -> tuple[str, float, float]:
    """
    رسم متجهي للعبوة (منظر أمامي) بوحدات مم.
    يعيد (svg, width_mm, height_mm).
    palette: amber (زجاج كهرماني مطفي) | ivory (عاجي مطفي)
    """
    spec = SPECS[ml]
    body_h, body_d, cap_h = spec.body_h, spec.body_d, spec.cap_h
    neck_d = body_d * 0.42
    shoulder = body_d * 0.15
    collar_h = cap_h * 0.26
    bulb_h = cap_h * 0.70

    margin = 6.0
    total_w = body_d + margin * 2
    total_h = body_h + cap_h + margin * 2

    glass_hi = "#C98F52" if palette == "amber" else "#FFFFFF"
    glass_mid = "#9C6631" if palette == "amber" else "#F1E7D8"
    glass_lo = "#6E4522" if palette == "amber" else "#DCCDB8"
    cap_col = "#232120"

    uid = f"b{ml}{'t' if transparent else ''}{'b' if back_label else ''}"

    x0 = margin
    y_cap_top = margin
    y_collar_top = y_cap_top + bulb_h
    y_neck = y_cap_top + bulb_h + collar_h
    y_body_top = y_neck + shoulder
    y_body_bot = y_body_top + body_h
    cx = total_w / 2

    parts: list[str] = []
    parts.append(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {total_w:.2f} {total_h:.2f}" '
                 f'width="{total_w:.2f}mm" height="{total_h:.2f}mm">')

    # تعريفات: تدرّجات + ظل ناعم
    parts.append("<defs>")
    parts.append(f'''
    <linearGradient id="glass{uid}" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="{glass_lo}"/>
      <stop offset="18%" stop-color="{glass_mid}"/>
      <stop offset="42%" stop-color="{glass_hi}" stop-opacity="0.92"/>
      <stop offset="62%" stop-color="{glass_mid}"/>
      <stop offset="100%" stop-color="{glass_lo}"/>
    </linearGradient>
    <linearGradient id="cap{uid}" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#111010"/>
      <stop offset="26%" stop-color="#3A3735"/>
      <stop offset="52%" stop-color="#4A4643"/>
      <stop offset="100%" stop-color="#141312"/>
    </linearGradient>
    <linearGradient id="sheen{uid}" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="45%" stop-color="#ffffff" stop-opacity="0.30"/>
      <stop offset="70%" stop-color="#ffffff" stop-opacity="0.05"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <filter id="soft{uid}" x="-60%" y="-40%" width="220%" height="200%">
      <feGaussianBlur stdDeviation="{body_d*0.10:.2f}"/>
    </filter>
    <clipPath id="bodyclip{uid}">
      <path d="{_body_path(cx, y_body_top, body_d, body_h, shoulder, neck_d)}"/>
    </clipPath>
    '''.replace("\n", " "))
    parts.append("</defs>")

    if not transparent:
        parts.append(f'<rect x="0" y="0" width="{total_w:.2f}" height="{total_h:.2f}" fill="{C["ivory"]}"/>')

    # ظل أرضي
    if shadow:
        parts.append(
            f'<ellipse cx="{cx:.2f}" cy="{y_body_bot+1.2:.2f}" rx="{body_d*0.62:.2f}" ry="{body_d*0.075:.2f}" '
            f'fill="{C["brown"]}" opacity="0.20" filter="url(#soft{uid})"/>'
        )

    # الجسم
    body_path = _body_path(cx, y_body_top, body_d, body_h, shoulder, neck_d)
    parts.append(f'<path d="{body_path}" fill="url(#glass{uid})"/>')

    # الملصق
    if show_label:
        label_w = body_d * 0.88
        lx = cx - label_w / 2
        ly = y_body_top + body_h * 0.16
        lh = spec.label_h
        parts.append(f'<g clip-path="url(#bodyclip{uid})">')
        parts.append(f'<g transform="translate({lx:.2f},{ly:.2f})">')
        parts.append(_label_art(ml, label_w, lh, show_back=back_label))
        parts.append("</g>")
        # ظل خفيف على حافة الملصق
        parts.append(f'<rect x="{lx:.2f}" y="{ly:.2f}" width="{label_w:.2f}" height="{lh:.2f}" '
                     f'fill="none" stroke="#00000018" stroke-width="0.25"/>')
        parts.append("</g>")

    # لمعة عامودية
    parts.append(f'<g clip-path="url(#bodyclip{uid})">'
                 f'<rect x="{cx-body_d*0.42:.2f}" y="{y_body_top:.2f}" width="{body_d*0.30:.2f}" '
                 f'height="{body_h:.2f}" fill="url(#sheen{uid})"/></g>')

    # رقبة + كولار
    parts.append(f'<rect x="{cx-neck_d/2:.2f}" y="{y_neck:.2f}" width="{neck_d:.2f}" '
                 f'height="{shoulder+1:.2f}" fill="{glass_mid}"/>')
    collar_w = neck_d * 1.16
    parts.append(f'<rect x="{cx-collar_w/2:.2f}" y="{y_collar_top:.2f}" '
                 f'width="{collar_w:.2f}" height="{collar_h+shoulder*0.55:.2f}" rx="{collar_h*0.20:.2f}" '
                 f'fill="url(#cap{uid})"/>')

    # غطاء القطارة (مطفي)
    bulb_w = neck_d * 1.12
    parts.append(
        f'<rect x="{cx-bulb_w/2:.2f}" y="{y_cap_top:.2f}" width="{bulb_w:.2f}" height="{bulb_h:.2f}" '
        f'rx="{bulb_w*0.30:.2f}" fill="url(#cap{uid})"/>'
    )
    # لمعة رأسية على الغطاء
    parts.append(
        f'<rect x="{cx-bulb_w*0.26:.2f}" y="{y_cap_top+bulb_h*0.10:.2f}" width="{bulb_w*0.14:.2f}" '
        f'height="{bulb_h*0.72:.2f}" rx="{bulb_w*0.07:.2f}" fill="#ffffff" opacity="0.10"/>'
    )
    # حدّ فاصل بين الغطاء والكولار
    parts.append(f'<line x1="{cx-bulb_w/2:.2f}" y1="{y_collar_top:.2f}" '
                 f'x2="{cx+bulb_w/2:.2f}" y2="{y_collar_top:.2f}" '
                 f'stroke="#00000038" stroke-width="0.4"/>')

    parts.append("</svg>")
    return "\n".join(parts), total_w, total_h


def _body_path(cx: float, y_top: float, d: float, h: float, shoulder: float, neck_d: float) -> str:
    """مسار جسم العبوة: كتف منحنٍ + زوايا سفلية مستديرة (قابل للتصنيع بسهولة)."""
    r = d * 0.10
    left = cx - d / 2
    right = cx + d / 2
    y_bot = y_top + h
    n_left = cx - neck_d / 2
    n_right = cx + neck_d / 2

    return (
        f"M {n_left:.2f} {y_top:.2f} "
        f"C {n_left:.2f} {y_top+shoulder*0.85:.2f} {left:.2f} {y_top+shoulder*0.45:.2f} {left:.2f} {y_top+shoulder*1.15:.2f} "
        f"L {left:.2f} {y_bot-r:.2f} "
        f"Q {left:.2f} {y_bot:.2f} {left+r:.2f} {y_bot:.2f} "
        f"L {right-r:.2f} {y_bot:.2f} "
        f"Q {right:.2f} {y_bot:.2f} {right:.2f} {y_bot-r:.2f} "
        f"L {right:.2f} {y_top+shoulder*1.15:.2f} "
        f"C {right:.2f} {y_top+shoulder*0.45:.2f} {n_right:.2f} {y_top+shoulder*0.85:.2f} {n_right:.2f} {y_top:.2f} "
        f"Z"
    )


# ---------------------------------------------------------------- لوحة الهوية

def brand_board() -> str:
    """لوحة مرجعية واحدة: اللوجو، الألوان، الخطوط، العبوة. (1000×1400)"""
    W, H = 1000.0, 1440.0
    p: list[str] = []
    p.append(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W:.0f}" height="{H:.0f}">')
    p.append(f'<rect width="{W}" height="{H}" fill="{C["ivory"]}"/>')

    # رأس
    p.append(t("RAWAA", 22, 60, 76, font=FONT_LAT, fill=C["ink"], spacing=8))
    p.append(t("رواء", 26, 60 + measured("RAWAA", 22, FONT_LAT, 8) + 14, 76, font=FONT_AR, fill=C["olive"]))
    p.append(t("لوحة الهوية البصرية", 26, W - 60, 76, font=FONT_AR, fill=C["ink"], anchor="end"))
    p.append(f'<line x1="60" y1="100" x2="{W-60}" y2="100" stroke="{C["sand_deep"]}" stroke-width="0.8"/>')

    # اللوجو الأفقي في مساحة كبيرة
    p.append(f'<rect x="60" y="130" width="{W-120}" height="220" fill="{C["white"]}" stroke="{C["sand"]}" stroke-width="0.8"/>')
    lg = logo_primary(scale=1.0)
    inner = lg.split(">", 1)[1].rsplit("</svg>", 1)[0]
    p.append(f'<g transform="translate({(W-240)/2:.0f},190) scale(1.35)">{inner}</g>')

    # اللوجو على خلفية داكنة
    p.append(f'<rect x="60" y="370" width="{(W-140)/2}" height="150" fill="{C["ink"]}"/>')
    lg_dark = logo_primary(color_ink=C["ivory"], color_accent=C["sand"])
    inner_dark = lg_dark.split(">", 1)[1].rsplit("</svg>", 1)[0]
    p.append(f'<g transform="translate({60+(W-140)/4-120:.0f},{370+22})">{inner_dark}</g>')

    # علامة مختصرة
    p.append(f'<rect x="{60+(W-140)/2+20}" y="370" width="{(W-140)/2}" height="150" fill="{C["cream"]}"/>')
    mark = logo_mark(scale=1.0)
    mark_inner = mark.split(">", 1)[1].rsplit("</svg>", 1)[0]
    p.append(f'<g transform="translate({60+(W-140)/2+20+((W-140)/2-64)/2:.0f},412)">{mark_inner}</g>')

    # الألوان
    y = 560
    p.append(t("لوحة الألوان", 22, W - 60, y - 20, font=FONT_AR, fill=C["ink"], anchor="end"))
    swatches = [
        ("عاجي", C["ivory"]), ("كريمي", C["cream"]), ("رملي", C["sand"]),
        ("بني دافئ", C["brown"]), ("زيتوني", C["olive"]), ("ذهبي", C["gold"]),
        ("كهرماني", C["amber"]), ("حبري", C["ink"]),
    ]
    sw = (W - 120 - 7 * 12) / 8
    for i, (name, hexv) in enumerate(swatches):
        x = 60 + i * (sw + 12)
        p.append(f'<rect x="{x:.1f}" y="{y}" width="{sw:.1f}" height="96" fill="{hexv}" stroke="#00000012" stroke-width="0.6"/>')
        p.append(t(name, 13, x + sw / 2, y + 118, font=FONT_AR_UI, fill=C["ink_soft"], anchor="middle"))
        p.append(t(hexv, 11, x + sw / 2, y + 136, font=FONT_LAT, fill=C["taupe"], anchor="middle", spacing=0.5))

    # الخطوط
    y2 = 730
    p.append(t("الخطوط", 22, W - 60, y2, font=FONT_AR, fill=C["ink"], anchor="end"))
    p.append(f'<line x1="60" y1="{y2+16}" x2="{W-60}" y2="{y2+16}" stroke="{C["sand_deep"]}" stroke-width="0.6"/>')
    p.append(t_mixed("العناوين العربية — Amiri", 30, W - 60, y2 + 62, fill=C["ink"], anchor="end"))
    p.append(t_mixed("النصوص والأزرار — Almarai", 22, W - 60, y2 + 104, fill=C["ink_soft"], anchor="end"))
    p.append(t_mixed("الاسم اللاتيني — Cormorant Garamond", 22, W - 60, y2 + 140, fill=C["ink_soft"], anchor="end"))
    p.append(t_mixed("الترخيص: SIL Open Font License (OFL) — الخطوط مستضافة داخل المشروع",
                     13, W - 60, y2 + 166, fill=C["taupe"], anchor="end"))

    # العبوة
    y3 = 960
    p.append("__BOARD_DEFS__")
    p.append(t("العبوة — نموذج تصميمي (غير مُصنَّع)", 22, W - 60, y3, font=FONT_AR, fill=C["ink"], anchor="end"))
    p.append(f'<line x1="60" y1="{y3+16}" x2="{W-60}" y2="{y3+16}" stroke="{C["sand_deep"]}" stroke-width="0.6"/>')

    xs = [150, 380, 640]
    board_defs: list[str] = []
    for i, ml in enumerate((30, 50, 100)):
        svg, bw, bh = bottle_svg(ml, shadow=True)
        d, body = split_svg(svg)
        board_defs.append(d)
        s_factor = 2.1
        p.append(f'<g transform="translate({xs[i]-bw*s_factor/2:.1f},{y3+60}) scale({s_factor})">{body}</g>')
        p.append(t(f"{ml} ML", 15, xs[i], y3 + 60 + bh * s_factor + 26, font=FONT_UI_LAT,
                   fill=C["ink"], anchor="middle", spacing=2.0))

    # تذييل
    p.append(f'<line x1="60" y1="{H-74}" x2="{W-60}" y2="{H-74}" stroke="{C["sand_deep"]}" stroke-width="0.6"/>')
    p.append(t("هذه اللوحة مرجع تصميمي. الصور تصورات بصرية وليست صورًا لمنتج مصنّع.",
               13, W - 60, H - 46, font=FONT_AR_UI, fill=C["taupe"], anchor="end"))
    p.append(t_mixed("RAWAA — الرقة، سوريا", 13, 60, H - 46, fill=C["taupe"]))
    out = "\n".join(p).replace("__BOARD_DEFS__", "".join(board_defs))
    if not out.rstrip().endswith("</svg>"):
        out += "\n</svg>"
    return out


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "logo-primary.svg").write_text(logo_primary(), encoding="utf-8")
    (OUT / "logo-stacked.svg").write_text(logo_stacked(), encoding="utf-8")
    (OUT / "logo-mark.svg").write_text(logo_mark(), encoding="utf-8")
    (OUT / "logo-mono-ink.svg").write_text(logo_mono(C["ink"]), encoding="utf-8")
    (OUT / "logo-mono-ivory.svg").write_text(logo_mono(C["ivory"]), encoding="utf-8")
    (OUT / "brand-board.svg").write_text(brand_board(), encoding="utf-8")
    for ml in (30, 50, 100):
        svg, w, h = bottle_svg(ml)
        (OUT / f"bottle-{ml}ml.svg").write_text(svg, encoding="utf-8")
    print("SVG written to", OUT)
