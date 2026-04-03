#!/bin/bash
# SessionStart hook: run session start protocol and inject context.
# Fails gracefully if argc not installed or not in a git repo.

set -euo pipefail

CLI="$HOME/.claude/skills/session/scripts/session.sh"

if ! command -v argc >/dev/null 2>&1; then
  exit 0
fi

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  exit 0
fi

# Only inject if .sessions/ exists (this repo uses the session system)
main_root=$(git worktree list --porcelain | sed -n 's/^worktree //p' | head -1)
if [[ ! -d "$main_root/.sessions" ]]; then
  exit 0
fi

"$CLI" start 2>/dev/null || true
