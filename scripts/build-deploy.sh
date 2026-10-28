#!/usr/bin/env bash
# RAWAA — تجميع مجلد النشر.
# ينسخ ملفات الموقع فقط إلى dist/site — بلا سكربتات ولا وثائق ولا .git.
# الهدف: أن يُرفع إلى Cloudflare ما يحتاجه الزائر حصرًا.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/dist/site"

rm -rf "$OUT"
mkdir -p "$OUT"

# 1) ملفات الجذر التي يطلبها المتصفح
for f in index.html privacy.html 404.html manifest.webmanifest sw.js robots.txt sitemap.xml _headers _redirects .nojekyll; do
  [ -f "$ROOT/$f" ] && cp "$ROOT/$f" "$OUT/"
done

# 2) مجلدات الموقع
for d in css js assets; do
  [ -d "$ROOT/$d" ] && cp -R "$ROOT/$d" "$OUT/"
done

# 3) تنظيف ما لا يخص الزائر
rm -rf "$OUT/assets/img/design-raw" "$OUT/assets/img/design-raw-reference.png" 2>/dev/null || true
# ملفات المصدر الخام للصور لا تُنشر — فقط المشتقات المُحسَّنة
rm -rf "$OUT/assets/img/source" 2>/dev/null || true

# احذف الخطوط غير المرجعية من @font-face — 325 KB كان يُنشر بلا سبب
for f in assets/fonts/*.woff2; do
  b=$(basename "$f")
  case " almarai-400-latin.subset.woff2 almarai-400.subset.woff2 almarai-700-latin.subset.woff2 almarai-700.subset.woff2 amiri-400-latin.subset.woff2 amiri-400.subset.woff2 cormorant-500-latin.subset.woff2 " in
    *" $b "*) ;;
    *) rm -f "$OUT/assets/fonts/$b" ;;
  esac
done
find "$OUT" -name "*.map" -delete 2>/dev/null || true

# لوحة الهوية: ملف مرجعي للمالك، لا يطلبه أي زائر (755 KB)
rm -f "$OUT/assets/brand/brand-board.png" "$OUT/assets/brand/brand-board.svg" 2>/dev/null || true

# الخطوط: نُبقي فقط ما تشير إليه CSS فعليًا (المجسّمة بـ subset)
python3 - "$OUT" <<'PYEOF'
import re, sys
from pathlib import Path
out = Path(sys.argv[1])
css = (out / "css/styles.css").read_text(encoding="utf-8")
used = set(re.findall(r'fonts/([A-Za-z0-9_.\-]+\.woff2)', css))
fdir = out / "assets" / "fonts"
if fdir.is_dir():
    for f in fdir.glob("*.woff2"):
        if f.name not in used:
            f.unlink()
print(f"  خطوط مُبقاة: {len(used)} · محذوفة: {len(list(fdir.glob('*.woff2')))} متبقٍ")
PYEOF

# 4) تقرير
COUNT=$(find "$OUT" -type f | wc -l)
SIZE=$(du -sh "$OUT" | cut -f1)
echo "✓ dist/site — $COUNT ملفًا · $SIZE"
echo "  الأكبر:"
python3 - "$OUT" <<'PYEOF'
import sys, os
from pathlib import Path
out = Path(sys.argv[1])
files = sorted(((f.stat().st_size, f) for f in out.rglob('*') if f.is_file()), reverse=True)
for size, f in files[:5]:
    print(f"    {size/1024:7.1f} KB  {f.relative_to(out)}")
PYEOF

# ── ضغط CSS في حزمة النشر فقط (المصدر يبقى مقروءًا للمراجعة) ──
python3 - <<'MINEOF'
import re, gzip
from pathlib import Path
src = Path("css/styles.css")
dst = Path("dist/site/css/styles.css")
if src.is_file() and dst.is_file():
    css = src.read_text(encoding="utf-8")
    out, i, n = [], 0, len(css)
    while i < n:
        c = css[i]
        if c == "/" and i + 1 < n and css[i + 1] == "*":
            j = css.find("*/", i + 2); i = n if j < 0 else j + 2; continue
        if c in "\"'":
            j = i + 1
            while j < n and css[j] != c:
                j += 2 if css[j] == "\\" else 1
            out.append(css[i:j + 1]); i = j + 1; continue
        out.append(c); i += 1
    s = "".join(out)
    s = re.sub(r"\s+", " ", s)
    s = re.sub(r"\s*([{}:;,>])\s*", r"\1", s).replace(";}", "}")
    dst.write_text(s, encoding="utf-8")
    before, after = len(css.encode()), len(s.encode())
    print(f"  CSS مضغوط: {before//1024} KB → {after//1024} KB (gzip {len(gzip.compress(s.encode(), 9))//1024} KB)")
MINEOF
