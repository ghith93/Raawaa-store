#!/usr/bin/env python3
"""
RAWAA — توليد رمز QR للموقع (للطباعة على العبوة أو بطاقة الشكر أو الفاتورة).

يُنتج نسختين:
  assets/qr-site.png  — 1200 بكسل، صالح للطباعة حتى ~10 سم بوضوح
  assets/qr-site.svg  — متجه، صالح لأي مقاس دون تحبّب

التصحيح: مستوى H (30%) — يتحمل خدشًا أو انعكاس ضوء على العبوة، وهو ما لا
يفعله المستوى M. لا يعتمد على أي خدمة خارجية.

الاستخدام: python3 scripts/make_qr.py [عنوان]
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_URL = "https://raawaa-store.pages.dev/"
DARK = "#231F1B"
IVORY = "#FBF8F3"


def main() -> int:
    try:
        import qrcode
        import qrcode.image.svg
    except ImportError:
        print("✗ مكتبة qrcode غير مثبتة: pip install qrcode[pil]")
        return 1

    url = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_URL

    def make(**kw):
        qr = qrcode.QRCode(
            version=None,
            error_correction=qrcode.constants.ERROR_CORRECT_H,  # 30% — متين للطباعة
            box_size=kw.pop("box_size", 20),
            border=kw.pop("border", 3),
            image_factory=kw.pop("image_factory", None),
        )
        qr.add_data(url)
        qr.make(fit=True)
        return qr.make_image(fill_color=DARK, back_color=IVORY)

    png_path = ROOT / "assets" / "qr-site.png"
    img = make(box_size=20)
    img.save(png_path)

    svg_path = ROOT / "assets" / "qr-site.svg"
    svg = make(box_size=20, image_factory=qrcode.image.svg.SvgPathImage)
    svg.save(svg_path)

    from PIL import Image
    im = Image.open(png_path)
    print(f"✓ {png_path.name} — {im.size[0]}×{im.size[1]} · {png_path.stat().st_size/1024:.1f} KB")
    print(f"✓ {svg_path.name} — {svg_path.stat().st_size/1024:.1f} KB")
    print(f"  العنوان: {url}")
    print(f"  التصحيح: H (30%) — مقروء حتى لو خُدش جزئيًا")
    return 0


if __name__ == "__main__":
    sys.exit(main())
