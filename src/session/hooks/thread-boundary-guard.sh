#!/bin/bash
# PreToolUse hook for Write/Edit: warn if target file is in another agent's claimed thread.
# Reads tool_input from stdin (JSON with file_path).

set -euo pipefail

CLI="$HOME/.claude/skills/session/scripts/session.sh"

if ! command -v argc >/dev/null 2>&1; then
  exit 0
fi

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  exit 0
fi

# Read tool input from stdin
input=$(cat)
file_path=$(printf '%s' "$input" | sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')

if [[ -z "$file_path" ]]; then
  exit 0
fi

# Check if the file is inside a .sessions/ thread directory
if [[ "$file_path" != */.sessions/* ]] && [[ "$file_path" != */.session/* ]]; then
  exit 0
fi

# Extract thread slug from path (thread.<slug>/ or done.thread.<n>.<slug>/)
thread_part=$(printf '%s' "$file_path" | grep -oE 'thread\.[a-z0-9-]+' | head -1)
if [[ -z "$thread_part" ]]; then
  exit 0
fi
slug="${thread_part#thread.}"

# Check who claimed this thread
claimed_by=$("$CLI" thread claim check "$slug" 2>/dev/null) || exit 0

# If claimed by someone else, warn
my_agent="${CLAUDE_AGENT_NAME:-}"
if [[ -n "$claimed_by" && -n "$my_agent" && "$claimed_by" != "$my_agent" ]]; then
  printf 'WARNING: Thread %s is claimed by %s (you are %s). Writing to another agent'\''s thread risks concurrent-write conflicts.\n' "$slug" "$claimed_by" "$my_agent"
fi
