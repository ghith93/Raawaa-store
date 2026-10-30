#!/usr/bin/env bash
# Structural project map only. No database, untracked files, media content, LLM or external services.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GRAPHIFY="${GRAPHIFY_BIN:-$ROOT/.cache/graphify-venv/bin/graphify}"
if [[ ! -x "$GRAPHIFY" ]]; then
  echo 'Graphify is not installed. See docs/GRAPHIFY-AR.md.' >&2
  exit 1
fi
mkdir -p "$ROOT/.cache"
SCAN="$(mktemp -d "$ROOT/.cache/graphify-scan.XXXXXXXX")"
cd "$ROOT"
python3 scripts/graphify-select.py "$SCAN"
# Clear environment so semantic providers and credentials cannot be auto-selected.
env -i HOME="$SCAN" PATH="$(dirname "$GRAPHIFY"):/usr/bin:/bin" LANG=C.UTF-8 \
  "$GRAPHIFY" update "$SCAN" --no-cluster
# Do not echo node names or potentially sensitive source text in CI logs.
python3 - "$SCAN/graphify-out/graph.json" <<'PY'
import json, sys
with open(sys.argv[1], encoding='utf-8') as f:
    data = json.load(f)
if not data.get('nodes') or not (data.get('links') or data.get('edges')):
    raise SystemExit('Graphify output is empty')
print(f"Local graph validated: {len(data['nodes'])} nodes, {len(data.get('links', data.get('edges', [])))} edges")
PY
echo "Local graph: $SCAN/graphify-out/graph.json"
