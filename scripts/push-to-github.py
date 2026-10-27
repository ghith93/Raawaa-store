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


def api(method, path, data=None):
    url = "https://api.github.com" + path
    body = json.dumps(data).encode() if data is not None else None
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
            return e.code, json.loads(txt)
        except Exception:
            return e.code, {"raw": txt[:300]}


def main():
    message = sys.argv[1] if len(sys.argv) > 1 else "chore: تحديث"

    # 1) كل ملف متتبَّع — لا استثناءات صامتة
    tracked = subprocess.run(["git", "ls-files"], cwd=ROOT,
                             capture_output=True, text=True).stdout.split()
    files = [f for f in tracked
             if not f.startswith(EXCLUDE_PREFIXES) and (ROOT / f).is_file()]

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
