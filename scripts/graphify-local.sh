#!/usr/bin/env bash
# Local AST-only map of tracked source files. No documents, secrets, APIs, or network backends.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GRAPHIFY="${GRAPHIFY_BIN:-$ROOT/.cache/graphify-venv/bin/graphify}"
if [[ ! -x "$GRAPHIFY" ]]; then
  echo 'Graphify is not installed. See docs/GRAPHIFY-AR.md.' >&2
  exit 1
fi
mkdir -p "$ROOT/.cache"
SCAN="$(mktemp -d "$ROOT/.cache/graphify-scan.XXXXXXXX")"
# Only explicitly tracked code under these paths, not the rest of the checkout,
# configuration files, hidden paths, untracked data, environment files or credentials.
cd "$ROOT"
while IFS= read -r -d '' path; do
  if [[ -f "$path" && ! -L "$path" ]]; then
    mkdir -p "$SCAN/$(dirname "$path")"
    cp -- "$path" "$SCAN/$path"
  fi
done < <(git ls-files -z -- 'js/*.js' 'order-system/*.mjs' 'order-system/migrations/*.sql' 'owner/*.mjs' 'sw.js')
# Clear environment so semantic providers and credentials cannot be auto-selected.
env -i HOME="$SCAN" PATH="$(dirname "$GRAPHIFY"):/usr/bin:/bin" LANG=C.UTF-8 \
  "$GRAPHIFY" update "$SCAN" --no-cluster
echo "Local graph: $SCAN/graphify-out/graph.json"
echo "Example: $GRAPHIFY explain createCustomerOrderClient --graph $SCAN/graphify-out/graph.json"
