#!/usr/bin/env python3
"""
RAWAA | رواء — مولّد صور المنتج (النسخة ٢).

الفخامة تُصنع بالضوء: تدرّج أسطواني على الزجاج، بريق رفيع، ظل متدرّج، انعكاس
على السطح، حبيبات خفيفة. كل ذلك محسوب رياضيًا بلا أي خدمة خارجية.

الدرس من النسخة الأولى: كان الكتف مثلثًا حادًا والغطاء يُقصّ لأن العبوة أطول
من المشهد. الآن: الكتف منحنى مُعايّن بنقاط، والمشهد ي scaling كل عبوة لتناسب.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter
import math

ROOT = Path(__file__).resolve().parent.parent
# النسخ عالية الدقة تُولَّد محليًا ولا تُحفظ في المستودع (تُستبعدها .gitignore).
# لإعادة توليدها: python3 scripts/make_product_imagery.py
# ثم تحسينها للويب:  python3 scripts/optimize_images.py
RAW = ROOT / "assets" / "img" / "design-raw"
RAW.mkdir(parents=True, exist_ok=True)

INK = (35, 31, 27)
GOLD = (154, 123, 69)
AMBER_LIT = (206, 148, 84)
AMBER_MID = (170, 110, 55)
AMBER_DEEP = (112, 66, 31)
CAP_COL = (37, 33, 30)

SS = 3  # supersampling


# --------------------------------------------------------------------------
# أدوات
# --------------------------------------------------------------------------

def vgrad(size, top, bottom):
    w, h = size
    strip = Image.new("RGB", (1, h))
    d = ImageDraw.Draw(strip)
    for y in range(h):
        t = y / max(1, h - 1)
        d.point((0, y), tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))
    return strip.resize((w, h), Image.BILINEAR)


def glow(size, center, radius, color, strength=1.0):
    w, h = size
    m = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(m)
    steps = 48
    for i in range(steps, 0, -1):
        t = i / steps
        r = radius * t
        d.ellipse([center[0] - r, center[1] - r * 0.92,
                   center[0] + r, center[1] + r * 0.92],
                  fill=int(255 * (1 - t) ** 2 * strength))
    m = m.filter(ImageFilter.GaussianBlur(radius * 0.14))
    layer = Image.new("RGBA", (w, h), color + (0,))
    layer.putalpha(m)
    return layer


def grain(img, amount=3.2):
    w, h = img.size
    n = Image.effect_noise((w, h), 26).convert("L").filter(ImageFilter.GaussianBlur(0.5))
    return Image.blend(img.convert("RGB"), Image.merge("RGB", (n, n, n)), amount / 100)


def shoulder_points(x0, x1, nx0, nx1, y_body, y_neck, steps=48):
    """
    منحنى الكتف: من حافة العنق الضيقة إلى عرض الجسم الكامل.
    نستخدم منحنى جيبي معكوس (ease-out) فيبدو كزجاج مصبوب لا كمثلث.
    """
    pts_left, pts_right = [], []
    for i in range(steps + 1):
        t = i / steps
        ease = 1 - (1 - t) ** 2.6          # ينفتح بسرعة ثم يستوي
        y = y_neck + (y_body - y_neck) * t
        lx = nx0 + (x0 - nx0) * ease
        rx = nx1 + (x1 - nx1) * ease
        pts_left.append((lx, y))
        pts_right.append((rx, y))
    return pts_left, pts_right


def bottle_mask(w, h, geo):
    """قناع شكل العبوة الكامل — مصدر كل شيء: القص، الظل، الانعكاس."""
    m = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(m)

    bx0, bx1 = geo["bx0"], geo["bx1"]
    cap_x0, cap_x1 = geo["cap_x0"], geo["cap_x1"]
    neck_x0, neck_x1 = geo["neck_x0"], geo["neck_x1"]
    cap_top, cap_bot = geo["cap_top"], geo["cap_bot"]
    y_neck, y_body, y_bot = geo["y_neck"], geo["y_body"], geo["y_bot"]
    rad = geo["radius"]

    # 1) جسم الزجاج
    d.rounded_rectangle([bx0, y_body, bx1, y_bot], radius=rad, fill=255)

    # 2) الكتف المنحني — يمتد داخل الجسم لتفادي أي فجوة عند الاستدارة
    overlap = rad + 2
    left, right = shoulder_points(bx0, bx1, neck_x0, neck_x1, y_body + overlap, y_neck)
    poly = left + right[::-1]
    d.polygon(poly, fill=255)

    # 3) العنق — مستطيل بلا استدارة حتى لا يُحدث نتوءًا عند الكتف
    d.rectangle([neck_x0, y_neck - int((y_body - y_neck) * 0.55), neck_x1, y_neck + 2], fill=255)

    # 4) القطّارة (الغطاء)
    d.rounded_rectangle([cap_x0, cap_top, cap_x1, cap_bot],
                        radius=int((cap_x1 - cap_x0) * 0.16), fill=255)
    # حلقة معدنية رقيقة أسفل الغطاء
    d.rectangle([cap_x0 + (cap_x1 - cap_x0) * 0.06, cap_bot - (cap_bot - cap_top) * 0.10,
                 cap_x1 - (cap_x1 - cap_x0) * 0.06, cap_bot], fill=255)
    return m


_TEXT_CACHE = {}

def label_text_image(w, h, size_label="50 ML"):
    """
    يرسم محتوى الملصق: RAWAA (لاتيني متباعد) + رواء + SERUM + الحجم.
    يُنفَّذ عبر Chromium لضمان صحة الحروف العربية (لا تشويه، لا حروف منفصلة).
    """
    key = (w, h, size_label)
    if key in _TEXT_CACHE:
        return _TEXT_CACHE[key]
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        return None

    W, H = w * 2, h * 2
    html = f"""<!doctype html><html dir="rtl"><head><meta charset="utf-8">
