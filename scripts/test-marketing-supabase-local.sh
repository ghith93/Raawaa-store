#!/usr/bin/env bash
# Applies the full checked-in migration chain (001..006) to an isolated, temporary
# Supabase CLI stack, then runs the marketing-preferences pgTAP suite against it.
# It never links to or contacts a hosted project.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v supabase >/dev/null 2>&1; then
  echo "Supabase local test unavailable: install/use Supabase CLI on a Docker-capable runner; this script does not install tools." >&2
  exit 127
fi
if ! command -v docker >/dev/null 2>&1; then
  echo "Supabase local test unavailable: Docker is required; this script does not install tools." >&2
  exit 127
fi
if ! docker info >/dev/null 2>&1; then
  echo "Supabase local test unavailable: Docker daemon is not running or accessible." >&2
  exit 1
fi

# A fresh isolated workdir means there is no .temp/project-ref and no remote link.
TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/rawaa-supabase-local.XXXXXX")"
STARTED=0
cleanup() {
  if [[ "$STARTED" == 1 ]]; then
    (cd "$TEST_DIR" && supabase stop) >/dev/null 2>&1 || true
  fi
  rm -rf -- "$TEST_DIR"
}
trap cleanup EXIT INT TERM

mkdir -p "$TEST_DIR/supabase/migrations" "$TEST_DIR/supabase/tests"
cat > "$TEST_DIR/supabase/config.toml" <<'TOML'
project_id = "rawaa-marketing-local-test"

[api]
enabled = true
port = 54321
schemas = ["public", "graphql_public"]
extra_search_path = ["public", "extensions"]
max_rows = 1000

[db]
port = 54322
major_version = 17
TOML

# السلسلة الكاملة لا مخطط صناعي.
# السبب: كان الفحص يبني مخططًا صناعيًا ثم يطبّق 005 وحدها، فيمرّ بينما
# السلسلة الحقيقية 001..006 تنكسر (004 يعتمد closed_at الذي لم تُنشئه 001).
# 001 نفسها تُنشئ المخطط، لذا تُنسخ الهجرات بالترتيب كما هي بلا تمهيد مُختلَق.
migration_index=0
for migration in "$ROOT_DIR"/order-system/migrations/[0-9][0-9][0-9]_*.sql; do
  case "$migration" in
    *.down.sql) continue ;;
  esac
  base=$(basename "$migration")
  printf -v stamp '20261031%06d' "$migration_index"
  cp "$migration" "$TEST_DIR/supabase/migrations/${stamp}_${base}"
  echo "queued migration: $base"
  migration_index=$((migration_index + 1))
done
if [[ "$migration_index" -lt 6 ]]; then
  echo "expected the full 001..006 chain, found $migration_index files" >&2
  exit 1
fi
cp "$ROOT_DIR/order-system/marketing-preferences-supabase-test.sql" \
  "$TEST_DIR/supabase/tests/marketing_preferences.sql"

cd "$TEST_DIR"
echo "Starting only the local database container; no remote project is linked."
STARTED=1
# Exclude non-database services to keep the ephemeral hosted stack lightweight;
# pgTAP only needs the local Postgres container and its CLI test runner.
supabase start -x gotrue,realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
# Both commands explicitly target the local database. Never change these to --linked.
supabase db reset --local
supabase test db --local

echo "Supabase local candidate test passed. Synthetic test rows were rolled back; the temporary workdir will be removed."
