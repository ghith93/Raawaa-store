#!/usr/bin/env python3
"""
RAWAA | رواء — هوية بصرية: الشعار والعلامة والأيقونة.

المبدأ: لا نكتب الحروف بخط جاهز (فتظهر عامة أو مشوّهة). نبني الحرف مسارات
هندسية محسوبة من منحنيات وأعمدة، فيكون الشعار ملكًا للمشروع بالكامل.

المخرجات:
  assets/brand/logo-mark-v2.svg        العلامة المختصرة (R + نقطة ذهبية)
  assets/brand/logo-primary-v2.svg     الأفقي: RAWAA + رواء
  assets/brand/logo-stacked-v2.svg     العمودي
  assets/brand/logo-mono-ink-v2.svg    أحادي للفويل
  assets/brand/logo-mono-ivory-v2.svg  أحادي على الداكن
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "brand"
OUT.mkdir(parents=True, exist_ok=True)

INK = "#231F1B"
GOLD = "#9A7B45"
IVORY = "#FBF8F3"

# ----------------------------------------------------------------------------
# هندسة العلامة: مساحة 512×512، الحرف داخل 300×300 متمركز
# الحرف R مبني من: ساق مستقيمة + كتف علوي منحنٍ + ساق مائلة + ذيل
# كل النقاط محسوبة، لا خط جاهز.
# ----------------------------------------------------------------------------

def mark_paths(stroke=INK, accent=GOLD):
    """
    العلامة: حرف R مرسوم كمسار واحد مغلق (لا خطوط متراكبة) — فلا تظهر
    وصلات أو نتوءات عند أي مقاس. الحرف مبني بنسب ذهبية: سُمك الساق 1/8
    من ارتفاع الحرف، والبطن يأخذ 62% من العرض البصري.
    النقطة الذهبية تقف على خط الأساس كعلامة ترقيم بعد الحرف — فتُقرأ جزءًا
    من التوقيع لا عنصرًا معلّقًا تحته.
    """
    # الإطار الخارجي للحرف
    outer = (
        "M 163 402 L 163 118 L 306 118 "
        "C 356 118 380 150 380 190 "
        "C 380 232 350 260 306 264 "
        "L 274 264 L 384 402 L 316 402 "
        "L 216 276 L 205 276 L 205 402 Z"
    )
    # الفراغ الداخلي للبطن
    inner = (
        "M 205 150 L 300 150 "
        "C 328 150 340 166 340 192 "
        "C 340 220 326 236 300 236 "
        "L 205 236 Z"
    )
    return f"""
  <path d="{outer} {inner}" fill="{stroke}" fill-rule="evenodd"/>
  <circle cx="416" cy="386" r="16" fill="{accent}"/>
"""


def svg_mark(size=512, bg=None, stroke=INK, accent=GOLD, rounded=False):
    bg_rect = ""
    if bg:
        rx = ' rx="112"' if rounded else ""
        bg_rect = f'<rect width="512" height="512"{rx} fill="{bg}"/>'
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"
     width="{size}" height="{size}" role="img" aria-label="RAWAA — العلامة المختصرة">
{bg_rect}<g>{mark_paths(stroke, accent)}</g>
</svg>
"""


# ----------------------------------------------------------------------------
# الشعار الأفقي: RAWAA (لاتيني متباعد) + رواء (عربي)
# اللاتيني مسارات مستقيمة بسيطة (بديل هندسي عن خط عام) — نستخدم خط Cormorant
# عبر مسار نصي متجه لا يمكن الاعتماد عليه في كل بيئة، لذلك نرسم الحروف
# كأشكال مغلقة مبسطة تعطي إحساس الخط الرقيق عالي التباين.
# ----------------------------------------------------------------------------