<style>
  @font-face {{ font-family:'AmiriX'; src:url('{ (ROOT/"assets/fonts/amiri-400.subset.woff2").as_uri() }') format('woff2'); }}
  @font-face {{ font-family:'CormX'; src:url('{ (ROOT/"assets/fonts/cormorant-500-latin.subset.woff2").as_uri() }') format('woff2'); }}
  *{{margin:0;padding:0;box-sizing:border-box}}
  body{{width:{W}px;height:{H}px;background:transparent;display:flex;flex-direction:column;
        align-items:center;justify-content:center;gap:{int(H*0.035)}px;
        font-family:'CormX',serif;color:#231F1B}}
  .latin{{font-size:{int(W*0.135)}px;letter-spacing:{W*0.028}px;font-weight:600}}
  .rule{{width:{int(W*0.34)}px;height:{max(1,int(H*0.006))}px;background:#9A7B45}}
  .arabic{{font-family:'AmiriX',serif;font-size:{int(W*0.30)}px;line-height:1}}
  .sub{{font-size:{int(W*0.075)}px;letter-spacing:{W*0.010}px;color:#6E6053}}
  .size{{font-size:{int(W*0.105)}px;letter-spacing:{W*0.012}px;margin-top:{int(H*0.03)}px}}
</style></head><body>
  <div class="latin">RAWAA</div>
  <div class="rule"></div>
  <div class="arabic">رواء</div>
  <div class="sub">SERUM</div>
  <div class="size" dir="ltr">{size_label}</div>
</body></html>"""
    tmp = RAW / "_label.html"
    tmp.write_text(html, encoding="utf-8")
    shot = RAW / f"_label-{w}x{h}.png"
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
        pg.goto(tmp.as_uri()); pg.wait_for_timeout(450)
        pg.screenshot(path=str(shot), omit_background=True)
        b.close()
    tmp.unlink(missing_ok=True)
    im = Image.open(shot).convert("RGBA")
    _TEXT_CACHE[key] = im
    return im


def draw_bottle(W=520, H=1400, size_label="50 ML", body_scale=1.0):
    """عبوة كاملة على قماش شفاف بمقاس W×H، الغطاء لا يُقصّ أبدًا."""
    w, h = W * SS, H * SS

    body_w = int(w * 0.66 * body_scale)
    bx0 = (w - body_w) // 2
    bx1 = bx0 + body_w

    cap_h = int(h * 0.150)
    cap_w = int(body_w * 0.34)
    cap_x0 = (w - cap_w) // 2
    cap_x1 = cap_x0 + cap_w
    cap_top = int(h * 0.012)
    cap_bot = cap_top + cap_h

    neck_w = int(body_w * 0.24)
    neck_x0 = (w - neck_w) // 2
    neck_x1 = neck_x0 + neck_w

    y_neck = cap_bot + int(h * 0.012)
    y_body = y_neck + int(h * 0.065)
    y_bot = int(h * 0.988)

    geo = dict(bx0=bx0, bx1=bx1, cap_x0=cap_x0, cap_x1=cap_x1,
               neck_x0=neck_x0, neck_x1=neck_x1, cap_top=cap_top, cap_bot=cap_bot,
               y_neck=y_neck, y_body=y_body, y_bot=y_bot,
               radius=int(body_w * 0.075))

    mask = bottle_mask(w, h, geo)
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))

    # ---- الزجاج: تدرّج أسطواني
    glass = Image.new("RGB", (w, h))
    gd = ImageDraw.Draw(glass)
    for x in range(bx0, bx1 + 1):
        t = (x - bx0) / max(1, body_w - 1)
        shade = max(0.0, math.sin(t * math.pi)) ** 0.55
        k = (1 - shade) * 0.80
        col = tuple(int(AMBER_MID[i] * (1 - k) + AMBER_DEEP[i] * k) for i in range(3))
        if t < 0.10:
            col = tuple(int(c * 0.58) for c in col)
        elif t > 0.92:
            col = tuple(int(c * 0.66) for c in col)
        gd.line([(x, 0), (x, h)], fill=col)

    # إضاءة أعلى (السائل يتلقى الضوء من الأعلى)
    liquid = vgrad((w, h), (216, 160, 96), (146, 88, 40))
    glass = Image.composite(liquid, glass, mask.point(lambda v: int(v * 0.26)))
    img.paste(glass, (0, 0), mask)

    # ---- بريق رأسي رفيع (انعكاس مصدر الضوء)
    hl = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    hd = ImageDraw.Draw(hl)
    hx = bx0 + int(body_w * 0.17)
    hd.rounded_rectangle([hx, y_body + int(h * 0.02), hx + int(body_w * 0.045), y_bot - int(h * 0.03)],
                         radius=int(body_w * 0.02), fill=(255, 248, 236, 120))
    hl = hl.filter(ImageFilter.GaussianBlur(SS * 1.8))
    img = Image.alpha_composite(img, Image.composite(hl, Image.new("RGBA", (w, h), (0, 0, 0, 0)), mask))

    # ---- ظل داخلي على الحافة اليمنى (انحناء)
    edge = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ed = ImageDraw.Draw(edge)
    ed.rounded_rectangle([bx1 - int(body_w * 0.07), y_body, bx1, y_bot],
                         radius=geo["radius"], fill=(48, 24, 8, 95))
    edge = edge.filter(ImageFilter.GaussianBlur(SS * 1.5))
    img = Image.alpha_composite(img, Image.composite(edge, Image.new("RGBA", (w, h), (0, 0, 0, 0)), mask))

    # ---- القطّارة
    cap = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    cd = ImageDraw.Draw(cap)
    cd.rounded_rectangle([cap_x0, cap_top, cap_x1, cap_bot],
                         radius=int(cap_w * 0.16), fill=CAP_COL + (255,))
    # بريق على الغطاء
    cd.rounded_rectangle([cap_x0 + int(cap_w * 0.16), cap_top + int(cap_h * 0.10),
                          cap_x0 + int(cap_w * 0.30), cap_bot - int(cap_h * 0.16)],
                         radius=int(cap_w * 0.06), fill=(104, 97, 89, 165))
    # حلقة ذهبية رفيعة عند قاعدة الغطاء — تفصيل فخم
    cd.rectangle([cap_x0 + int(cap_w * 0.04), cap_bot - int(cap_h * 0.105),
                  cap_x1 - int(cap_w * 0.04), cap_bot - int(cap_h * 0.085)],
                 fill=GOLD + (215,))
    # حزوز الغطاء
    for i in range(4):
        yy = cap_top + int(cap_h * (0.30 + i * 0.10))
        cd.rectangle([cap_x0 + int(cap_w * 0.12), yy, cap_x1 - int(cap_w * 0.12), yy + SS],
                     fill=(16, 14, 12, 150))
    img = Image.alpha_composite(img, cap)

    # ---- الملصق
    lab_w = int(body_w * 0.74)
    lab_x0 = (w - lab_w) // 2
    lab_y0 = y_body + int(h * 0.075)
    lab_h = int(h * 0.255)
    lab = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ld = ImageDraw.Draw(lab)
    ld.rectangle([lab_x0, lab_y0, lab_x0 + lab_w, lab_y0 + lab_h], fill=(250, 247, 240, 255))
    ld.rectangle([lab_x0, lab_y0, lab_x0 + lab_w, lab_y0 + lab_h],
                 outline=(222, 210, 192, 255), width=max(1, SS))
    img = Image.alpha_composite(img, lab)

    inset = int(lab_w * 0.05)
    fr = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(fr).rectangle(
        [lab_x0 + inset, lab_y0 + inset, lab_x0 + lab_w - inset, lab_y0 + lab_h - inset],
        outline=(198, 178, 148, 255), width=max(1, SS))
    img = Image.alpha_composite(img, fr)

    # ---- نص الملصق (يُرسم بـ SVG دقيق لضمان سلامة الحروف العربية)
    lb = (lab_x0 // SS, lab_y0 // SS, lab_w // SS, lab_h // SS)
    txt = label_text_image(lb[2], lb[3], size_label)
    if txt is not None:
        scaled = txt.resize((lab_w, lab_h), Image.LANCZOS)
        img.alpha_composite(scaled, (lab_x0, lab_y0))

    return img.resize((W, H), Image.LANCZOS)


def make_scene(bottles, out_name, W, H, floor_ratio=0.80,
               bg_top=(249, 245, 238), bg_bottom=(229, 219, 203), target_h=0.66):
    canvas = vgrad((W, H), bg_top, bg_bottom).convert("RGBA")
    canvas = Image.alpha_composite(canvas, glow((W, H), (int(W * 0.26), int(H * 0.16)),
                                                int(W * 0.80), (255, 251, 243), 0.9))

    floor_y = int(H * floor_ratio)
    fl = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    fd = ImageDraw.Draw(fl)
    fd.rectangle([0, floor_y, W, H], fill=(224, 213, 196, 255))
    fd.rectangle([0, floor_y, W, floor_y + max(2, int(H * 0.008))], fill=(203, 189, 168, 255))
    canvas = Image.alpha_composite(canvas, fl)

    # تدرّج على السطح (الأمام أغمق قليلًا)
    sh = vgrad((W, H), (255, 255, 255), (188, 172, 150)).convert("RGBA")
    sh.putalpha(58)
    m = Image.new("L", (W, H), 0)
    ImageDraw.Draw(m).rectangle([0, floor_y, W, H], fill=255)
    canvas = Image.alpha_composite(canvas, Image.composite(sh, Image.new("RGBA", (W, H), (0, 0, 0, 0)), m))

    # تحجيم العبوات لتناسب ارتفاع المشهد
    scaled = []
    for b in bottles:
        th = int(H * target_h)
        tw = int(b.width * th / b.height)
        scaled.append(b.resize((tw, th), Image.LANCZOS))

    gap = int(W * 0.045)
    total = sum(b.width for b in scaled) + gap * (len(scaled) - 1)
    x = (W - total) // 2

    for b in scaled:
        base_y = floor_y + int(b.height * 0.012)
        top_y = base_y - b.height
        mask = b.split()[-1]

        # ظل: يُرسم أسفل العبوة على السطح
        sh_layer = Image.new("L", (W, H), 0)
        sh_layer.paste(mask, (x + int(b.width * 0.06), top_y + int(b.height * 0.02)))
        sh_layer = sh_layer.filter(ImageFilter.GaussianBlur(int(b.width * 0.055)))
        sh_rgba = Image.new("RGBA", (W, H), (58, 40, 24, 0))
        sh_rgba.putalpha(sh_layer.point(lambda v: int(v * 0.30)))
        canvas = Image.alpha_composite(canvas, sh_rgba)

        # انعكاس
        rh = int(b.height * 0.30)
        refl = b.transpose(Image.FLIP_TOP_BOTTOM).resize((b.width, rh), Image.LANCZOS)
        ra = refl.split()[-1].point(lambda v: int(v * 0.13))
        refl.putalpha(ra)
        canvas.alpha_composite(refl, (x, base_y))

        canvas.alpha_composite(b, (x, top_y))
        x += b.width + gap

    # فينييه
    vig = Image.new("L", (W, H), 255)
    vd = ImageDraw.Draw(vig)
    vd.ellipse([-int(W * 0.20), -int(H * 0.20), int(W * 1.20), int(H * 1.20)], fill=120)
    vig = vig.filter(ImageFilter.GaussianBlur(int(W * 0.09)))
    dark = Image.new("RGBA", (W, H), (52, 38, 24, 0))
    dark.putalpha(vig.point(lambda v: int((255 - v) * 0.12)))
    canvas = Image.alpha_composite(canvas, dark)

    canvas = grain(canvas.convert("RGB"))
    out = RAW / out_name
    canvas.save(out, "PNG", optimize=True)
    print(f"  ✓ {out_name}  {canvas.size[0]}×{canvas.size[1]}  {out.stat().st_size/1024:.0f} KB")
    return out, [(b, ) for b in scaled]


if __name__ == "__main__":
    print("رسم العبوة الأساسية (3× supersampling)…")
    base = draw_bottle(520, 1400)

    # اشتقاق الأحجام من العبوة نفسها بتغيير النسب — تصميم واحد، ثلاثة أحجام
    def variant(scale, height_ratio):
        w = int(520 * scale)
        h = int(1400 * height_ratio)
        v = base.resize((w, h), Image.LANCZOS)
        return v

    b30 = draw_bottle(560, 1080, "30 ML", body_scale=0.84)
    b50 = draw_bottle(620, 1320, "50 ML", body_scale=1.0)
    b100 = draw_bottle(680, 1620, "100 ML", body_scale=1.12)

    print("تركيب المشاهد…")
    # 1) ثلاثي أفقي (الهيرو العريض)
    make_scene([b30, b50, b100], "trio.png", 2000, 1500, floor_ratio=0.84, target_h=0.62)
    # 2) كل حجم منفردًا — مربّع
    make_scene([b30], "size-30.png", 1500, 1500, floor_ratio=0.88, target_h=0.72)
    make_scene([b50], "size-50.png", 1500, 1500, floor_ratio=0.88, target_h=0.72)
    make_scene([b100], "size-100.png", 1500, 1500, floor_ratio=0.88, target_h=0.72)
    # 3) تحريرية عمودية (ستوري/ريلز)
    make_scene([b50], "editorial.png", 1400, 2000, floor_ratio=0.90, target_h=0.66)
    # 4) هيرو عريض
    make_scene([b30, b50, b100], "hero-wide.png", 2400, 1200, floor_ratio=0.88, target_h=0.70)
    # 5) مربّع اجتماعي
    make_scene([b50], "social-square.png", 1400, 1400, floor_ratio=0.88, target_h=0.72)
    # 6) عمودي اجتماعي
    make_scene([b50], "social-vertical.png", 1080, 1920, floor_ratio=0.90, target_h=0.62)
