#!/usr/bin/env bash
# Pre-publish scan: fail if secrets / personal vault paths look committed.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
REPORT="${1:-.publish-scan-report.txt}"
: > "$REPORT"

fail=0
note() { echo "$1" | tee -a "$REPORT"; }

note "== AI Office publish scan =="
note "root: $ROOT"
note ""

# Files that must never be tracked
while IFS= read -r f; do
  note "TRACKED_FORBIDDEN: $f"
  fail=1
done < <(git ls-files | rg -i '(^|/)\.env$|(^|/)config/settings\.json$|credentials|id_rsa|\.pem$' || true)

# Content patterns in tracked files (exclude vendor, lockfile, and this scanner)
# Use fragmented pattern so this file itself does not match.
PAT1='KeiPrivate'
PAT2='sk-[a-zA-Z0-9]{20,}'
PAT3='OPENAI_API_KEY|ANTHROPIC_API_KEY'
PAT4='BEGIN (RSA |OPENSSH )?PRIVATE KEY'
while IFS= read -r line; do
  note "CONTENT_HIT: $line"
  fail=1
done < <(git grep -nI -E "$PAT1|$PAT2|$PAT3|$PAT4" -- \
  ':!vendor/**' ':!package-lock.json' ':!scripts/publish-scan.sh' 2>/dev/null || true)

# Real home vault path fragments (allow YourVault / YOU placeholders)
while IFS= read -r line; do
  note "PATH_HIT: $line"
  fail=1
done < <(git grep -nI -E '/Users/[^/]+/Library/Mobile Documents' -- \
  ':!vendor/**' ':!config/settings.example.json' ':!.env.example' ':!scripts/publish-scan.sh' 2>/dev/null \
  | rg -v 'YourVault|/Users/YOU/' || true)

note ""
if [[ "$fail" -eq 0 ]]; then
  note "RESULT: PASS (no hits)"
  exit 0
else
  note "RESULT: FAIL"
  exit 1
fi
