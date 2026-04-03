#!/usr/bin/env bash
# Install session skills by symlinking src/ directories into ~/.claude/skills/.
# Symlinks mean edits in either location are the same file — no build step needed.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILLS_DIR="$HOME/.claude/skills"

# Map of source dir → install dir (handles renames)
declare -A SKILL_MAP=(
  [session]=session
  [session_thread_land]=session_thread_land
  [session_debrief]=session_debrief
  [session_thread_handoff]=session_thread_handoff
  [session_retro]=session_retro
  [session_dashboard]=session_dashboard
)

# Old directory names that should be removed (renamed skills)
OLD_DIRS=(debrief thread_handoff)

for old in "${OLD_DIRS[@]}"; do
  target="$SKILLS_DIR/$old"
  if [[ -d "$target" && ! -L "$target" ]]; then
    echo "removing old skill dir: $target"
    rm -rf "$target"
  elif [[ -L "$target" ]]; then
    echo "removing old symlink: $target"
    rm "$target"
  fi
done

for src_name in "${!SKILL_MAP[@]}"; do
  install_name="${SKILL_MAP[$src_name]}"
  src="$REPO_DIR/src/$src_name"
  target="$SKILLS_DIR/$install_name"

  if [[ ! -d "$src" ]]; then
    echo "SKIP: $src does not exist"
    continue
  fi

  if [[ -L "$target" ]]; then
    existing=$(readlink "$target")
    if [[ "$existing" == "$src" ]]; then
      echo "ok: $install_name -> $src (already linked)"
      continue
    fi
    echo "replacing symlink: $install_name"
    rm "$target"
  elif [[ -d "$target" ]]; then
    echo "replacing dir with symlink: $install_name"
    rm -rf "$target"
  fi

  ln -s "$src" "$target"
  echo "linked: $install_name -> $src"
done

echo "done. All session skills installed via symlinks."
