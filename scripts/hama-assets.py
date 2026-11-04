#!/usr/bin/env python3
"""يبني بطاقات الأسعار وفيديوهات حماة من الصور التصوّرية.

التشغيل:
    python3 scripts/hama-assets.py cards
    python3 scripts/hama-assets.py video

الصور الناتجة تصميمية/تصوّرية، وليست صورة للمنتج النهائي — راجع docs/HAMA-VISUALS-AR.md.
الخط: IBM Plex Sans Arabic (OFL) — يدعم الأشكال العربية المتصلة بلا libraqm.
يتطلب: pillow، arabic-reshaper، python-bidi، imageio-ffmpeg.
"""
from __future__ import annotations

import math
import subprocess
import sys
from pathlib import Path

import arabic_reshaper
from bidi.algorithm import get_display
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets/img/hama"
FONTS = ROOT / "scripts/fonts"

MUSIC = ROOT / "assets/audio/hama-theme.m4a"
BOLD = FONTS / "IBMPlexSansArabic-Bold.ttf"
SEMI = FONTS / "IBMPlexSansArabic-SemiBold.ttf"
REG = FONTS / "IBMPlexSansArabic-Regular.ttf"
SERIF = Path("/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf")

CREAM = (246, 238, 224)
INK = (38, 26, 16)
GOLD = (150, 104, 42)
MUTED = (104, 78, 52)
WHITE = (255, 252, 246)


def ar(text: str) -> str:
    return get_display(arabic_reshaper.reshape(text))


def font(path: Path, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(path), size)


