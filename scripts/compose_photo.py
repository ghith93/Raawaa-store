#!/usr/bin/env python3
"""
RAWAA | رواء — تركيب العبوة المتجهية فوق صور خامات فوتوغرافية.

لماذا؟ العبوة يجب أن تبقى **متطابقة تمامًا** في كل الصور (نفس اللوجو، نفس
الألوان، نفس النسب). لذلك لا نولّد صورة عبوة جديدة في كل مرة، بل نرسم العبوة
مرة واحدة كمتجه ثم نضعها فوق خلفية خامات بظل ارتكاز يطابق اتجاه الضوء.

النتيجة: تصورات تصميمية ثابتة الهوية — وليست صورًا فوتوغرافية لمنتج مُصنَّع.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, str(Path(__file__).resolve().parent))

from brand import bottle_svg  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
PLATES = ROOT / "assets" / "img" / "plate"
RAW = ROOT / "assets" / "img" / "design-raw"
SVG_OUT = ROOT / "assets" / "img" / "design"
BOTTLES = ROOT / "assets" / "img" / "bottles"


# --------------------------------------------------------------- العبوة كصورة

def bottle_image(ml: int, height_px: int) -> Image.Image:
    """عبوة شفافة بالارتفاع المطلوب تمامًا."""
    BOTTLES.mkdir(parents=True, exist_ok=True)
    height_px = int(height_px)
    svg, sw, sh = bottle_svg(ml, transparent=True)
    svg_path = SVG_OUT / f"bottle-{ml}ml-transparent.svg"
    svg_path.write_text(svg, encoding="utf-8")

    width_px = max(40, int(round(height_px * sw / sh)))
    target = BOTTLES / f"bottle-{ml}ml-h{height_px}.png"
    if not target.exists():
        subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "render_svg.py"), str(svg_path),
             "--width", str(width_px), "--outdir", str(BOTTLES)],
            check=True, capture_output=True,
        )
        produced = BOTTLES / f"bottle-{ml}ml-transparent.png"
        img = Image.open(produced).convert("RGBA").resize((width_px, height_px), Image.LANCZOS)
        img.save(target, "PNG")
        produced.unlink(missing_ok=True)
    return Image.open(target).convert("RGBA")


def shade_bottle(img: Image.Image, light_from_right: bool = True) -> Image.Image:
    """
    إضافة تظليل جهة الظل (يمين أو يسار) ليبدو متوافقًا مع اتجاه الضوء في الخلفية.
    """
    w, h = img.size
    grad = np.zeros((h, w, 4), dtype=np.float32)
    x = np.linspace(0, 1, w)[None, :]
    if light_from_right:
        factor = np.clip((x - 0.55) / 0.45, 0, 1) ** 1.4  # ظل على اليمين
    else:
        factor = np.clip((0.45 - x) / 0.45, 0, 1) ** 1.4
    alpha = np.asarray(img)[..., 3].astype(np.float32) / 255.0
    dark = factor * 0.30 * alpha
    base = np.asarray(img).astype(np.float32)
    base[..., 0] *= (1 - dark)
    base[..., 1] *= (1 - dark * 0.98)
    base[..., 2] *= (1 - dark * 0.94)
    return Image.fromarray(np.clip(base, 0, 255).astype(np.uint8), "RGBA")


def contact_shadow(base: Image.Image, x: int, y: int, w: int, h: int,
                   intensity: float = 0.34, spread: float = 1.0,
                   skew: int = 0) -> Image.Image:
    """ظل ارتكاز + ظل اتجاهي خفيف."""
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    cx = x + w / 2
    cy = y + h - max(2, h * 0.006)
    rx = int(w * 0.66 * spread)
    ry = max(8, int(w * 0.10 * spread))
    d.ellipse([cx - rx + skew, cy - ry, cx + rx + skew, cy + ry],
              fill=(72, 56, 38, int(255 * intensity)))
    layer = layer.filter(ImageFilter.GaussianBlur(radius=max(8, w * 0.06)))
    return Image.alpha_composite(base, layer)


def grade(img: Image.Image) -> Image.Image:
    arr = np.asarray(img.convert("RGB")).astype(np.float32) / 255.0
    arr = np.clip((arr - 0.5) * 1.04 + 0.5, 0, 1)
    arr[..., 0] *= 1.006
    arr[..., 2] *= 0.994
    return Image.fromarray((np.clip(arr, 0, 1) * 255).astype(np.uint8))


# --------------------------------------------------------------- التركيب

def scene(plate_file: str, place, out_name: str, size=None) -> Path:
    """
    place: قائمة من (ml, height_ratio, cx_ratio, bottom_ratio)
    """
    plate = Image.open(PLATES / plate_file).convert("RGBA")
    if size:
        plate = plate.resize(size, Image.LANCZOS)
    W, H = plate.size

    # رتّب من الأكبر للأصغر نزولًا حسب الارتفاع (الأبعد يُرسم أولًا)
    items = []
    for ml, hr, cxr, brr in place:
        bh = int(H * hr)
        img = shade_bottle(bottle_image(ml, bh))
        items.append((img, int(W * cxr - img.width / 2), int(H * brr - img.height)))

    for img, x, y in items:
        plate = contact_shadow(plate, x, y, img.width, img.height,
                               intensity=0.30 if len(items) > 1 else 0.34)

    layer = Image.new("RGBA", plate.size, (0, 0, 0, 0))
    for img, x, y in items:
        layer.paste(img, (x, y), img)
    out = Image.alpha_composite(plate, layer)
    out = grade(out)

    RAW.mkdir(parents=True, exist_ok=True)
    target = RAW / out_name
    out.save(target, "PNG")
    print("composed:", target.name, out.size)
    return target


def detail_crop(src_name: str, out_name: str, box_ratio=(0.30, 0.28, 0.72, 0.76),
                size=(1200, 1200)) -> Path:
    """مقربة من الملصق والغطاء بقصّ مركزي عالي الدقة."""
    src = Image.open(RAW / src_name).convert("RGB")
    W, H = src.size
    box = (int(W * box_ratio[0]), int(H * box_ratio[1]),
           int(W * box_ratio[2]), int(H * box_ratio[3]))
    crop = src.crop(box).resize(size, Image.LANCZOS)
    crop = grade(crop)
    target = RAW / out_name
    crop.save(target, "PNG")
    print("cropped:", target.name, crop.size)
    return target


def side_view(ml: int, out_name: str, size=(900, 1200)) -> Path:
    """
    منظر جانبي تقريبي: الأسطوانة عند دوران بسيط تبدو أضيق (ضغط أفقي).
    تقدير هندسي لا يُغني عن تصوير حقيقي.
    """
    plate = Image.open(PLATES / "texture-ledge-square.jpg").convert("RGBA").resize(size, Image.LANCZOS)
    W, H = plate.size
    bh = int(H * 0.46)
    img = bottle_image(ml, bh)
    compressed = img.resize((int(img.width * 0.74), img.height), Image.LANCZOS)
    compressed = shade_bottle(compressed, light_from_right=True)
    x = int(W * 0.52 - compressed.width / 2)
    y = int(H * 0.795 - compressed.height)
    plate = contact_shadow(plate, x, y, compressed.width, compressed.height)
    layer = Image.new("RGBA", plate.size, (0, 0, 0, 0))
    layer.paste(compressed, (x, y), compressed)
    out = grade(Image.alpha_composite(plate, layer))
    target = RAW / out_name
    out.save(target, "PNG")
    print("composed:", target.name, out.size)
    return target


def back_view(ml: int, out_name: str, size=(900, 1200)) -> Path:
    """منظر خلفي يوضح ظهر الملصق وحقوله الفارغة."""
    plate = Image.open(PLATES / "texture-tall.jpg").convert("RGBA").resize(size, Image.LANCZOS)
    W, H = plate.size
    svg, sw, sh = bottle_svg(ml, transparent=True, back_label=True)
    p = SVG_OUT / f"bottle-{ml}ml-back.svg"
    p.write_text(svg, encoding="utf-8")
    bh = int(H * 0.48)
    width = int(round(bh * sw / sh))
    BOTTLES.mkdir(parents=True, exist_ok=True)
    subprocess.run([sys.executable, str(ROOT / "scripts" / "render_svg.py"), str(p),
                    "--width", str(width), "--outdir", str(BOTTLES)],
                   check=True, capture_output=True)
    prod = BOTTLES / f"bottle-{ml}ml-back.png"
    img = Image.open(prod).convert("RGBA").resize((width, bh), Image.LANCZOS)
    prod.unlink(missing_ok=True)

    x = int(W * 0.50 - width / 2)
    y = int(H * 0.80 - bh)
    plate = contact_shadow(plate, x, y, width, bh)
    layer = Image.new("RGBA", plate.size, (0, 0, 0, 0))
    layer.paste(img, (x, y), img)
    out = grade(Image.alpha_composite(plate, layer))
    target = RAW / out_name
    out.save(target, "PNG")
    print("composed:", target.name, out.size)
    return target


def main() -> int:
    # 1) الأفقية الواسعة (القسم الرئيسي)
    scene("texture-hero.jpg", [(50, 0.70, 0.735, 0.860)], "hero-wide.png")

    # 2) الثلاثة معًا
    scene("texture-hero.jpg", [
        (100, 0.56, 0.60, 0.862),
        (50, 0.50, 0.475, 0.860),
        (30, 0.42, 0.375, 0.858),
    ], "trio-wide.png")

    # 3) صورة لكل حجم (مربعة — بطاقات المنتجات) على حافة أفقية
    for ml, hr in ((30, 0.60), (50, 0.66), (100, 0.72)):
        scene("texture-ledge-square.jpg", [(ml, hr, 0.50, 0.795)], f"size-{ml}.png")

    # 4) تحريرية عمودية
    scene("texture-tall.jpg", [(50, 0.46, 0.50, 0.800)], "editorial-portrait.png")

    # 5) أفقية للعبوة الكبيرة
    scene("texture-hero.jpg", [(100, 0.64, 0.70, 0.862)], "wide-100.png")

    # 6) سوشيال مربع + عمودي
    scene("texture-ledge-square.jpg", [(100, 0.66, 0.53, 0.795)], "social-square.png")
    scene("texture-tall.jpg", [(50, 0.42, 0.50, 0.795)], "social-vertical.png")

    # 7) مقربة من الملصق والغطاء
    detail_crop("editorial-portrait.png", "detail-label.png",
                box_ratio=(0.31, 0.29, 0.70, 0.72), size=(1200, 1200))

    # 8) منظر جانبي تقريبي + منظر خلفي
    side_view(50, "side-50.png")
    back_view(50, "back-50.png")
    return 0


if __name__ == "__main__":
    sys.exit(main())
