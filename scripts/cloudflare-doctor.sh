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
  # غياب التوكن محليًا ليس عائقًا إن كان النشر الآلي يعمل: التوكن محفوظ في GitHub Secrets.
  if grep -rql "pages deploy\|wrangler-action" .github/workflows/ 2>/dev/null; then
    pass "التوكن محفوظ في GitHub Secrets (لا حاجة لوجوده محليًا)"
  else
    fail "لا اعتماد محلي ولا نشر آلي — النشر مستحيل"
  fi
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
  if [ "$maj" -ge 22 ]; then
    pass "Node $v مناسب لـ wrangler"
  elif grep -q "node-version: '22'" .github/workflows/deploy.yml 2>/dev/null; then
    warnit "Node محلي $v قديم — لكن النشر يجري على Node 22 داخل GitHub Actions"
  else
    fail "Node $v قديم ولا بديل في CI — wrangler 4 يحتاج ≥22"
  fi
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
# الصفحة الرئيسية أصبحت صفحة علامة تجارية؛ الأحجام والسلة موجودة في /serum.
# نعيد المحاولة لأن نطاق Pages قد يتأخر قليلًا بعد اكتمال رفع الإصدار.
matched=0
for attempt in 1 2 3 4 5 6; do
  HOME_HTML=$(curl -fsSL --max-time 20 "$SITE/" || true)
  PRODUCT_HTML=$(curl -fsSL --max-time 20 "$SITE/serum" || true)
  if [[ "$HOME_HTML" == *"data-discover-serum"* &&
        "$HOME_HTML" == *"marketing.js"* &&
        "$PRODUCT_HTML" == *"data-size-options"* &&
        "$PRODUCT_HTML" == *"data-wa-direct"* &&
        "$PRODUCT_HTML" == *"data-open-cart-after-add"* ]]; then
    pass "الرئيسية تربط بصفحة السيروم؛ صفحة المنتج تحتوي الأحجام والسلة وواتساب"
    matched=1
    break
  fi
  echo "  انتظار انتشار إصدار Pages ($attempt/6)…"
  sleep 10
done
if [ "$matched" -ne 1 ]; then
  fail "الموقع الحي لا يطابق بنية الصفحة الرئيسية/صفحة المنتج بعد 6 محاولات"
fi

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