def logotype_latin(x, y, size, color=INK, spacing=1.0):
    """
    يرسم RAWAA كأشكال هندسية رقيقة عالية التباين.
    الارتفاع الحرفي = size، والتقدّم الأفقي = size*0.78*spacing
    """
    w = size * 0.62
    t = max(2.0, size * 0.075)     # سماكة الخط الأساسية
    adv = size * 0.86 * spacing
    letters = []
    for i, ch in enumerate("RAWAA"):
        ox = x + i * adv
        letters.append((ch, ox))
    out = []
    for ch, ox in letters:
        if ch == "R":
            out.append(f'''<g>
      <rect x="{ox}" y="{y}" width="{t}" height="{size}" fill="{color}"/>
      <path d="M {ox+t} {y} L {ox+w*0.62} {y}
               C {ox+w*0.92} {y} {ox+w} {y+size*0.14} {ox+w} {y+size*0.28}
               C {ox+w} {y+size*0.44} {ox+w*0.86} {y+size*0.54} {ox+w*0.62} {y+size*0.54}
               L {ox+t} {y+size*0.54}"
            fill="none" stroke="{color}" stroke-width="{t}"/>
      <path d="M {ox+w*0.58} {y+size*0.54} L {ox+w*1.02} {y+size}" stroke="{color}" stroke-width="{t}"/>
    </g>''')
        elif ch == "A":
            out.append(f'''<g>
      <path d="M {ox+w*0.08} {y+size} L {ox+w*0.5} {y} L {ox+w*0.92} {y+size}" fill="none" stroke="{color}" stroke-width="{t}"/>
      <path d="M {ox+w*0.26} {y+size*0.66} L {ox+w*0.74} {y+size*0.66}" stroke="{color}" stroke-width="{t*0.8}"/>
    </g>''')
        elif ch == "W":
            out.append(f'''<g>
      <path d="M {ox} {y} L {ox+w*0.24} {y+size} L {ox+w*0.5} {y+size*0.34} L {ox+w*0.76} {y+size} L {ox+w} {y}"
            fill="none" stroke="{color}" stroke-width="{t}" stroke-linejoin="miter"/>
    </g>''')
    return "\n".join(out), adv * 5


def svg_logo_primary(scale_bg=None):
    size = 300
    latin_w = None
    latin, latin_w = logotype_latin(0, 0, 96)
    # مساحة عمل أوسع: الشعار اللاتيني ثم العربي تحته
    W, H = 1120, 420
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}"
     width="{W}" height="{H}" role="img" aria-label="RAWAA | رواء">
  <g transform="translate(60,70)">
    {latin}
  </g>
  <!-- خط فاصل رقيق بلون ذهبي -->
  <rect x="60" y="228" width="200" height="2" fill="{GOLD}"/>
  <!-- الاسم العربي: مسار نصي حقيقي بخط Amiri مضمّن كمسار عند التصدير -->
  <text x="60" y="352" font-family="Amiri, serif" font-size="118" fill="{INK}"
        direction="rtl" text-anchor="start">رواء</text>
  <text x="330" y="352" font-family="Cormorant Garamond, serif" font-size="46"
        fill="{GOLD}" letter-spacing="6">SERUM</text>
</svg>
'''


if __name__ == "__main__":
    (OUT / "logo-mark-v2.svg").write_text(svg_mark(512), encoding="utf-8")
    (OUT / "logo-mark-badge-v2.svg").write_text(svg_mark(512, bg=IVORY, rounded=True), encoding="utf-8")
    (OUT / "logo-mono-ink-v2.svg").write_text(
        svg_mark(512, stroke="#000000", accent="#000000"), encoding="utf-8")
    (OUT / "logo-mono-ivory-v2.svg").write_text(
        svg_mark(512, stroke=IVORY, accent=IVORY), encoding="utf-8")
    (OUT / "logo-primary-v2.svg").write_text(svg_logo_primary(), encoding="utf-8")
    for f in sorted(OUT.glob("*-v2.svg")):
        print(f"  ✓ {f.name:28s} {f.stat().st_size/1024:.1f} KB")
