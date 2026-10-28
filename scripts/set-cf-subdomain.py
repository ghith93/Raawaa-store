#!/usr/bin/env python3
"""
RAWAA — تغيير النطاق الفرعي لحساب Cloudflare (workers.dev).

⚠️ تحذير: النطاق الفرعي مشترك بين **كل** عمال الحساب. تغييره يغيّر عنوان
كل مشروع منشور على الحساب، لا هذا الموقع فقط.

الاستخدام:
    python3 scripts/set-cf-subdomain.py --check
    python3 scripts/set-cf-subdomain.py rawaa
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN")
ACCOUNT_ID = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "1277e30c7a5bfac599ceb3c471328a24")
BASE = "https://api.cloudflare.com/client/v4"

if not TOKEN:
    sys.exit("✗ CLOUDFLARE_API_TOKEN غير مضبوط")


def api(path: str, method: str = "GET", data: dict | None = None):
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(BASE + path, data=body, method=method)
    req.add_header("Authorization", "Bearer " + TOKEN)
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=45) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")


def current() -> str:
    st, d = api("/accounts/" + ACCOUNT_ID + "/workers/subdomain")
    if st != 200:
        sys.exit("✗ تعذّرت القراءة: %s %s" % (st, d.get("errors")))
    return d["result"]["subdomain"]


def workers() -> list:
    st, d = api("/accounts/" + ACCOUNT_ID + "/workers/scripts")
    if st != 200:
        return []
    return sorted(s["id"] for s in d.get("result", []))


def show(sub: str) -> None:
    names = workers()
    print("النطاق الفرعي الحالي: " + sub)
    print()
    print("عناوين كل مشاريعك الآن:")
    for n in names:
        mark = "  <- موقع رواء" if n == "rawaa-store" else ""
        print("  https://" + n + "." + sub + ".workers.dev" + mark)


def main() -> int:
    old = current()

    if len(sys.argv) < 2 or sys.argv[1] in ("--check", "-c"):
        show(old)
        return 0

    new = sys.argv[1].strip().lower()
    if not new.replace("-", "").isalnum() or not new[0].isalnum():
        sys.exit("✗ اسم غير صالح: حروف وأرقام وشرطات فقط، ويبدأ بحرف أو رقم")

    names = workers()
    print("سيتم تغيير «" + old + "» إلى «" + new + "»")
    print()
    print("تأثير التغيير على كل مشاريعك:")
    for n in names:
        print("  " + n)
        print("    قبل: https://" + n + "." + old + ".workers.dev")
        print("    بعد: https://" + n + "." + new + ".workers.dev")
    print()

    st, d = api("/accounts/" + ACCOUNT_ID + "/workers/subdomain",
                method="PUT", data={"subdomain": new})
    if st not in (200, 201):
        sys.exit("✗ فشل التغيير: %s %s" % (st, d.get("errors")))

    got = d["result"]["subdomain"]
    print("✓ النطاق الفرعي الآن: " + got)
    print()
    show(got)
    print()
    print("قد يستغرق انتشار DNS دقيقة أو دقيقتين.")
    print("الخطوة التالية: python3 scripts/set-site-url.py https://rawaa-store."
          + got + ".workers.dev/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
