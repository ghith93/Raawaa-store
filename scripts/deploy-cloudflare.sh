#!/usr/bin/env bash
# RAWAA — نشر الموقع على Cloudflare Workers (Static Assets).
#
# الاستخدام:
#   CLOUDFLARE_API_TOKEN=... bash scripts/deploy-cloudflare.sh
#
# يجمع الموقع ثم ينشره. لا يكتب التوكن في أي ملف.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

: "${CLOUDFLARE_API_TOKEN:?✗ CLOUDFLARE_API_TOKEN غير مضبوط}"

# Node 22 مطلوب لـ Wrangler 4
if ! command -v node >/dev/null 2>&1 || [ "$(node -e 'console.log(process.versions.node.split(".")[0])')" -lt 22 ]; then
  if [ -x /tmp/node-v22.11.0-linux-x64/bin/node ]; then
    export PATH="/tmp/node-v22.11.0-linux-x64/bin:$PATH"
    echo "→ استخدام Node 22 المحمول"
  else
    echo "✗ يلزم Node 22+ لتشغيل Wrangler"; exit 1
  fi
fi

WRANGLER="$ROOT/node_modules/.bin/wrangler"
if [ ! -x "$WRANGLER" ]; then
  echo "✗ wrangler غير مثبت — نفّذ: npm install wrangler"
  exit 1
fi

echo "▸ 1/3 تجميع مجلد النشر…"
bash scripts/build-deploy.sh

echo
echo "▸ 2/3 التحقق من الهوية المتصلة…"
"$WRANGLER" whoami

echo
echo "▸ 3/3 النشر…"
"$WRANGLER" deploy --config wrangler.jsonc

echo
echo "✅ انتهى. العنوان في السطر أعلاه (*.workers.dev)"
