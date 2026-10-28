#!/usr/bin/env python3
"""
RAWAA — تجهيز نطاق مخصص على Cloudflare وربطه بالموقع.

يمر بثلاث مراحل، ويمكن تشغيله أكثر من مرة بأمان (idempotent):

  --stage zone    ينشئ النطاق في Cloudflare ويطبع خوادم الأسماء التي
                  ستُدخل في nic.eu.org.
  --stage status  يعرض حالة النطاق: هل تفعّلت خوادم الأسماء؟
  --stage attach  يربط النطاق بالعامل (Worker) ويصبح الموقع متاحًا عليه.
  --stage urls    يبدّل كل الروابط في المشروع إلى النطاق الجديد.

الاستخدام:
    python3 scripts/setup-custom-domain.py --stage zone --domain rawaa.eu.org
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN")
ACCOUNT_ID = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "1277e30c7a5bfac599ceb3c471328a24")
WORKER = os.environ.get("RAWAA_WORKER", "raawaa-store")
BASE = "https://api.cloudflare.com/client/v4"

if not TOKEN:
    sys.exit("✗ CLOUDFLARE_API_TOKEN غير مضبوط")


def api(path, method="GET", data=None):
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(BASE + path, data=body, method=method)
    req.add_header("Authorization", "Bearer " + TOKEN)
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=45) as r:
            b = r.read().decode()
            return r.status, (json.loads(b) if b.strip() else {})
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode())
        except Exception:
            return e.code, {}


def find_zone(domain):
    st, d = api("/zones?name=" + domain)
    if st == 200 and d.get("result"):
        return d["result"][0]
    return None


def stage_zone(domain):
    z = find_zone(domain)
    if z:
        print("النطاق موجود في الحساب مسبقًا.")
    else:
        st, d = api("/zones", method="POST", data={
            "name": domain,
            "account": {"id": ACCOUNT_ID},
            "type": "full",
        })
        if st != 200:
            errs = d.get("errors") or [{}]
            code = errs[0].get("code")
            msg = errs[0].get("message", str(d))
            print("✗ تعذّر إنشاء النطاق: %s" % msg)
            if code == 0 and "zone.create" in msg:
                print()
                print("الحل: التوكن الحالي لا يملك صلاحية إنشاء النطاقات.")
                print("أضف إلى التوكن في dash.cloudflare.com/profile/api-tokens:")
                print("   Zone → Zone → Edit")
                print("أو أضف النطاق يدويًا من: dash.cloudflare.com → Add a site")
            return 1
        z = d["result"]

    print("النطاق: %s" % z["name"])
    print("الحالة: %s" % z["status"])
    ns = z.get("name_servers") or []
    if ns:
        print()
        print("أدخل خوادم الأسماء هذه في nic.eu.org:")
        for n in ns:
            print("   " + n)
        print()
        print("بعد الحفظ عندهم، انتظر انتشار DNS (من دقائق إلى ساعات) ثم:")
        print("   python3 scripts/setup-custom-domain.py --stage status --domain " + domain)
        print()
        print("ملاحظة: icann.org يصنّف eu.org كنطاق عام، فقد يقبل Cloudflare")
        print("تفويضه مباشرة. إن رفض طلب خوادم الأسماء، استخدم المرحلة attach لاحقًا.")
    return 0


def stage_status(domain):
    z = find_zone(domain)
    if not z:
        print("✗ النطاق غير موجود في الحساب. نفّذ --stage zone أولًا.")
        return 1
    print("النطاق: %s" % z["name"])
    print("الحالة: %s" % z["status"])
    print("خوادم الأسماء المطلوبة: %s" % ", ".join(z.get("name_servers") or []))
    if z["status"] == "active":
        print()
        print("✓ النطاق مفعّل. الخطوة التالية:")
        print("   python3 scripts/setup-custom-domain.py --stage attach --domain " + domain)
        return 0
    print()
    print("⏳ لم يُفعّل بعد. تأكد من إدخال خوادم الأسماء عند المسجّل.")
    return 2


def stage_attach(domain):
    z = find_zone(domain)
    if not z:
        print("✗ النطاق غير موجود في الحساب.")
        return 1
    if z["status"] != "active":
        print("✗ النطاق غير مفعّل بعد (الحالة: %s)." % z["status"])
        return 2

    host = "rawaa-store." + domain if domain.count(".") >= 2 else domain
    st, d = api("/accounts/%s/workers/domains" % ACCOUNT_ID, method="PUT", data={
        "environment": "production",
        "hostname": host,
        "service": WORKER,
        "zone_id": z["id"],
    })
    if st not in (200, 201):
        errs = d.get("errors") or [{}]
        print("✗ تعذّر الربط: %s" % errs[0].get("message", str(d)))
        return 1
    print("✓ رُبط %s بالعامل %s" % (host, WORKER))
    print("العنوان: https://%s" % host)
    print()
    print("الخطوة التالية:")
    print("   python3 scripts/setup-custom-domain.py --stage urls --domain %s --host %s"
          % (domain, host))
    return 0


def stage_urls(domain, host):
    target = "https://%s/" % (host or domain)
    r = subprocess.run([sys.executable, "scripts/set-site-url.py", target])
    return r.returncode


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", required=True,
                    choices=["zone", "status", "attach", "urls"])
    ap.add_argument("--domain", required=True)
    ap.add_argument("--host", default=None)
    a = ap.parse_args()

    if a.stage == "zone":
        return stage_zone(a.domain)
    if a.stage == "status":
        return stage_status(a.domain)
    if a.stage == "attach":
        return stage_attach(a.domain)
    return stage_urls(a.domain, a.host)


if __name__ == "__main__":
    sys.exit(main())
