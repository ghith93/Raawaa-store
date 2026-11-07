#!/usr/bin/env python3
"""
RAWAA — حاسبة الهامش.

تقرأ الأرقام من js/config.js (المصدر الوحيد) وتحسب صافي الربح لكل
حجم × طريقة دفع × منطقة توصيل. تُنبّه على أي تركيبة خاسرة.

الاستخدام:
    python3 scripts/margin_calc.py
    python3 scripts/margin_calc.py --shipping 2.5

`--shipping` هو ما تدفعه أنتِ فعليًا لشركة التوصيل عن كل طلب. التوصيل على
الزبونة صار مجانيًا بقرارك، لكنه ليس مجانيًا عليك: هذه هي تكلفته الحقيقية.
بلا `--shipping` لا يُحتسب شيء — وهذا مذكور صراحة في المخرجات حتى لا يُقرأ
الربح كأنه صافٍ نهائيًا.
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

import argparse

_parser = argparse.ArgumentParser(add_help=True, description="حاسبة الهامش — تقرأ الأرقام من js/config.js")
_parser.add_argument("--shipping", type=float, default=0.0,
                     help="تكلفة التوصيل التي تدفعها أنتِ عن كل طلب بالدولار (افتراضي 0 = غير محتسبة)")
_args = _parser.parse_args()
SHIPPING = max(0.0, _args.shipping)

products = grab("products")
methods = grab("methods")
zones = grab("zones")
costing = grab("costing")
delivery_cfg = grab("delivery")

"""
تكلفة العبوة — من `costing` في js/config.js وحده.

النموذج القديم (`fixedCost + perMl * ml`) عفا عليه الزمن: المالك أكّد في
2026-10-28 أن التكلفة **ثابتة لكل الأحجام** (3–4$: التغليف والقطّارة هما
الكلفة نفسها). الاعتماد على الحقول القديمة كان يجعل هذا الملف يتعطّل بـ
KeyError، أي أن حاسبة الهامش لم تكن تعمل أصلًا. نأخذ الحد **الأعلى** دائمًا
حتى لا نحتسب ربحًا وهميًا، ونقبل النموذج القديم كاحتياط فقط.
"""
def unit_cost(price_size_ml):
    if "unitCostMax" in costing:
        return round(float(costing["unitCostMax"]), 2)
    if "unitCostMin" in costing:
        return round(float(costing["unitCostMin"]), 2)
    if "fixedCost" in costing and "perMl" in costing:
        return round(costing["fixedCost"] + costing["perMl"] * price_size_ml, 2)
    raise SystemExit("scripts/margin_calc.py: js/config.js لا يحمل costing صالحًا — لا نخمّن التكلفة.")


def margin(price, method, zone, ml):
    """
    سياسة التوصيل من `delivery.policy` وحدها — نفس حكم js/pricing-policy.js.

    كان هنا `zone["id"] in method["freeDeliveryIn"]`، وهي سياسة **ملغاة**:
    التوصيل الآن مجاني في كل الحالات. إبقاء الصيغة القديمة هنا كان يعني أن
    هذه الحاسبة تناقض الموقع، وهو التعارض الذي أُمرنا بإزالته من كل مكان.
    التغيير الوحيد المسموح في الأرقام يأتي من js/config.js.
    """
    discount = price * method.get("discountPercent", 0) / 100
    net = price - discount
    policy = delivery_cfg.get("policy") or {}
    always_free = policy.get("alwaysFree") is not False
    delivery = 0 if always_free else float(zone.get("fee") or 0)
    cost = unit_cost(ml)
    # تكلفة التوصيل التي يتحمّلها المالك (لا الزبونة). لم تكن تُحتسب قبل اليوم
    # لأن التوصيل كان يُحصَّل من الزبونة. الآن هو مجاني لها، فصار عبئًا عليه،
    # وتجاهله يجعل الربح يبدو أعلى من حقيقته.
    return net, delivery, cost, net - cost - SHIPPING

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
print(f"RAWAA | حاسبة الهامش — التكلفة من أرقام المالك (${unit_cost(0):.2f} للعبوة، ثابتة لكل الأحجام)")
print(w)
print(f"{'الحجم':<8}{'الدفع':<20}{'المنطقة':<16}{'السعر':>7}{'الصافي':>9}{'توصيل':>8}{'تكلفة':>8}{'ربح':>8}{'هامش%':>8}")
if SHIPPING:
    print(f"ملاحظة: يُخصم ${SHIPPING:.2f} تكلفة توصيل يتحمّلها المالك من كل صف.")
print(w)
for r in rows:
    flag = "  ⚠️" if r[7] <= 0 else ""
    print(f"{r[0]:<8}{r[1]:<20}{r[2]:<16}{r[3]:>7.2f}{r[4]:>9.2f}{r[5]:>8.2f}{r[6]:>8.2f}{r[7]:>8.2f}{r[8]:>7.1f}{flag}")
print(w)
if losses:
    print(f"\n⚠️  {len(losses)} تركيبة خاسرة أو بلا ربح:")
    for l in losses:
        print(f"   • {l[0]} · {l[1]} · {l[2]} → {l[3]:+.2f}$")
    print("\nالتوصية: راجع سعر الحجم أو تكلفته؛ لا تُخفَّض الأسعار ولا تُعاد رسوم التوصيل بلا قرار صريح من المالك.")
else:
    print("\n✅ لا توجد تركيبة خاسرة.")
if not SHIPPING:
    print("\n⚠️  تكلفة التوصيل التي تتحمّلها أنتِ غير محتسبة. أضِف `--shipping` لنرى الربح الحقيقي.")
    print("    (التوصيل مجاني للزبونة بقرارك، لكنه ليس مجانيًا عليك.)")
sys.exit(1 if losses else 0)
