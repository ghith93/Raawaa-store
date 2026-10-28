#!/usr/bin/env python3
"""
RAWAA — حاسبة الهامش.

تقرأ الأرقام من js/config.js (المصدر الوحيد) وتحسب صافي الربح لكل
حجم × طريقة دفع × منطقة توصيل. تُنبّه على أي تركيبة خاسرة.

الاستخدام: python3 scripts/margin_calc.py
"""
import json, re, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
src = (ROOT / "js/config.js").read_text(encoding="utf-8")

def js_to_json(block: str) -> dict:
    """يحوّل كائن JS بسيطًا إلى JSON قابل للقراءة."""
    block = re.sub(r"//[^\n]*", "", block)
    block = re.sub(r"/\*[\s\S]*?\*/", "", block)
    block = re.sub(r"([{,]\s*)([a-zA-Z_][\w]*)\s*:", r'\1"\2":', block)
    block = re.sub(r",(\s*[}\]])", r"\1", block)
    block = block.replace("'", '"')
    return json.loads(block)

def grab(name):
    i = src.index(name + ":")
    j = src.index("[", i) if src[i:].lstrip().startswith(name + ": [") or src[src.index(":", i)+1:].lstrip().startswith("[") else src.index("{", i)
    # موازنة الأقواس
    open_ch = src[j]; close_ch = "]" if open_ch == "[" else "}"
    depth = 0
    for k in range(j, len(src)):
        if src[k] == open_ch: depth += 1
        elif src[k] == close_ch:
            depth -= 1
            if depth == 0:
                return js_to_json(src[j:k+1])
    raise ValueError(name)

products = grab("products")
methods = grab("methods")
zones = grab("zones")
costing = grab("costing")

def unit_cost(ml):
    return round(costing["fixedCost"] + costing["perMl"] * ml, 2)

def margin(price, method, zone, ml):
    discount = price * method.get("discountPercent", 0) / 100
    net = price - discount
    free = zone["id"] in (method.get("freeDeliveryIn") or [])
    delivery = 0 if free else zone["fee"]
    cost = unit_cost(ml)
    return net, delivery, cost, net - delivery - cost

rows, losses = [], []
for p in products:
    for m in methods:
        for z in zones:
            net, delivery, cost, profit = margin(p["price"], m, z, p["sizeMl"])
            pct = (profit / net * 100) if net else 0
            rows.append((p["sizeLabel"], m["label"], z["label"], p["price"], net, delivery, cost, profit, pct))
            if profit <= 0:
                losses.append((p["sizeLabel"], m["label"], z["label"], profit))

w = "─" * 92
print(w)
print("RAWAA | حاسبة الهامش — التكلفة تقديرية من أرقام المالك (100 مل = $3.00 شامل التغليف)")
print(w)
print(f"{'الحجم':<8}{'الدفع':<20}{'المنطقة':<16}{'السعر':>7}{'الصافي':>9}{'توصيل':>8}{'تكلفة':>8}{'ربح':>8}{'هامش%':>8}")
print(w)
for r in rows:
    flag = "  ⚠️" if r[7] <= 0 else ""
    print(f"{r[0]:<8}{r[1]:<20}{r[2]:<16}{r[3]:>7.2f}{r[4]:>9.2f}{r[5]:>8.2f}{r[6]:>8.2f}{r[7]:>8.2f}{r[8]:>7.1f}{flag}")
print(w)
if losses:
    print(f"\n⚠️  {len(losses)} تركيبة خاسرة أو بلا ربح:")
    for l in losses:
        print(f"   • {l[0]} · {l[1]} · {l[2]} → {l[3]:+.2f}$")
    print("\nالتوصية: ارفع سعر 30 مل أو امنع شام كاش عليه خارج حماة، أو اجعله حدًا أدنى للطلب.")
else:
    print("\n✅ لا توجد تركيبة خاسرة.")
sys.exit(1 if losses else 0)
