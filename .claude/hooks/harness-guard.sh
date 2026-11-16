#!/usr/bin/env bash
# PreToolUse guard: block OpenClaw paths, vault direct writes, destructive rm.
set -euo pipefail

INPUT="$(cat || true)"

extract_field() {
  local key="$1"
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$INPUT" | jq -r --arg k "$key" '
      .. | objects | selectively(has($k); .[$k]) | select(type=="string")
    ' 2>/dev/null | head -1 || true
  else
    printf '%s' "$INPUT" | sed -n "s/.*\"${key}\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p" | head -1
  fi
}

# Prefer top-level-ish fields via simple sed (portable); jq path above may be empty
TOOL="$(printf '%s' "$INPUT" | sed -n 's/.*"tool_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
CMD="$(printf '%s' "$INPUT" | sed -n 's/.*"command"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
# Unescape common JSON escape sequences in command for pattern checks
CMD_UNESC="$(printf '%s' "$CMD" | sed 's/\\n/ /g; s/\\"/"/g; s/\\\\/\\/g')"
FILE_PATH="$(printf '%s' "$INPUT" | sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
PATH_FIELD="$(printf '%s' "$INPUT" | sed -n 's/.*"path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"

TARGET="${FILE_PATH:-${PATH_FIELD:-}}"
BLOB="${TARGET} ${CMD_UNESC}"

if printf '%s' "$BLOB" | grep -Eiq '(^|/)OpenClaw(/|$)'; then
  echo "harness-guard: OpenClaw path is forbidden" >&2
  exit 2
fi

# Block destructive shell (rm /bin/rm unlink git clean)
if [[ "${TOOL}" == "Bash" ]] && printf '%s' "$CMD_UNESC" | grep -Eq '(^|[;&|[:space:]])(/bin/)?(rm|unlink)[[:space:]]|git[[:space:]]+clean[[:space:]]+-f'; then
  echo "harness-guard: destructive delete commands are forbidden" >&2
  exit 2
fi

looks_like_vault_write() {
  local s="$1"
  printf '%s' "$s" | grep -Eiq '(Obsidian|VAULT|/Wiki/|/Sources/)'
}

is_draft_allow() {
  local s="$1"
  printf '%s' "$s" | grep -Eiq '/draft/|fixtures/sample-vault|queue/.*/draft'
}

# Edit/Write path checks
if [[ -n "$TARGET" ]] && looks_like_vault_write "$TARGET"; then
  if ! is_draft_allow "$TARGET"; then
    echo "harness-guard: refuse vault write outside draft/ (use apply program)" >&2
    exit 2
  fi
fi

# Bash redirects / tee into vault-like paths
if [[ "${TOOL}" == "Bash" ]]; then
  if printf '%s' "$CMD_UNESC" | grep -Eq '(>|>>|[|][[:space:]]*tee([[:space:]]|-a)+)[^;&|]*((Obsidian|VAULT|/Wiki/|/Sources/))'; then
    if ! is_draft_allow "$CMD_UNESC"; then
      echo "harness-guard: refuse Bash redirect/tee into vault paths" >&2
      exit 2
    fi
  fi
fi

exit 0
