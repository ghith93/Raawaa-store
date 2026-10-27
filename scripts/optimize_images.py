#!/usr/bin/env python3
"""
RAWAA | رواء — خط تحسين الصور للويب.

من النسخ الأصلية عالية الدقة (assets/img/design-raw) ينتج:
  • AVIF و WebP و JPEG احتياطي بأحجام مناسبة للشاشات.
  • عرضًا أقصى مضبوطًا لكل نوع صورة (Hero / بطاقة / سوشيال).
  • تنظيف الملفات القديمة قبل البناء.

الاستخدام: python3 scripts/optimize_images.py
"""
from __future__ import annotations

import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "assets" / "img" / "design-raw"
OUT = ROOT / "assets" / "img" / "products"

# اسم الأصل: (العرض الأكبر المستهدف)
PLAN = {
    "hero-wide.png": 1600,
    "trio-wide.png": 1400,
    "wide-100.png": 1400,
    "size-30.png": 900,
    "size-50.png": 900,
    "size-100.png": 900,
    "editorial-portrait.png": 900,
    "social-square.png": 1080,
    "social-vertical.png": 1080,
    "detail-label.png": 900,
    "side-50.png": 900,
    "back-50.png": 900,
}

# عرض مخصص أصغر للهواتف
WIDTHS = [480, 720, 1080, 1400, 1600]


WIDTHS = [480, 720, 1080, 1400, 1600]


def widths_for(max_w: int) -> list[int]:
    """عروض أصغر من الحد الأقصى + الحد الأقصى نفسه، بلا تكرار."""
    ws = {w for w in WIDTHS if w < max_w}
    ws.add(max_w)
    return sorted(ws)


def build() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*"):
        old.unlink()

    manifest: dict[str, dict] = {}

    for name, max_w in PLAN.items():
        src = RAW / name
        if not src.exists():
            print(f"! missing raw: {name}")
            continue
        img = Image.open(src).convert("RGB")
        base = name.replace(".png", "")

        entries = []
        cap = min(max_w, img.width)
        for w in sorted({min(x, cap) for x in widths_for(cap)}):
            if w < 200:
                continue
            h = round(img.height * w / img.width)
            resized = img.resize((w, h), Image.LANCZOS)

            avif = OUT / f"{base}-{w}.avif"
            webp = OUT / f"{base}-{w}.webp"
            resized.save(avif, "AVIF", quality=52, speed=4)
            resized.save(webp, "WEBP", quality=76, method=6)
            entries.append({
                "width": w,
                "height": h,
                "avif": avif.name,
                "webp": webp.name,
                "bytes": {"avif": avif.stat().st_size, "webp": webp.stat().st_size},
            })

        # JPEG احتياطي بالعرض الأوسط
        mid = entries[len(entries) // 2]
        jpg = OUT / f"{base}-{mid['width']}.jpg"
        img.resize((mid["width"], mid["height"]), Image.LANCZOS).save(
            jpg, "JPEG", quality=82, optimize=True, progressive=True
        )
        mid["jpg"] = jpg.name

        manifest[base] = {
            "aspect": round(img.width / img.height, 4),
            "sizes": entries,
            "fallback": mid["jpg"],
            "fallbackWidth": mid["width"],
        }
        total = sum(e["bytes"]["webp"] for e in entries)
        print(f"{base:22s} {len(entries)} sizes · webp total {total//1024}KB")

    (OUT / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    grand = sum(p.stat().st_size for p in OUT.glob("*") if p.suffix in {".webp", ".avif", ".jpg"})
    print(f"\ntotal output: {grand//1024} KB in {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(build())