def cover(im: Image.Image, w: int, h: int, focus_y: float = 0.5) -> Image.Image:
    im = im.convert("RGB")
    s = max(w / im.width, h / im.height)
    nw, nh = math.ceil(im.width * s), math.ceil(im.height * s)
    im = im.resize((nw, nh), Image.LANCZOS)
    return im.crop(((nw - w) // 2, int((nh - h) * focus_y), (nw - w) // 2 + w, int((nh - h) * focus_y) + h))


def shift_down(im: Image.Image, offset: int) -> Image.Image:
    """ينزل الصورة داخل الإطار مع تمديد حافتها العليا، كي لا يُقطع غطاء العبوة."""
    w, h = im.size
    canvas = Image.new("RGB", (w, h), im.getpixel((w // 2, 2)))
    strip = im.crop((0, 0, w, 6)).resize((w, offset), Image.LANCZOS).filter(ImageFilter.GaussianBlur(12))
    canvas.paste(strip, (0, 0))
    body = im.resize((w, h - offset), Image.LANCZOS)
    canvas.paste(body, (0, offset))
    return canvas


def vgrad(size, top, bottom, start=0.0):
    w, h = size
    g = Image.new("L", (1, h))
    for y in range(h):
        t = max(0.0, (y / h - start) / max(0.001, 1 - start))
        g.putpixel((0, y), int(top + (bottom - top) * (t ** 1.35)))
    layer = Image.new("RGBA", size, (12, 8, 4, 255))
    layer.putalpha(g.resize((w, h)))
    return layer


def panel(draw, box, radius=34, fill=(246, 238, 224, 236)):
    draw.rounded_rectangle(box, radius=radius, fill=fill)


def write(draw, xy, text, f, fill, anchor="mm", shadow=None, spacing=1.3, rtl=True):
    x, y = xy
    lines = text.split("\n")
    for i, part in enumerate(lines):
        yy = y + i * f.size * spacing
        s = ar(part) if rtl else part
        if shadow:
            draw.text((x + 2, yy + 4), s, font=f, fill=shadow, anchor=anchor)
        draw.text((x, yy), s, font=f, fill=fill, anchor=anchor)
    return y + (len(lines) - 1) * f.size * spacing


def latin(draw, xy, text, f, fill, anchor="mm"):
    draw.text(xy, text, font=f, fill=fill, anchor=anchor)


def pill(draw, cx, cy, text, f, pad_x=58, pad_y=24, fill=CREAM, ink=INK):
    w = draw.textlength(text, font=f)
    box = (cx - w / 2 - pad_x, cy - f.size / 2 - pad_y, cx + w / 2 + pad_x, cy + f.size / 2 + pad_y)
    draw.rounded_rectangle(box, radius=(box[3] - box[1]) / 2, fill=fill)
    draw.text((cx, cy), text, font=f, fill=ink, anchor="mm")


def logo(im, xy=(76, 64), color=INK, small=False):
    d = ImageDraw.Draw(im, "RGBA")
    d.text(xy, "RAWAA", font=font(SERIF, 44 if small else 50), fill=color)
    d.text((xy[0] + 3, xy[1] + 52), ar("رواء"), font=font(BOLD, 24), fill=color)
    d.line((xy[0], xy[1] + 94, xy[0] + 92, xy[1] + 94), fill=color + (110,), width=2)


def save(im: Image.Image, name: str, quality=90, max_kb=122):
    p = OUT / name
    rgb = im.convert("RGB")
    q = quality
    while q >= 62:
        rgb.save(p, "JPEG", quality=q, optimize=True, progressive=True)
        if p.stat().st_size <= max_kb * 1024:
            break
        q -= 4
    print("✓", p.relative_to(ROOT), im.size, p.stat().st_size // 1024, "KB")


def card_50():
    w, h = 1080, 1350
    im = shift_down(cover(Image.open(OUT / "story-bg.jpg"), w, h, focus_y=1.0), 240).convert("RGBA")
    d = ImageDraw.Draw(im, "RGBA")
    panel(d, (56, 40, w - 56, 474))
    logo(im, (92, 74))
    d.text((w - 92, 96), ar("سيروم للشعر"), font=font(REG, 30), fill=MUTED, anchor="ra")
    write(d, (w / 2, 200), "50 مل", font(BOLD, 94), INK)
    write(d, (w / 2, 292), "الحجم الأنسب للاستخدام المنتظم", font(SEMI, 30), GOLD)
    pill(d, w / 2, 362, "18$", font(BOLD, 56), pad_x=48, pad_y=16)
    write(d, (w / 2, 436), "توصيل داخل حماة · دفع عند الاستلام", font(REG, 22), MUTED)
    save(im, "card-50-hero.jpg")


def card_30():
    w, h = 1080, 1350
    im = shift_down(cover(Image.open(OUT / "hero-30.jpg"), w, h, focus_y=1.0), 160).convert("RGBA")
    d = ImageDraw.Draw(im, "RGBA")
    panel(d, (56, 40, w - 56, 620), fill=(246, 238, 224, 240))
    logo(im, (92, 74))
    d.text((w - 92, 96), ar("ابدئي صغيرًا"), font=font(REG, 30), fill=MUTED, anchor="ra")
    write(d, (w / 2, 190), "30 مل", font(BOLD, 86), INK)
    pill(d, w / 2, 272, "12$", font(BOLD, 54), pad_x=44, pad_y=14)
    write(d, (w / 2, 360), "عبوة تجريبية تعرفين فيها\nإن كان يناسب شعرك", font(REG, 24), MUTED, spacing=1.35)
    write(d, (w / 2, 440), "توصيل حماة · دفع عند الاستلام", font(REG, 21), MUTED)
    save(im, "card-30-entry.jpg")


def card_compare():
    w, h = 1080, 1350
    im = cover(Image.open(OUT / "duo-sizes.jpg"), w, h, focus_y=0.95).convert("RGBA")
    d = ImageDraw.Draw(im, "RGBA")
    panel(d, (0, 0, w, 815), radius=0, fill=(246, 238, 224, 244))
    logo(im, (76, 54))
    write(d, (w / 2, 250), "ليش 50 مل؟", font(BOLD, 84), INK)
    write(d, (w / 2, 335), "فرق ٦ دولارات… وكمية تقريبًا الضعف", font(REG, 36), MUTED)

    for cx, size, price, life, hero in ((292, "30 مل", "12$", "٤–٦ أسابيع", False), (788, "50 مل", "18$", "٨–١٠ أسابيع", True)):
        box = (cx - 232, 405, cx + 232, 690)
        d.rounded_rectangle(box, radius=26, fill=(255, 252, 246, 255), outline=GOLD if hero else (216, 202, 180), width=3 if hero else 2)
        if hero:
            tag = "موصى به"
            tw = d.textlength(ar(tag), font=font(SEMI, 24))
            d.rounded_rectangle((cx - tw / 2 - 18, 384, cx + tw / 2 + 18, 428), radius=22, fill=GOLD)
            d.text((cx, 406), ar(tag), font=font(SEMI, 24), fill=CREAM, anchor="mm")
        write(d, (cx, 478), size, font(SEMI, 46), INK)
        latin(d, (cx, 560), price, font(BOLD, 72), GOLD)
        write(d, (cx, 645), life, font(REG, 30), MUTED)

    write(d, (w / 2, 745), "نفس التركيبة · نفس العبوة · نفس العلامة", font(REG, 28), MUTED)
    save(im, "card-compare.jpg")


def card_reel_cover():
    w, h = 1080, 1350
    im = cover(Image.open(OUT / "lifestyle-hands.jpg"), w, h, focus_y=0.45).convert("RGBA")
    im = Image.alpha_composite(im, vgrad((w, h), 0, 225, 0.40))
    d = ImageDraw.Draw(im, "RGBA")
    logo(im, (76, 60), WHITE)
    write(d, (76, 1000), "الفرق\nبتحسّيه من أول مرة.", font(BOLD, 86), WHITE, anchor="la", shadow=(0, 0, 0, 90))
    write(d, (76, 1210), "50 مل — 18$ · توصيل حماة", font(SEMI, 38), CREAM, anchor="la")
    save(im, "card-reel-cover.jpg")


def card_payment():
    w, h = 1080, 1350
    im = Image.new("RGB", (w, h), CREAM)
    d = ImageDraw.Draw(im)
    for y in range(h):
        t = y / h
        d.line([(0, y), (w, y)], fill=(int(246 - 12 * t), int(238 - 14 * t), int(224 - 18 * t)))
    d.rectangle((0, 0, w, 16), fill=INK)
    write(d, (w / 2, 105), "شام كاش", font(BOLD, 66), INK)
    write(d, (w / 2, 178), "تحويل مباشر — بلا عمولة", font(REG, 32), MUTED)

    qr = Image.open(OUT / "payment/sham-cash-qr.png").convert("RGB")
    side = 540
    qr = qr.resize((side, side), Image.LANCZOS)
    frame = 600
    white = Image.new("RGB", (frame, frame), (255, 255, 255))
    white.paste(qr, ((frame - side) // 2, (frame - side) // 2))
    im.paste(white, ((w - frame) // 2, 235))
    d.rectangle(((w - frame) // 2, 235, (w + frame) // 2, 235 + frame), outline=(214, 200, 178), width=2)

    write(d, (w / 2, 900), "غيث هيثم الشيخ خالد", font(SEMI, 40), INK)
    write(d, (w / 2, 958), "امسحي الرمز من تطبيق شام كاش", font(REG, 30), MUTED)
    write(d, (w / 2, 1022), "بعد التحويل أرسلي صورة الإشعار + الاسم + العنوان", font(REG, 28), MUTED)
    latin(d, (w / 2, 1092), "0997310856", font(BOLD, 48), GOLD)
    write(d, (w / 2, 1168), "التحويل لا يؤكد الطلب قبل ردّنا عليك", font(REG, 24), (120, 96, 70))
    save(im, "card-payment.jpg")


def outro_card():
    w, h = 1080, 1920
    im = Image.new("RGB", (w, h), CREAM)
    d = ImageDraw.Draw(im)
    for y in range(h):
        t = y / h
        d.line([(0, y), (w, y)], fill=(int(246 - 10 * t), int(238 - 12 * t), int(224 - 16 * t)))
    d.rectangle((0, 0, w, 14), fill=INK)
    d.text((w / 2, 560), "RAWAA", font=font(SERIF, 96), fill=INK, anchor="mm")
    d.text((w / 2, 660), ar("رواء"), font=font(SEMI, 46), fill=INK, anchor="mm")
    d.line((w / 2 - 90, 720, w / 2 + 90, 720), fill=(190, 168, 132), width=2)
    write(d, (w / 2, 820), "سيروم للشعر", font(SEMI, 44), GOLD)
    rows = [("30 مل", "12$"), ("50 مل", "18$"), ("100 مل", "24$")]
    for i, (label, price) in enumerate(rows):
        y = 890 + i * 66
        write(d, (690, y), label, font(SEMI, 36), INK, anchor="rm")
        latin(d, (450, y), price, font(BOLD, 42), GOLD, anchor="lm")
    write(d, (w / 2, 1110), "توصيل داخل حماة · دفع عند الاستلام", font(REG, 34), MUTED)
    latin(d, (w / 2, 1240), "0997310856", font(BOLD, 62), INK)
    write(d, (w / 2, 1340), "raawaa-store.pages.dev/hama", font(REG, 28), (120, 96, 70))
    p = OUT / "outro.jpg"
    im.save(p, "JPEG", quality=88, optimize=True, progressive=True)
    print("✓", p.relative_to(ROOT))


def caption(w, text, sub=None, price=None):
    lines = text.count("\n") + 1
    height = 300 + (60 if sub else 0) + (90 if price else 0)
    img = Image.new("RGBA", (w, height), (0, 0, 0, 0))
    d = ImageDraw.Draw(img, "RGBA")
    d.rounded_rectangle((36, 0, w - 36, height - 8), radius=34, fill=(14, 9, 5, 168))
    y = 74
    write(d, (w / 2, y + (lines - 1) * 34), text, font(BOLD, 58), WHITE)
    y += lines * 58 * 1.3
    if price:
        latin(d, (w / 2, y + 42), price, font(BOLD, 86), CREAM)
        y += 95
    if sub:
        write(d, (w / 2, y + 55), sub, font(REG, 34), CREAM)
    return img


def build_video(scenes, out_name, fps=30, music=None):
    ffmpeg = __import__("imageio_ffmpeg").get_ffmpeg_exe()
    w, h = 1080, 1920
    out = OUT / out_name
    cmd = [
        ffmpeg, "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{w}x{h}",
        "-r", str(fps), "-i", "-", "-an", "-c:v", "libx264", "-preset", "medium",
        "-crf", "21", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(out),
    ]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    assert proc.stdin

    for sc in scenes:
        src = cover(Image.open(sc["img"]), w, h, focus_y=sc.get("focus", 0.5))
        base = src.resize((int(w * 1.18), int(h * 1.18)), Image.LANCZOS)
        cap = caption(w, sc["text"], sc.get("sub"), sc.get("price")) if sc.get("text") else None
        frames = int(sc["dur"] * fps)
        for i in range(frames):
            t = i / max(1, frames - 1)
            z = 1.0 + 0.13 * t
            cw, ch = int(base.width / z), int(base.height / z)
            x = (base.width - cw) // 2
            y = max(0, min(base.height - ch, int((base.height - ch) * sc.get("focus", 0.5))))
            frame = base.crop((x, y, x + cw, y + ch)).resize((w, h), Image.LANCZOS).convert("RGBA")
            frame = Image.alpha_composite(frame, vgrad((w, h), 0, 205, 0.45))
            if cap is not None:
                fade = min(1.0, i / (0.35 * fps), (frames - i) / (0.25 * fps))
                c = cap.copy()
                if fade < 1:
                    c.putalpha(c.getchannel("A").point(lambda v: int(v * fade)))
                frame.alpha_composite(c, (0, h - cap.height - 210))
            if sc.get("chrome", True):
                d = ImageDraw.Draw(frame)
                d.text((w / 2, 96), "RAWAA", font=font(SERIF, 36), fill=(255, 252, 246, 228), anchor="mm")
                d.text((w / 2, 142), ar("رواء"), font=font(SEMI, 22), fill=(255, 252, 246, 190), anchor="mm")
                d.text((w / 2, h - 92), "0997310856", font=font(BOLD, 38), fill=(255, 252, 246, 220), anchor="mm")
            proc.stdin.write(frame.convert("RGB").tobytes())
    proc.stdin.close()
    proc.wait()

    if music and music.exists():
        muxed = out.with_name(out.stem + "-mux.mp4")
        subprocess.run(
            [ffmpeg, "-y", "-i", str(out), "-i", str(music), "-c:v", "copy",
             "-c:a", "aac", "-b:a", "128k", "-shortest", "-movflags", "+faststart", str(muxed)],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        muxed.replace(out)
    print("✓", out.relative_to(ROOT), out.stat().st_size // 1024, "KB")


def video_50():
    build_video(
        [
            {"img": OUT / "hero-30.jpg", "dur": 3.0, "text": "30 مل… بتخلص بسرعة", "price": "12$", "focus": 0.55},
            {"img": OUT / "duo-sizes.jpg", "dur": 3.4, "text": "50 مل — تقريبًا ضعف الكمية", "price": "18$", "focus": 0.62},
            {"img": OUT / "lifestyle-hands.jpg", "dur": 3.2, "text": "فرق ٦ دولارات فقط", "sub": "ونفس التركيبة", "focus": 0.45},
            {"img": OUT / "hero-50.jpg", "dur": 3.2, "text": "اطلبيها على واتساب", "sub": "توصيل حماة · دفع عند الاستلام", "focus": 0.55},
            {"img": OUT / "outro.jpg", "dur": 2.2, "chrome": False},
        ],
        "reel-50ml.mp4", music=MUSIC,
    )


def video_hama():
    build_video(
        [
            {"img": OUT / "hama-window.jpg", "dur": 3.2, "text": "من حماة… لحماة", "focus": 0.5},
            {"img": OUT / "hero-50.jpg", "dur": 3.2, "text": "سيروم للشعر", "sub": "30 مل 12$ · 50 مل 18$", "focus": 0.5},
            {"img": OUT / "salon-shelf.jpg", "dur": 3.0, "text": "توصيل داخل المدينة", "focus": 0.6},
            {"img": OUT / "lifestyle-hands.jpg", "dur": 3.2, "text": "بتفتحي قبل ما تدفعي", "sub": "توصيل حماة · دفع عند الاستلام", "focus": 0.45},
            {"img": OUT / "outro.jpg", "dur": 2.4, "chrome": False},
        ],
        "reel-hama.mp4", music=MUSIC,
    )


if __name__ == "__main__":
    what = sys.argv[1] if len(sys.argv) > 1 else "cards"
    if what == "cards":
        card_50()
        card_30()
        card_compare()
        card_reel_cover()
        card_payment()
        outro_card()
    elif what == "video":
        video_50()
        video_hama()
    else:
        raise SystemExit("cards | video")
