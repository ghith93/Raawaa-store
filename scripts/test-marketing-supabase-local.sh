#!/usr/bin/env bash
# Runs the candidate marketing-preferences migration only against an isolated,
# temporary Supabase CLI stack. It never links to or contacts a hosted project.
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

cat > "$TEST_DIR/supabase/migrations/20261031000000_local_rawaa_schema.sql" <<'SQL'
-- Local test bootstrap only; this is not a production migration.
create schema rawaa_store;
revoke all on schema rawaa_store from public, anon, authenticated;
grant usage on schema rawaa_store to service_role;
SQL
cp "$ROOT_DIR/order-system/migrations/005_marketing_preference_events.sql" \
  "$TEST_DIR/supabase/migrations/20261031000001_marketing_preference_events.sql"
cp "$ROOT_DIR/order-system/marketing-preferences-supabase-test.sql" \
  "$TEST_DIR/supabase/tests/marketing_preferences.sql"

cd "$TEST_DIR"
echo "Starting only the local database container; no remote project is linked."
STARTED=1
# The Lenovo has 8 GB total RAM. Exclude non-DB services to minimize pressure;
# pgTAP only needs the local Postgres container and its CLI test runner.
supabase start -x gotrue,realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
# Both commands explicitly target the local database. Never change these to --linked.
supabase db reset --local
supabase test db --local

echo "Supabase local candidate test passed. Synthetic test rows were rolled back; the temporary workdir will be removed."
