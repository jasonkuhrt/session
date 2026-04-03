#!/bin/bash
# PostToolUse hook for Bash: log git commit events to the session event log.
# Reads tool_input from stdin (JSON with command).

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
command_str=$(printf '%s' "$input" | sed -n 's/.*"command"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')

if [[ -z "$command_str" ]]; then
  exit 0
fi

# Only log git commit events
if [[ "$command_str" != *"git commit"* ]]; then
  exit 0
fi

# Extract short sha of HEAD after the commit
sha=$(git rev-parse --short HEAD 2>/dev/null) || exit 0

# Log the commit event
main_root=$(git worktree list --porcelain | sed -n 's/^worktree //p' | head -1)
branch=$(git symbolic-ref --quiet --short HEAD 2>/dev/null || echo "detached")
session_key=$("$CLI" status 2>/dev/null | sed -n 's/^session_key=//p') || exit 0

log_file="$main_root/.sessions/$session_key/log"
if [[ -f "$log_file" ]]; then
  agent="${CLAUDE_AGENT_NAME:-unknown}"
  printf '%s\t%s\t%s\t%s on %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$agent" "git.commit" "$sha" "$branch" >> "$log_file"
fi
