#!/usr/bin/env python3
"""
RAWAA — طبقة وصول موحّدة إلى Cloudflare API.

تقبل أيًّا من طريقتي المصادقة، وتكتشفهما تلقائيًا:

  1) توكن مخصص (Bearer):        CLOUDFLARE_API_TOKEN
  2) مفتاح عام كامل الصلاحيات:   CLOUDFLARE_EMAIL + CLOUDFLARE_API_KEY
     (يُرسل كـ X-Auth-Email + X-Auth-Key)

المفتاح العام يمنح وصولًا كاملًا بلا نقص، ويستطيع إنشاء توكنات مقيدة
لاحقًا — وهذا هو الطريق الذي اختاره المالك صراحةً.

الاستخدام من سكربت آخر:
    from cf_api import api, account_id, WORKER
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

BASE = "https://api.cloudflare.com/client/v4"
ACCOUNT_ID = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "1277e30c7a5bfac599ceb3c471328a24")
WORKER = os.environ.get("RAWAA_WORKER", "raawaa-store")


def _auth_mode() -> str:
    if os.environ.get("CLOUDFLARE_API_KEY") and os.environ.get("CLOUDFLARE_EMAIL"):
        return "global"
    if os.environ.get("CLOUDFLARE_API_TOKEN"):
        return "token"
    sys.exit(
        "✗ لا توجد مصادقة.\n"
        "  إما:  export CLOUDFLARE_API_TOKEN=...\n"
        "  أو :  export CLOUDFLARE_EMAIL=... CLOUDFLARE_API_KEY=..."
    )


def api(path: str, method: str = "GET", data=None, timeout: int = 45):
    """نداء واحد إلى Cloudflare API. يعيد (status, json)."""
    mode = _auth_mode()

    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(BASE + path, data=body, method=method)

    if mode == "global":
        req.add_header("X-Auth-Email", os.environ["CLOUDFLARE_EMAIL"])
        req.add_header("X-Auth-Key", os.environ["CLOUDFLARE_API_KEY"])
    else:
        req.add_header("Authorization", "Bearer " + os.environ["CLOUDFLARE_API_TOKEN"])

    req.add_header("Content-Type", "application/json")

    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw.strip() else {})
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode())
        except Exception:
            return e.code, {}
    except urllib.error.URLError as e:
        return 0, {"errors": [{"message": "شبكة: %s" % e.reason}]}


def err(d: dict) -> str:
    """أول رسالة خطأ مقروءة."""
    e = (d.get("errors") or [{}])[0]
    return e.get("message") or str(d)


def whoami():
    """يتحقق من الهوية ويطبع وضع المصادقة."""
    mode = _auth_mode()
    st, d = api("/user/tokens/verify" if mode == "token" else "/user")
    label = "توكن مخصص" if mode == "token" else "مفتاح عام (كامل الصلاحيات)"
    if st == 200:
        print("✓ المصادقة سليمة — %s" % label)
    else:
        print("✗ المصادقة فشلت — %s: %s" % (label, err(d)))
        return False
    st2, d2 = api("/accounts/%s/workers/scripts" % ACCOUNT_ID)
    print("  قراءة العمال: %s%s" % (st2, "" if st2 == 200 else " — " + err(d2)))
    return st == 200


if __name__ == "__main__":
    ok = whoami()
    sys.exit(0 if ok else 1)
