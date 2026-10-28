#!/usr/bin/env python3
"""
RAWAA — تغيير عنوان الموقع المنشور في كل مكان بأمر واحد.

يستخدمه: الانتقال من GitHub Pages إلى Cloudflare Pages (أو العكس)، أو ربط
نطاق مخصص مستقبلًا. يضمن ألا يبقى رابط قديم في canonical أو og:url أو
sitemap أو robots أو رمز QR.

الاستخدام:
    python3 scripts/set-site-url.py https://rawaa.pages.dev/
    python3 scripts/set-site-url.py --check        # يعرض الحالة الحالية
"""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# الملفات التي تحمل العنوان المطلق، وكيف نستبدل فيه
TARGETS = [
    "index.html",
    "privacy.html",
    "sitemap.xml",
    "robots.txt",
    "scripts/make_qr.py",
    "scripts/check-site.mjs",
]

# كل عناوين الموقع التي قد تكون موجودة (للتنظيف الشامل)
KNOWN = [
    "https://ghith93.github.io/Raawaa-store",
    "https://ghith93.github.io/rawaa-store",
    "https://rawaa.pages.dev",
]


def current() -> dict[str, str]:
    """يستخرج العنوان الحالي من canonical في index.html."""
    index = (ROOT / "index.html").read_text(encoding="utf-8")
    canon = re.search(r'<link rel="canonical" href="([^"]+)"', index)
    og = re.search(r'<meta property="og:url" content="([^"]+)"', index)
    return {
        "canonical": canon.group(1) if canon else "(غير موجود)",
        "og:url": og.group(1) if og else "(غير موجود)",
    }


def normalize(url: str) -> str:
    url = url.strip().rstrip("/")
    if not url.startswith(("http://", "https://")):
        sys.exit("✗ يجب أن يبدأ العنوان بـ https://")
    return url


def main() -> int:
    if len(sys.argv) < 2 or sys.argv[1] in ("--check", "-c"):
        cur = current()
        print("العنوان الحالي:")
        for k, v in cur.items():
            print(f"  {k:12s} {v}")
        if cur["canonical"] != cur["og:url"] + "/" and cur["canonical"] != cur["og:url"]:
            print("  ⚠️ تحذير: canonical و og:url غير متطابقين")
        return 0

    new = normalize(sys.argv[1])
    changed: list[str] = []

    for rel in TARGETS:
        path = ROOT / rel
        if not path.is_file():
            continue
        text = path.read_text(encoding="utf-8")
        original = text
        for old in KNOWN:
            text = text.replace(old, new)
        if text != original:
            path.write_text(text, encoding="utf-8")
            n = sum(original.count(old) for old in KNOWN)
            changed.append(f"{rel} ({n} استبدال)")

    if not changed:
        print("لم يُعثر على عنوان قديم — لا تغيير.")
        return 1

    print(f"✓ العنوان الجديد: {new}")
    for c in changed:
        print("  •", c)

    # أعِد توليد رمز QR ليطابق العنوان الجديد
    qr = ROOT / "scripts" / "make_qr.py"
    if qr.is_file():
        print("\nإعادة توليد رمز QR…")
        r = subprocess.run([sys.executable, str(qr)], cwd=ROOT, capture_output=True, text=True)
        print(r.stdout.strip() or r.stderr.strip())

    print("\nالخطوة التالية: python3 scripts/push-to-github.py \"نقل العنوان إلى \" " + new)
    return 0


if __name__ == "__main__":
    sys.exit(main())
