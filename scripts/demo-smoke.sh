#!/usr/bin/env bash
# Offline demo against fixtures/sample-vault (stub AI, no Claude tokens).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
OUT="${DEMO_OUT:-$ROOT/demo/out}"
rm -rf "$OUT"
mkdir -p "$OUT/vault" "$OUT/data"
cp -R fixtures/sample-vault/. "$OUT/vault/"

export AI_OFFICE_NOTIFY=0
export VAULT_PATH="$OUT/vault"
export DATA_DIR="$OUT/data"
export AI_MODE=stub

echo "== enqueue + ingest =="
npx tsx src/cli.ts enqueue "https://example.com/demo" --job-id demo-smoke
npx tsx src/cli.ts ingest --fixture --stub-ai --silent --limit 1
npx tsx src/cli.ts approve demo-smoke --comment "demo smoke"

echo "== ask =="
npx tsx src/cli.ts ask "LLM Wiki とは？" --ask-id demo-ask --stub-ai --silent --skip-log

echo "== checks =="
test -f "$OUT/vault/Wiki/AI/AIオフィス.md"
test -f "$OUT/data/answers/demo-ask/answer.md"
grep -q '\[QUERY\]\|LLM Wiki\|AIオフィス' "$OUT/vault/log.md" || true

echo "DEMO_SMOKE_OK"
echo "vault: $OUT/vault"
echo "data:  $OUT/data"
echo "Next: VAULT_PATH=$OUT/vault DATA_DIR=$OUT/data npm run office -- serve"
