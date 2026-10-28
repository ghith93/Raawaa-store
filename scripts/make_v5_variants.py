#!/usr/bin/env python3
"""
RAWAA — توليد كل المقاسات والأصيغة من الصور المصحّحة (v5).

الصور v5 وُلِّدت بمقاس واحد. لكن الهيرو يطلب 1600px، والبطاقة تطلب 900px،
والصفحة تحمّل 480px على الهاتف. بلا هذا السكربت، المتصفح يكبّر صورة صغيرة
فيبدو المنتج ناعمًا/مشوّشًا على سطح المكتب.
"""
from __future__ import annotations
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "img" / "products"

# مفتاح v5 → (أقصى عرض مطلوب في الصفحة)
TARGETS = {
    "hero-wide": 1600,
    "trio": 1400,
    "size-30": 900,
    "size-50": 900,
    "size-100": 900,
    "editorial": 900,
    "detail-label": 900,
}
WIDTHS = [480, 720, 1080, 1400, 1600]


def main() -> None:
    made = 0
    for base, cap in TARGETS.items():
        src = SRC / f"{base}-v5-{1080 if base in ('hero-wide', 'trio') else 720}.jpg"
        if not src.exists():
            print("مفقود:", src.name)
            continue
        img = Image.open(src).convert("RGB")
        real_cap = min(cap, img.width)
        for w in sorted({min(x, real_cap) for x in WIDTHS if x <= real_cap} | {real_cap}):
            if w < 400:
                continue
            h = round(img.height * w / img.width)
            rs = img.resize((w, h), Image.LANCZOS)
            # AVIF و WebP و JPEG — نفس ما يتوقعه config.js
            for ext, kw in (("avif", dict(quality=62)), ("webp", dict(quality=82, method=6)), ("jpg", dict(quality=86, subsampling=1))):
                out = SRC / f"{base}-v5-{w}.{ext}"
                rs.save(out, **kw)
                made += 1
        print(f"✓ {base}: {real_cap}px · {img.width}x{img.height}")
    print(f"\nإجمالي الملفات: {made}")


if __name__ == "__main__":
    main()
