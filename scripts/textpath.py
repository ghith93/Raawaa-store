#!/usr/bin/env python3
"""
RAWAA | رواء — محرّك رسم نصوص دقيق (Arabic shaping + SVG paths).

لماذا هذا الملف؟
مولّدات الصور لا تكتب العربية ولا «RAWAA» بدقة موثوقة. لذلك تُرسم كل النصوص
المهمة (اللوجو، الملصق، الأرقام) هنا باستخدام HarfBuzz لتشكيل العربية
وFreetype لاستخراج المسارات، فتصبح النصوص صحيحة 100% وقابلة للتحرير كـ SVG.

لا يُستخدم أي خط خارجي غير المستضاف في المشروع (SIL OFL).
"""
from __future__ import annotations

import io
from dataclasses import dataclass
from pathlib import Path

import freetype
import uharfbuzz as hb

ROOT = Path(__file__).resolve().parent.parent
FONTS = ROOT / "assets" / "fonts"

FONT_FILES = {
    "amiri": FONTS / "amiri-400.woff2",
    "amiri-latin": FONTS / "amiri-400-latin.woff2",
    "almarai-latin": FONTS / "almarai-400-latin.woff2",
    "almarai-bold-latin": FONTS / "almarai-700-latin.woff2",
    "almarai": FONTS / "almarai-400.woff2",
    "almarai-bold": FONTS / "almarai-700.woff2",
    "cormorant": FONTS / "cormorant-500-latin.woff2",
}


def _to_sfnt_bytes(path: Path) -> bytes:
    """يحوّل WOFF2 إلى TTF في الذاكرة."""
    raw = path.read_bytes()
    if raw[:4] == b"wOF2":
        from fontTools.ttLib import TTFont
        font = TTFont(io.BytesIO(raw))
        buf = io.BytesIO()
        font.flavor = None
        font.save(buf)
        return buf.getvalue()
    return raw


_cache: dict[str, tuple] = {}


def load_font(key: str):
    if key not in _cache:
        data = _to_sfnt_bytes(FONT_FILES[key])
        hb_font = hb.Font(hb.Face(data))
        ft_face = freetype.Face(io.BytesIO(data))
        _cache[key] = (hb_font, ft_face)
    hb_font, ft_face = _cache[key]
    return hb_font, ft_face


def upem_of(font_key: str) -> int:
    _, ft_face = load_font(font_key)
    return ft_face.units_per_EM or 1000


@dataclass
class PlacedGlyph:
    glyph_id: int
    x: float       # px
    y: float       # px (موجب = أعلى خط الأساس)


def shape_glyphs(text: str, font_key: str, size: float, letter_spacing: float = 0.0) -> list[PlacedGlyph]:
    """يشكّل النص (ربط عربي، اتجاه RTL تلقائيًا) ويضع الحروف بالبكسل."""
    hb_font, ft_face = load_font(font_key)
    upem = ft_face.units_per_EM or 1000
    scale = size / upem

    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(hb_font, buf, {"kern": True, "liga": True, "calt": True})

    out: list[PlacedGlyph] = []
    x = 0.0
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        out.append(PlacedGlyph(info.codepoint, x + pos.x_offset * scale, -pos.y_offset * scale))
        x += pos.x_advance * scale + letter_spacing
    return out


def text_width(text: str, font_key: str, size: float, letter_spacing: float = 0.0) -> float:
    glyphs = shape_glyphs(text, font_key, size, letter_spacing)
    if not glyphs:
        return 0.0
    last = glyphs[-1]
    # آخر حرف: نضيف تقدمه
    hb_font, _ = load_font(font_key)
    return last.x + _advance_of(last.glyph_id, font_key, size)


def _advance_of(gid: int, font_key: str, size: float) -> float:
    hb_font, _ = load_font(font_key)
    return hb_font.get_glyph_h_advance(gid) * size / upem_of(font_key)


