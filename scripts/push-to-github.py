#!/usr/bin/env python3
"""
RAWAA — رفع حالة git المحلية إلى GitHub عبر REST API.

لماذا سكربت مخصص؟ لأن الوصول هنا عبر توكن API لا عبر git remote،
وسكربت بسيط أسهل مراجعةً من إعداد remote + credentials.

القاعدة الذهبية: يرفع **كل ملف متتبَّع في git** (git ls-files)،
فيستحيل أن يُنسى ملف جديد لم يُضَف. أي ملف غير متتبَّع يُرفض بصوت عالٍ.

الاستخدام:
  GH_TOKEN=... python3 scripts/push-to-github.py "رسالة الإيداع"
"""
import base64
import json
import os
import subprocess
import sys
import urllib.error
import time
import urllib.request
from pathlib import Path

TOKEN = os.environ.get("GH_TOKEN")
OWNER = os.environ.get("GH_OWNER", "ghith93")
REPO = os.environ.get("GH_REPO", "Raawaa-store")
BRANCH = os.environ.get("GH_BRANCH", "main")
ROOT = Path(__file__).resolve().parent.parent

if not TOKEN:
    sys.exit("GH_TOKEN غير مضبوط")

EXCLUDE_PREFIXES = ("dist/",)


# أخطاء عابرة تستحق إعادة المحاولة — 4xx الأخرى (401/403/404/422) نهائية
RETRY_STATUS = {429, 500, 502, 503, 504}
MAX_ATTEMPTS = 4


def api(method, path, data=None):
    """طلب API واحد مع إعادة محاولة أسّية على الأخطاء العابرة فقط.

    لا نعيد المحاولة أبدًا على 401/403/404/422 — تكرارها لا يغيّر النتيجة
    ويُهدر الحصة. التراجع: 1s → 2s → 4s (بحد أقصى 3 محاولات إضافية).
    """
    url = "https://api.github.com" + path
    body = json.dumps(data).encode() if data is not None else None
    last = (0, {"raw": "لم تُنفَّذ أي محاولة"})

    for attempt in range(1, MAX_ATTEMPTS + 1):
        req = urllib.request.Request(url, data=body, method=method)
        req.add_header("Authorization", "Bearer " + TOKEN)
        req.add_header("Accept", "application/vnd.github+json")
        req.add_header("X-GitHub-Api-Version", "2022-11-28")
        if body:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                txt = r.read().decode()
                return r.status, (json.loads(txt) if txt.strip() else {})
        except urllib.error.HTTPError as e:
            txt = e.read().decode()
            try:
                parsed = json.loads(txt)
            except Exception:
                parsed = {"raw": txt[:300]}
            last = (e.code, parsed)
            if e.code not in RETRY_STATUS or attempt == MAX_ATTEMPTS:
                return last
            wait = 2 ** (attempt - 1)
            print(f"  ↻ {e.code} على {method} {path[:60]} — إعادة بعد {wait}s "
                  f"({attempt}/{MAX_ATTEMPTS})", file=sys.stderr)
            time.sleep(wait)
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            last = (0, {"raw": f"شبكة: {e}"})
            if attempt == MAX_ATTEMPTS:
                return last
            wait = 2 ** (attempt - 1)
            print(f"  ↻ شبكة — إعادة بعد {wait}s ({attempt}/{MAX_ATTEMPTS})", file=sys.stderr)
            time.sleep(wait)
    return last


