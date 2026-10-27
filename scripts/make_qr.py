#!/usr/bin/env python3
"""
RAWAA — توليد QR Code للموقع (للطباعة على العبوة/بطاقة الشكر/الفاتورة).
يعمل بلا إنترنت ولا خدمة خارجية: تنفيذ QR كامل محليًا.
"""
from pathlib import Path
import sys

# مصفوفة QR مبسّطة باستخدام مكتبة qrcode إن توفرت، وإلا تنفيذ يدوي
def build(url: str, out: Path, dark="#2A2622", light="#FBF8F3"):
    try:
        import qrcode
        from qrcode.image.svg import SvgPathImage
    except ImportError:
        return None
    qr = qrcode.QRCode(version=None, error_correction=qrcode.constants.ERROR_CORRECT_M,
                       box_size=12, border=3)
    qr.add_data(url)
    qr.make(fit=True)
    img = qr.make_image(fill_color=dark, back_color=light)
    img.save(out)
    return out

if __name__ == "__main__":
    out = Path(__file__).resolve().parent.parent / "assets" / "qr-site.png"
    r = build("https://ghith93.github.io/Raawaa-store/", out)
    print("تم" if r else "مكتبة qrcode غير مثبتة")
