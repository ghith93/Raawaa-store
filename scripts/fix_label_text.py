#!/usr/bin/env python3
"""
RAWAA — إصلاح نص الملصق داخل صور المنتج الفعلية.

لماذا سكربت وليس إعادة توليد؟
  الصور الحالية (v4) تحمل نصًّا لاتينيًا من فئة قديمة: «HAIR & SCALP SERUM».
  إعادة التوليد بالذكاء الاصطناعي تُنتج عبوة مختلفة عن المتجر → الهوية تنكسر.
  الحل: نجد سطر النص داخل الملصق، نملأه بلون الملصق نفسه (مأخوذ من الصورة)،
  ثم نكتب النص الصحيح بنفس المقاس والمحاذاة. النتيجة: نفس الصورة، نص صحيح.

المبدأ: لا نرسم شيئًا فوق نسيج لم نعرفه — نأخذ لون كل سطر من محيطه.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "img" / "products"

FONT = "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"
INK = (46, 42, 37)
NEW_TEXT = "PURE HAIR OIL"


def label_mask(arr: np.ndarray) -> np.ndarray:
    """بكسل الملصق: فاتح جدًا وقليل التشبّع (الورق العاجي)، مقابل الزجاج الكهرماني والخلفية."""
    r, g, b = arr[:, :, 0].astype(int), arr[:, :, 1].astype(int), arr[:, :, 2].astype(int)
    bright = (r + g + b) / 3
    spread = np.maximum.reduce([r, g, b]) - np.minimum.reduce([r, g, b])
    return (bright > 185) & (spread < 46) & (r > 190) & (b > 165)


def rows_with_text(mask_label: np.ndarray, dark: np.ndarray) -> list[tuple[int, int]]:
    """مجموعات صفوف متتالية تحتوي بكسلًا داكنًا داخل الملصق."""
    counts = (dark & mask_label).sum(axis=1)
    rows, run = [], None
    for y, c in enumerate(counts):
        if c >= 2:
            if run is None:
                run = y
        elif run is not None:
            rows.append((run, y - 1))
            run = None
    if run is not None:
        rows.append((run, len(counts) - 1))
    return [r for r in rows if r[1] - r[0] >= 2]


def fix_image(path: Path, out_path: Path) -> str:
    im = Image.open(path).convert("RGB")
    arr = np.array(im)
    H, W = arr.shape[:2]

    lab = label_mask(arr)
    # نُبقي الملصق الكبير فقط (نستبعد اللمعات الصغيرة)
    ys, xs = np.where(lab)
    if len(ys) < 5000:
        return "تخطّي: ملصق غير واضح"

    dark = (arr.mean(axis=2) < 130)
    bands = rows_with_text(lab, dark)
    if not bands:
        return "تخطّي: لا نص"

    # آخر سطر داخل الملصق = السطر الوصفي (تحت الحجم)
    y0, y1 = bands[-1]
    band_h = y1 - y0 + 1

    # حدود النص أفقيًا
    sub = dark[y0:y1 + 1, :] & lab[y0:y1 + 1, :]
    cols = np.where(sub.any(axis=0))[0]
    if len(cols) < 6:
        return "تخطّي: نص بلا امتداد"
    x0, x1 = int(cols.min()), int(cols.max())
    text_w = x1 - x0 + 1

    # حدود الملصق في هذا النطاق — نملأ عرضه كله (لا بقعة مستطيلة ظاهرة)
    lab_rows = lab[y0:y1 + 1, :]
    lcols = np.where(lab_rows.sum(axis=0) > (band_h * 0.5))[0]
    lx0, lx1 = int(lcols.min()), int(lcols.max())

    # لون الورق: وسيط النطاق الرأسي نفسه، خارج نطاق النص
    band_slice = arr[max(0, y0 - 2):min(H, y1 + 3), :, :]
    band_lab = lab[max(0, y0 - 2):min(H, y1 + 3), :]
    outside = band_slice[band_lab]
    if outside.size == 0:
        return "تخطّي: لا لون مرجعي"
    paper = np.median(outside.reshape(-1, 3), axis=0).astype(np.uint8)

    # املأ السطر بلون الورق، ثم أضف حبيبات خفيفة حتى لا يظهر كبقعة ملساء
    fill = np.tile(paper, (band_h + 4, lx1 - lx0 + 1, 1)).astype(np.int16)
    rng = np.random.default_rng(7)
    fill += rng.integers(-3, 4, fill.shape, dtype=np.int16)
    seg = arr[y0 - 2:y0 - 2 + fill.shape[0], lx0:lx1 + 1, :].astype(np.int16)
    # مزج تدريجي عند الحواف حتى لا يظهر إطار
    blend = np.ones((fill.shape[0], fill.shape[1], 1))
    edge = 2
    blend[:edge, :, 0] = np.linspace(0, 1, edge)[:, None]
    blend[-edge:, :, 0] = np.linspace(1, 0, edge)[:, None]
    arr[y0 - 2:y0 - 2 + fill.shape[0], lx0:lx1 + 1, :] = np.clip(
        seg * (1 - blend) + fill * blend, 0, 255
    ).astype(np.uint8)

    out = Image.fromarray(arr)
    draw = ImageDraw.Draw(out)

    # مقاس الخط: نطابق ارتفاع الحروف الأصلي (نسبة تقريبية لخط بلا حروف علوية)
    size = max(7, int(round(band_h * 1.42)))
    font = ImageFont.truetype(FONT, size)
    spacing = max(0.6, text_w / max(1, len(NEW_TEXT)) * 0.20)

    widths = [draw.textlength(ch, font=font) for ch in NEW_TEXT]
    total = sum(widths) + spacing * (len(NEW_TEXT) - 1)
    cx = (lx0 + lx1) / 2
    x = cx - total / 2
    baseline_y = y0 - max(0, int(size * 0.05))
    for ch, w in zip(NEW_TEXT, widths):
        draw.text((x, baseline_y), ch, font=font, fill=INK)
        x += w + spacing

    out.save(out_path, quality=95, subsampling=1)
    return f"✓ {path.name} · سطر {band_h}px · نص {int(total)}px · ملصق {lx0}-{lx1}"


if __name__ == "__main__":
    targets = sys.argv[1:] or [
        "size-30-v4-720", "size-50-v4-720", "size-100-v4-720",
        "trio-v4-1080", "hero-wide-v3-v4-1080", "editorial-v4-720",
        "detail-label-v4-720",
    ]
    for t in targets:
        p = SRC / f"{t}.jpg"
        if not p.exists():
            print("مفقود:", p.name)
            continue
        print(fix_image(p, p))
