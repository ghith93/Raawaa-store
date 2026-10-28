#!/usr/bin/env bash
# RAWAA — طبيب Cloudflare: يشخّص كل عائق في سطر واحد.
# الاستخدام: bash scripts/cloudflare-doctor.sh
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
SITE="https://raawaa-store.pages.dev"
ok=0; bad=0; warn=0
pass() { echo "  ✓ $1"; ok=$((ok+1)); }
fail() { echo "  ✗ $1"; bad=$((bad+1)); }
warnit(){ echo "  ! $1"; warn=$((warn+1)); }

echo "══════ ١) المصادقة ══════"
TOK="${CLOUDFLARE_API_TOKEN:-}"
KEY="${CLOUDFLARE_API_KEY:-}"; EMAIL="${CLOUDFLARE_EMAIL:-}"
if [ -n "$TOK" ]; then
  code=$(curl -s -o /dev/null -w '%{http_code}' -X GET \
    "https://api.cloudflare.com/client/v4/user/tokens/verify" \
    -H "Authorization: Bearer $TOK" --max-time 20)
  [ "$code" = "200" ] && pass "توكن مخصص صالح (verify 200)" || fail "توكن مخصص موجود لكنه غير صالح (HTTP $code)"
elif [ -n "$KEY" ] && [ -n "$EMAIL" ]; then
  code=$(curl -s -o /dev/null -w '%{http_code}' \
    "https://api.cloudflare.com/client/v4/user" \
    -H "X-Auth-Email: $EMAIL" -H "X-Auth-Key: $KEY" --max-time 20)
  [ "$code" = "200" ] && pass "مفتاح عام صالح ($EMAIL)" || fail "مفتاح عام غير صالح (HTTP $code)"
else
  fail "لا اعتماد إطلاقًا — لا CLOUDFLARE_API_TOKEN ولا زوج EMAIL+API_KEY"
  echo "      ⇒ هذا هو العائق الأول: النشر مستحيل بلا اعتماد."
fi

echo
echo "══════ ٢) الوصول إلى المساحة ══════"
ACC="${CLOUDFLARE_ACCOUNT_ID:-1277e30c7a5bfac599ceb3c471328a24}"
if [ -n "$TOK" ] || [ -n "$KEY" ]; then
  n=$(curl -s "https://api.cloudflare.com/client/v4/accounts/$ACC/pages/projects" \
    ${TOK:+-H "Authorization: Bearer $TOK"} \
    ${KEY:+-H "X-Auth-Email: $EMAIL" -H "X-Auth-Key: $KEY"} --max-time 20 \
    | python3 -c 'import sys,json; d=json.load(sys.stdin); print(len(d.get("result") or []))' 2>/dev/null || echo "?")
  [ "$n" != "?" ] && [ "$n" != "0" ] && pass "$n مشروع Pages مرئي في المساحة" || warnit "لم أستطع قراءة مشاريع Pages (النتيجة: $n)"
else
  warnit "تخطّي: بلا اعتماد"
fi

echo
echo "══════ ٣) أدوات البناء ══════"
if command -v node >/dev/null; then
  v=$(node -v); maj=${v#v}; maj=${maj%%.*}
  [ "$maj" -ge 22 ] && pass "Node $v مناسب لـ wrangler" || fail "Node $v قديم — wrangler 4 يحتاج ≥22"
fi
if node -e "require.resolve('wrangler')" 2>/dev/null || [ -x node_modules/.bin/wrangler ]; then
  pass "wrangler مثبّت محليًا"
else
  warnit "wrangler غير مثبّت محليًا (npx سيجلب نسخة)"
fi
[ -f scripts/build-deploy.sh ] && pass "سكربت البناء موجود" || fail "سكربت البناء مفقود"

echo
echo "══════ ٤) الموقع الحيّ ══════"
code=$(curl -s -o /dev/null -w '%{http_code}' "$SITE/" --max-time 20)
[ "$code" = "200" ] && pass "الموقع يستجيب 200" || fail "الموقع لا يستجيب (HTTP $code)"
live_sw=$(curl -s --max-time 15 "$SITE/sw.js" | grep -o "CACHE_VERSION = '[^']*'" | head -1)
[ -n "$live_sw" ] && pass "service worker: $live_sw" || warnit "تعذّر قراءة sw.js"

echo
echo "══════ ٥) هل الموقع الحيّ مطابق للكود؟ ══════"
miss=0
for token in price-strip marketing.js data-wa-direct; do
  if curl -s --max-time 15 "$SITE/" | grep -q "$token"; then
    pass "الحى يحتوي «$token»"
  else
    fail "الحى **لا** يحتوي «$token» — الموقع منشور بإصدار قديم"; miss=$((miss+1))
  fi
done

echo
echo "══════ ٦) النشر التلقائي ══════"
if grep -rql "pages deploy\|cloudflare/wrangler-action" .github/workflows/ 2>/dev/null; then
  pass "يوجد نشر تلقائي في GitHub Actions"
else
  fail "لا نشر تلقائي — كل إصدار يحتاج تشغيلًا يدويًا من جهاز يملك التوكن"
fi

echo
echo "──────────────────────────────────────────"
echo "  سليم: $ok · معطوب: $bad · تحذير: $warn"
[ "$bad" -eq 0 ] && echo "  ✓ لا معوقات" || echo "  ✗ توجد $bad عوائق"
exit $([ "$bad" -eq 0 ] && echo 0 || echo 1)