def main():
    message = sys.argv[1] if len(sys.argv) > 1 else "chore: تحديث"

    # 1) كل ملف متتبَّع — لا استثناءات صامتة
    tracked = subprocess.run(["git", "ls-files"], cwd=ROOT,
                             capture_output=True, text=True).stdout.split()
    files = [f for f in tracked
             if not f.startswith(EXCLUDE_PREFIXES) and (ROOT / f).is_file()]

    # GitHub يرفض أي ملف > 100 MB عبر الواجهة — نتحقق محليًا قبل إهدار الحصة
    too_big = [(f, (ROOT / f).stat().st_size) for f in files
               if (ROOT / f).stat().st_size > 95 * 1024 * 1024]
    if too_big:
        sys.exit("✗ ملفات تتجاوز حد GitHub (95MB):\n  " +
                 "\n  ".join(f"{n} — {b/1024/1024:.1f}MB" for n, b in too_big))

    untracked = [l[3:] for l in subprocess.run(
        ["git", "status", "--porcelain"], cwd=ROOT,
        capture_output=True, text=True).stdout.splitlines() if l.startswith("??")]
    if untracked:
        sys.exit("✗ ملفات غير متتبَّعة — نفّذ git add أولًا:\n  " + "\n  ".join(untracked))

    # 2) الشجرة الحالية على GitHub
    st, ref = api("GET", f"/repos/{OWNER}/{REPO}/git/ref/heads/{BRANCH}")
    if st != 200:
        sys.exit(f"✗ لا وصول للفرع {BRANCH}: {st} {ref}")
    head = ref["object"]["sha"]
    st, commit = api("GET", f"/repos/{OWNER}/{REPO}/git/commits/{head}")
    st, tree = api("GET", f"/repos/{OWNER}/{REPO}/git/trees/{commit['tree']['sha']}?recursive=1")
    remote = {e["path"]: e for e in tree["tree"] if e["type"] == "blob"}
    remote_dirs = {e["path"] for e in tree["tree"] if e["type"] == "tree"}

    # 3) ما تغيّر فعلًا (مقارنة بصمة git)
    changed = []
    for f in files:
        h = subprocess.run(["git", "hash-object", f], cwd=ROOT,
                           capture_output=True, text=True).stdout.strip()
        if f not in remote or remote[f]["sha"] != h:
            changed.append(f)

    deleted = [p for p in remote if p not in set(files)]
    if not changed and not deleted:
        print("لا تغييرات — لا شيء يُرفع.")
        return

    print(f"متغيّر/جديد: {len(changed)} · محذوف: {len(deleted)}")

    # 4) الشجرة الجديدة بالكامل (بلا أي عقدة زائدة)
    entries = [{"path": p, "mode": e["mode"], "type": "blob", "sha": e["sha"]}
               for p, e in remote.items() if p not in deleted]
    index = {e["path"]: i for i, e in enumerate(entries)}
    for f in changed:
        st, blob = api("POST", f"/repos/{OWNER}/{REPO}/git/blobs",
                       {"content": base64.b64encode((ROOT / f).read_bytes()).decode(),
                        "encoding": "base64"})
        if st != 201:
            sys.exit(f"✗ فشل رفع blob: {f} → {st} {blob}")
        if f in index:
            entries[index[f]]["sha"] = blob["sha"]
        else:
            entries.append({"path": f, "mode": "100644", "type": "blob", "sha": blob["sha"]})

    st, new_tree = api("POST", f"/repos/{OWNER}/{REPO}/git/trees", {"tree": entries})
    if st != 201:
        sys.exit(f"✗ فشل إنشاء الشجرة: {st} {new_tree}")

    st, new_commit = api("POST", f"/repos/{OWNER}/{REPO}/git/commits",
                         {"message": message, "tree": new_tree["sha"], "parents": [head]})
    if st != 201:
        sys.exit(f"✗ فشل الإيداع: {st} {new_commit}")

    st, _ = api("PATCH", f"/repos/{OWNER}/{REPO}/git/refs/heads/{BRANCH}",
                {"sha": new_commit["sha"]})
    if st != 200:
        sys.exit(f"✗ فشل تحديث الفرع: {st}")

    print(f"✅ {new_commit['sha'][:12]} · https://github.com/{OWNER}/{REPO}/commit/{new_commit['sha']}")
    print(f"   ملفات في الشجرة: {len(entries)}")


if __name__ == "__main__":
    main()