def _glyph_path(glyph_id: int, font_key: str, size: float,
                ox: float, oy: float) -> str:
    """
    يعيد مسار SVG لحرف واحد من نقاط المحيط الحقيقية (TrueType quadratic).
    ox/oy: موضع خط الأساس للجرف. المحور الرأسي يُقلب لـ SVG.
    """
    _, ft_face = load_font(font_key)
    upem = ft_face.units_per_EM or 1000
    scale = size / upem

    if glyph_id == 0:
        return ""
    ft_face.load_glyph(glyph_id, freetype.FT_LOAD_NO_SCALE | freetype.FT_LOAD_NO_HINTING)
    ol = ft_face.glyph.outline
    pts = ol.points
    tags = ol.tags
    ends = ol.contours
    if not pts:
        return ""

    # (x, y) بالبكسل مع قلب رأسي
    def P(i):
        x, y = pts[i]
        return (ox + x * scale, oy - y * scale)

    on = [bool(t & 1) for t in tags]

    parts: list[str] = []
    start_idx = 0
    for end_idx in ends:
        contour = list(range(start_idx, end_idx + 1))
        start_idx = end_idx + 1
        n = len(contour)
        if n == 0:
            continue

        # أول نقطة على المنحنى
        s_local = next((k for k in range(n) if on[contour[k]]), None)

        if s_local is None:
            # محيط كله نقاط تحكم: البداية منتصف أول نقطتين
            a, b = P(contour[0]), P(contour[1 % n])
            first = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
            ctrl = P(contour[0])
            order = contour[1:] + [contour[0]]
        else:
            first = P(contour[s_local])
            ctrl = None
            order = contour[s_local + 1:] + contour[:s_local] + [contour[s_local]]

        parts.append(f"M {first[0]:.3f} {first[1]:.3f}")

        for gi in order:
            p = P(gi)
            if on[gi]:
                if ctrl is not None:
                    parts.append(f"Q {ctrl[0]:.3f} {ctrl[1]:.3f} {p[0]:.3f} {p[1]:.3f}")
                    ctrl = None
                else:
                    parts.append(f"L {p[0]:.3f} {p[1]:.3f}")
            else:
                if ctrl is not None:
                    mid = ((ctrl[0] + p[0]) / 2, (ctrl[1] + p[1]) / 2)
                    parts.append(f"Q {ctrl[0]:.3f} {ctrl[1]:.3f} {mid[0]:.3f} {mid[1]:.3f}")
                ctrl = p

        if ctrl is not None:
            parts.append(f"Q {ctrl[0]:.3f} {ctrl[1]:.3f} {first[0]:.3f} {first[1]:.3f}")
        parts.append("Z")

    return " ".join(parts)


def text_path(text: str, font_key: str, size: float, x: float = 0.0, y: float = 0.0,
              letter_spacing: float = 0.0, anchor: str = "start") -> str:
    """
    يعيد مسار SVG للنص (تشكيل عربي صحيح عبر HarfBuzz، بلا حروف مشوّهة).
    anchor: start | middle | end — (y هو خط الأساس)
    """
    glyphs = shape_glyphs(text, font_key, size, letter_spacing)
    total = text_width(text, font_key, size, letter_spacing)

    if anchor == "middle":
        x -= total / 2.0
    elif anchor == "end":
        x -= total

    chunks = []
    for g in glyphs:
        d = _glyph_path(g.glyph_id, font_key, size, x + g.x, y + g.y)
        if d:
            chunks.append(d)
    return " ".join(chunks)


def text_bbox(text: str, font_key: str, size: float, x: float = 0.0, y: float = 0.0,
              letter_spacing: float = 0.0, anchor: str = "start") -> tuple[float, float, float, float]:
    """صندوق النص المحيط (x_min, y_min, x_max, y_max) بالبكسل."""
    d = text_path(text, font_key, size, x, y, letter_spacing, anchor)
    nums = [t for t in d.replace("M", " ").replace("L", " ").replace("Q", " ")
            .replace("C", " ").replace("Z", " ").split() if _is_num(t)]
    xs = [float(v) for v in nums[0::2]]
    ys = [float(v) for v in nums[1::2]]
    if not xs:
        return (x, y, x, y)
    return (min(xs), min(ys), max(xs), max(ys))


def _is_num(token: str) -> bool:
    try:
        float(token)
        return True
    except ValueError:
        return False


if __name__ == "__main__":
    for key in FONT_FILES:
        d = text_path("رواء", key, 100, 0, 100)
        bb = text_bbox("رواء", key, 100, 0, 100)
        w = text_width("رواء", key, 100)
        print(f"{key:12s} Arabic: contours={d.count('M'):2d} advance={w:6.1f} bbox={tuple(round(v,1) for v in bb)}")
        d2 = text_path("RAWAA", key, 100, 0, 100, letter_spacing=8)
        print(f"{'':12s} Latin : contours={d2.count('M'):2d} width={text_width('RAWAA', key, 100, 8):6.1f}")
