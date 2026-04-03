#!/bin/bash
# @describe Manage shared worktree sessions

set -euo pipefail

# --- Logging ---

log() { printf '%s\n' "[session] $*" >&2; }
warn() { printf '%s\n' "[session] warning: $*" >&2; }

# --- argc check ---

soft_bail_without_argc() {
  command_name="${1:-command}"
  warn "argc is not installed; skipping session ${command_name}. Install \`argc\` to enable this workflow."
  exit 0
}

if ! command -v argc >/dev/null 2>&1; then
  soft_bail_without_argc "${1:-command}"
fi

# --- Git helpers ---

repo_root() { git rev-parse --show-toplevel; }
main_worktree() { git worktree list --porcelain | sed -n 's/^worktree //p' | head -1; }
list_worktrees() { git worktree list --porcelain | sed -n 's/^worktree //p'; }
current_branch() { git symbolic-ref --quiet --short HEAD 2>/dev/null || true; }

script_path() {
  local script_source="${BASH_SOURCE[0]:-$0}"
  local script_dir
  script_dir="$(cd "$(dirname "$script_source")" && pwd)"
  printf '%s/%s\n' "$script_dir" "$(basename "$script_source")"
}

# --- Path helpers ---

slugify() {
  printf '%s' "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//; s/-+/-/g'
}

# Validate a thread slug: [a-z0-9-]+ only, no dots.
validate_slug() {
  local slug="$1"
  if [[ -z "$slug" ]]; then
    warn "slug cannot be empty"
    return 1
  fi
  if [[ ! "$slug" =~ ^[a-z0-9-]+$ ]]; then
    warn "invalid slug '$slug': must match [a-z0-9-]+ (no dots, spaces, or uppercase)"
    return 1
  fi
}

# Resolve a path to its canonical (physical) form, handling macOS /tmp -> /private/tmp.
canonical_path() {
  if [[ -d "$1" ]]; then
    (cd "$1" && pwd -P)
  elif [[ -e "$1" ]]; then
    local dir base
    dir="$(cd "$(dirname "$1")" && pwd -P)"
    base="$(basename "$1")"
    printf '%s/%s\n' "$dir" "$base"
  else
    printf '%s\n' "$1"
  fi
}

extract_issue_key() {
  local branch_name="$1"
  printf '%s\n' "$branch_name" | tr '[:lower:]' '[:upper:]' | grep -Eo 'HEA-[0-9]+' | head -1 || true
}

resolve_session_key() {
  local branch_name="$1"
  local issue_key
  issue_key=$(extract_issue_key "$branch_name")

  if [[ -n "$issue_key" ]]; then
    printf '%s\n' "$issue_key"
    return 0
  fi

  if [[ -z "$branch_name" ]]; then
    local detached_head
    detached_head=$(git rev-parse --short HEAD 2>/dev/null || printf 'detached')
    branch_name="detached-$detached_head"
  fi

  local slug
  slug=$(slugify "$branch_name")
  if [[ -n "$slug" ]]; then
    printf '%s\n' "$slug"
  else
    printf '%s\n' detached
  fi
}

# --- Config ---

# Read a value from .sessions/.config.yml by key. Returns empty if not found or no config.
# Supports dotted keys for 2-level nesting: config_get "worktree.base_branch" reads:
#   worktree:
#     base_branch: develop
config_get() {
  local key="$1"
  local main_root
  main_root=$(main_worktree)
  local config_file="$main_root/.sessions/.config.yml"
  if [[ ! -f "$config_file" ]]; then
    return 0
  fi
  if [[ "$key" == *.* ]]; then
    local parent="${key%%.*}"
    local child="${key#*.}"
    awk -v parent="$parent" -v child="$child" '
      $0 ~ "^" parent ":" { in_section = 1; next }
      in_section && /^[^ \t]/ { exit }
      in_section && $0 ~ "^  " child ": " { sub("^  " child ": ", ""); print; exit }
    ' "$config_file"
  else
    awk -v key="$key" '
      $0 ~ "^" key ":" { sub("^" key ":[ ]*", ""); print; exit }
    ' "$config_file"
  fi
}

# Read a YAML list from .sessions/.config.yml. Returns one item per line.
# Supports dotted keys: config_get_list "worktree.post_create" reads:
#   worktree:
#     post_create:
#       - npm install
config_get_list() {
  local key="$1"
  local main_root
  main_root=$(main_worktree)
  local config_file="$main_root/.sessions/.config.yml"
  if [[ ! -f "$config_file" ]]; then
    return 0
  fi
  if [[ "$key" == *.* ]]; then
    local parent="${key%%.*}"
    local child="${key#*.}"
    awk -v parent="$parent" -v child="$child" '
      $0 ~ "^" parent ":" { in_parent = 1; next }
      in_parent && /^[^ \t]/ { exit }
      in_parent && $0 ~ "^  " child ":" { in_list = 1; next }
      in_parent && in_list && /^    - / { sub("^    - ", ""); print; next }
      in_parent && in_list && /^  [^ \t]/ { exit }
      in_parent && in_list && /^[^ \t]/ { exit }
    ' "$config_file"
  else
    awk -v key="$key" '
      $0 ~ "^" key ":" { in_list = 1; next }
      in_list && /^  - / { sub("^  - ", ""); print; next }
      in_list && /^[^ \t]/ { exit }
    ' "$config_file"
  fi
}

# --- Linear URL expansion ---

linear_issue_url() {
  local issue_key="$1"
  local org
  org=$(config_get "linear_org")
  org="${org:-heartbeat-chat}"
  printf 'https://linear.app/%s/issue/%s\n' "$org" "$issue_key"
}

# --- Session template ---

REQUIRED_SESSION_SECTIONS=("Mission" "Decisions")

session_template() {
  local session_key="$1"
  local issue_key="${2:-}"

  if [[ -n "$issue_key" ]]; then
    cat <<EOF
---
issue_key: $issue_key
---

# $session_key

## Mission

## Decisions
EOF
  else
    cat <<EOF
# $session_key

## Mission

## Decisions
EOF
  fi
}

# --- Frontmatter parsing ---

# Extract a YAML frontmatter value by key. Returns empty string if not found.
frontmatter_get() {
  local file="$1" key="$2"
  if [[ ! -f "$file" ]]; then
    return 0
  fi
  awk -v key="$key" '
    NR == 1 && /^---$/ { in_fm = 1; next }
    in_fm && /^---$/ { exit }
    in_fm && $0 ~ "^" key ": " { sub("^" key ": ", ""); print; exit }
  ' "$file"
}

# Set a YAML frontmatter key in a file. Creates the frontmatter block if absent.
# Empty value removes the key entirely.
frontmatter_set() {
  local file="$1" key="$2" value="$3"
  if [[ ! -f "$file" ]]; then
    warn "frontmatter_set: file not found: $file"
    return 1
  fi

  local tmp
  tmp=$(mktemp)

  if head -1 "$file" | grep -q '^---$'; then
    # File has frontmatter — update or add the key
    if [[ -z "$value" ]]; then
      # Remove the key
      awk -v key="$key" '
        NR == 1 && /^---$/ { in_fm = 1; print; next }
        in_fm && /^---$/ { in_fm = 0; print; next }
        in_fm && $0 ~ "^" key ": " { next }
        { print }
      ' "$file" > "$tmp"
    else
      # Update existing key or add it before closing ---
      local key_found=false
      awk -v key="$key" -v val="$value" '
        NR == 1 && /^---$/ { in_fm = 1; print; next }
        in_fm && /^---$/ {
          if (!found) { print key ": " val }
          in_fm = 0; print; next
        }
        in_fm && $0 ~ "^" key ": " { print key ": " val; found = 1; next }
        { print }
      ' "$file" > "$tmp"
    fi
  else
    # No frontmatter — prepend it
    if [[ -n "$value" ]]; then
      printf '%s\n' "---" "$key: $value" "---" > "$tmp"
      cat "$file" >> "$tmp"
    else
      # Empty value + no frontmatter = nothing to do
      rm -f "$tmp"
      return 0
    fi
  fi

  mv "$tmp" "$file"
}

# --- Done numbering ---

# Compute the next done sequence number for a given type in a directory.
# Usage: next_done_number <dir> <type>
# Scans for done.<type>.<n>.* entries and returns max(n) + 1.
next_done_number() {
  local dir="$1" type="$2"
  local max=0 entry name n
  for entry in "$dir"/done."$type".*; do
    [[ -e "$entry" ]] || continue
    name="$(basename "$entry")"
    n="${name#done."$type".}"
    n="${n%%.*}"
    if [[ "$n" =~ ^[0-9]+$ ]] && (( n > max )); then
      max=$n
    fi
  done
  printf '%d\n' $(( max + 1 ))
}

# Check for gaps in done sequence numbers. Returns newline-separated gap numbers.
detect_sequence_gaps() {
  local dir="$1" type="$2"
  local -a nums=()
  local entry name n
  for entry in "$dir"/done."$type".*; do
    [[ -e "$entry" ]] || continue
    name="$(basename "$entry")"
    n="${name#done."$type".}"
    n="${n%%.*}"
    if [[ "$n" =~ ^[0-9]+$ ]]; then
      nums+=("$n")
    fi
  done
  if [[ ${#nums[@]} -eq 0 ]]; then
    return 0
  fi
  # Sort and find gaps
  local sorted max i
  sorted=$(printf '%s\n' "${nums[@]}" | sort -n)
  max=$(printf '%s\n' "${nums[@]}" | sort -n | tail -1)
  for (( i = 1; i <= max; i++ )); do
    if ! printf '%s\n' "${sorted}" | grep -qx "$i"; then
      printf '%d\n' "$i"
    fi
  done
}

# --- Thread helpers ---

# List thread directories matching thread.<slug>/ and done.thread.<n>.<slug>/
# Output format: <status>\t<n>\t<slug>  (n is 0 for active threads)
# NOTE: n must not be empty — bash read with IFS=$'\t' collapses consecutive tabs.
list_threads() {
  local session_dir="$1"
  local entry name n slug
  for entry in "$session_dir"/thread.* "$session_dir"/done.thread.*; do
    [[ -d "$entry" ]] || continue
    name="$(basename "$entry")"
    if [[ "$name" == done.thread.* ]]; then
      local rest="${name#done.thread.}"
      n="${rest%%.*}"
      slug="${rest#*.}"
      printf 'done\t%s\t%s\n' "$n" "$slug"
    else
      printf 'active\t0\t%s\n' "${name#thread.}"
    fi
  done
}

# Find thread dir by slug (checks active first, then done)
find_thread_dir() {
  local session_dir="$1" slug="$2"
  local thread_dir="$session_dir/thread.$slug"
  if [[ -d "$thread_dir" ]]; then
    printf '%s\n' "$thread_dir"
    return 0
  fi
  for d in "$session_dir"/done.thread.*."$slug"; do
    if [[ -d "$d" ]]; then
      printf '%s\n' "$d"
      return 0
    fi
  done
  return 1
}

# List files in a thread dir with done/active status
# Output format: <status>\t<type>\t<n>\t<name>\t<path>
# NOTE: empty fields use "-" sentinel — bash read with IFS=$'\t' collapses consecutive tabs.
list_thread_files() {
  local thread_dir="$1"
  local f name

  # Plan
  if [[ -f "$thread_dir/plan.md" ]]; then
    printf 'active\tplan\t-\t-\t%s\n' "$thread_dir/plan.md"
  fi
  for f in "$thread_dir"/done.plan.*; do
    [[ -f "$f" ]] || continue
    name="$(basename "$f")"
    local pn="${name#done.plan.}"
    pn="${pn%.md}"
    printf 'done\tplan\t%s\t-\t%s\n' "$pn" "$f"
  done

  # Tasks
  if [[ -f "$thread_dir/tasks.md" ]]; then
    printf 'active\ttasks\t-\t-\t%s\n' "$thread_dir/tasks.md"
  fi

  # Debrief
  if [[ -f "$thread_dir/debrief.md" ]]; then
    printf 'active\tdebrief\t-\t-\t%s\n' "$thread_dir/debrief.md"
  fi

  # Reviews
  for f in "$thread_dir"/review.*.md; do
    [[ -f "$f" ]] || continue
    name="$(basename "$f")"
    name="${name#review.}"
    name="${name%.md}"
    printf 'active\treview\t-\t%s\t%s\n' "$name" "$f"
  done
  for f in "$thread_dir"/done.review.*; do
    [[ -f "$f" ]] || continue
    name="$(basename "$f")"
    local rest="${name#done.review.}"
    local rn="${rest%%.*}"
    local rname="${rest#*.}"
    rname="${rname%.md}"
    printf 'done\treview\t%s\t%s\t%s\n' "$rn" "$rname" "$f"
  done
}

# --- Event log ---

_log_event() {
  local session_dir="$1" event="$2"
  shift 2
  local agent="${CLAUDE_AGENT_NAME:-unknown}"
  printf '%s\t%s\t%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$agent" "$event" "$*" >> "$session_dir/log"
}

# --- Reconciliation engine ---

_mode=""
_ok_count=0
_fixed_count=0
_error_count=0

_report_ok() {
  _ok_count=$((_ok_count + 1))
  if [[ "$_mode" == "doctor" ]]; then
    printf '  OK    %s\n' "$1"
  fi
}

_report_fixed() {
  _fixed_count=$((_fixed_count + 1))
  case "$_mode" in
    doctor) printf '  FIXED %s\n' "$1" ;;
    *) log "$1" ;;
  esac
}

_report_error() {
  _error_count=$((_error_count + 1))
  case "$_mode" in
    doctor) printf '  ERROR %s\n' "$1" ;;
    *) warn "$1" ;;
  esac
}

_report_warn() {
  case "$_mode" in
    doctor) printf '  WARN  %s\n' "$1" ;;
    *) warn "$1" ;;
  esac
}

_section() {
  if [[ "$_mode" == "doctor" ]]; then
    printf '\n%s\n' "$1"
  fi
}

_reconcile_excludes() {
  local info_exclude
  info_exclude="$(git rev-parse --git-path info/exclude)"
  mkdir -p "$(dirname "$info_exclude")"
  touch "$info_exclude"

  for pattern in ".session" ".sessions"; do
    if grep -Fxq "$pattern" "$info_exclude"; then
      _report_ok "$pattern in git excludes"
    else
      printf '%s\n' "$pattern" >>"$info_exclude"
      _report_fixed "added $pattern to git excludes"
    fi
  done
}

_reconcile_shared_sessions_root() {
  local repo_root_path="$1" main_root="$2" shared_root="$3"

  if [[ "$repo_root_path" == "$main_root" ]]; then
    if [[ -L "$shared_root" ]]; then
      _report_error ".sessions/ is a symlink in the main worktree (expected real directory)"
      return 0
    fi
    if [[ -f "$shared_root" ]]; then
      _report_error ".sessions/ is a regular file in the main worktree (expected directory; remove it manually)"
      return 0
    fi
    if [[ -d "$shared_root" ]]; then
      _report_ok ".sessions/ is a real directory"
    else
      mkdir -p "$shared_root"
      _report_fixed "created .sessions/ directory"
    fi
    return 0
  fi

  if [[ -f "$shared_root" ]]; then
    _report_error "$shared_root is a regular file in the main worktree (expected directory; remove it manually)"
    return 0
  fi
  if [[ -L "$shared_root" ]]; then
    _report_error "$shared_root is a symlink in the main worktree (expected real directory)"
    return 0
  fi
  if [[ ! -d "$shared_root" ]]; then
    mkdir -p "$shared_root"
    _report_fixed "created $shared_root in main worktree"
  fi

  local local_sessions="$repo_root_path/.sessions"
  if [[ -L "$local_sessions" ]]; then
    local actual_dest expected_dest
    if [[ -e "$local_sessions" ]]; then
      actual_dest=$(canonical_path "$local_sessions")
    else
      actual_dest=$(readlink "$local_sessions")
    fi
    expected_dest=$(canonical_path "$shared_root")
    if [[ "$actual_dest" == "$expected_dest" ]]; then
      _report_ok ".sessions/ symlink points to main worktree"
    else
      ln -sfn "$shared_root" "$local_sessions"
      _report_fixed ".sessions/ symlink repointed to $shared_root"
    fi
  elif [[ -e "$local_sessions" ]]; then
    _report_error ".sessions/ exists but is not a symlink (expected symlink to $shared_root)"
  else
    ln -sfn "$shared_root" "$local_sessions"
    _report_fixed "created .sessions/ symlink -> $shared_root"
  fi
}

_reconcile_session_directory() {
  local session_dir="$1" session_key="$2" issue_key="${3:-}"

  if [[ -d "$session_dir" ]]; then
    _report_ok "session directory exists"
  else
    mkdir -p "$session_dir"
    _report_fixed "created session directory"
  fi

  local session_file="$session_dir/SESSION.md"
  if [[ -f "$session_file" ]]; then
    _report_ok "SESSION.md exists"
  else
    session_template "$session_key" "$issue_key" >"$session_file"
    _report_fixed "created SESSION.md from template"
  fi
}

_reconcile_active_symlink() {
  local repo_root_path="$1" session_key="$2"
  local local_link="$repo_root_path/.session"
  local expected_target=".sessions/$session_key"

  if [[ -e "$local_link" && ! -L "$local_link" ]]; then
    _report_error ".session exists but is not a symlink (cannot autofix — remove manually)"
    return 0
  fi

  if [[ -L "$local_link" ]]; then
    local current_target
    current_target=$(readlink "$local_link")
    if [[ "$current_target" == "$expected_target" ]]; then
      _report_ok ".session -> $expected_target"
    else
      ln -sfn "$expected_target" "$local_link"
      _report_fixed ".session repointed: $current_target -> $expected_target"
    fi
  else
    ln -sfn "$expected_target" "$local_link"
    _report_fixed "created .session -> $expected_target"
  fi
}

_validate_session_md() {
  local session_file="$1" session_key="$2" session_dir="$3" issue_key="${4:-}"

  if [[ ! -f "$session_file" ]]; then
    return 0
  fi

  # Validate/autofix frontmatter issue_key for issue-scoped sessions
  if [[ -n "$issue_key" ]]; then
    if grep -q "^issue_key: $issue_key" "$session_file"; then
      _report_ok "SESSION.md has issue_key: $issue_key"
    elif [[ "$_mode" == "doctor" ]]; then
      # Autofix: prepend frontmatter
      local tmp
      tmp=$(mktemp)
      if head -1 "$session_file" | grep -q '^---$'; then
        # Has frontmatter block but missing issue_key — inject after opening ---
        sed "1a\\
issue_key: $issue_key" "$session_file" > "$tmp"
      else
        # No frontmatter at all — prepend full block
        printf '%s\n' "---" "issue_key: $issue_key" "---" "" > "$tmp"
        cat "$session_file" >> "$tmp"
      fi
      mv "$tmp" "$session_file"
      _report_fixed "SESSION.md: added frontmatter issue_key: $issue_key"
    else
      _report_error "SESSION.md missing frontmatter issue_key: $issue_key"
    fi
  fi

  local missing=()
  for section in "${REQUIRED_SESSION_SECTIONS[@]}"; do
    if ! grep -qE "^## ${section}" "$session_file"; then
      missing+=("$section")
    fi
  done

  if [[ ${#missing[@]} -eq 0 ]]; then
    _report_ok "SESSION.md has all required sections"
  else
    _report_error "SESSION.md missing sections: ${missing[*]} (regenerate with: rm SESSION.md && session sync)"
  fi
}

_validate_threads() {
  local session_dir="$1"
  local thread_count=0
  local entry name slug rest n

  for entry in "$session_dir"/thread.* "$session_dir"/done.thread.*; do
    [[ -d "$entry" ]] || continue
    name="$(basename "$entry")"
    thread_count=$((thread_count + 1))

    if [[ "$name" == done.thread.* ]]; then
      rest="${name#done.thread.}"
      n="${rest%%.*}"
      slug="${rest#*.}"
      if [[ "$n" =~ ^[0-9]+$ ]]; then
        _report_ok "done thread #$n: $slug"
      else
        _report_error "$name missing sequence number (expected done.thread.<n>.<slug>)"
      fi
    else
      slug="${name#thread.}"
      if [[ -f "$entry/tasks.md" ]]; then
        _report_ok "thread.$slug has tasks.md"
        # Check that tasks.md has frontmatter with created timestamp
        local _created
        _created=$(frontmatter_get "$entry/tasks.md" "created")
        if [[ -n "$_created" ]]; then
          _report_ok "thread.$slug tasks.md has created timestamp"
        else
          _report_error "thread.$slug tasks.md missing frontmatter (expected claimed_by, created)"
        fi
      else
        _report_error "thread.$slug missing tasks.md"
      fi
    fi
  done

  if [[ "$thread_count" -eq 0 ]]; then
    _report_ok "no threads yet (create with: session thread create <slug>)"
  fi

  # Check for sequence gaps
  local gaps
  gaps=$(detect_sequence_gaps "$session_dir" "thread")
  if [[ -n "$gaps" ]]; then
    _report_warn "done.thread sequence gaps: $(echo "$gaps" | tr '\n' ',' | sed 's/,$//')"
  fi

  # --- Enhanced checks (doctor mode only) ---
  if [[ "$_mode" != "doctor" ]]; then
    return 0
  fi

  _section "Checking thread health..."

  # 1. Unclaimed active thread warning
  for entry in "$session_dir"/thread.*; do
    [[ -d "$entry" ]] || continue
    name="$(basename "$entry")"
    slug="${name#thread.}"
    local _cb
    _cb=$(frontmatter_get "$entry/tasks.md" "claimed_by")
    if [[ -n "$_cb" ]]; then
      _report_ok "thread.$slug claimed by $_cb"
    else
      _report_warn "thread.$slug is unclaimed (no claimed_by in tasks.md frontmatter)"
    fi
  done

  # 2. Orphaned claim detection (claimed_by agent not in recent log events)
  local log_file="$session_dir/log"
  if [[ -f "$log_file" ]]; then
    for entry in "$session_dir"/thread.*; do
      [[ -d "$entry" ]] || continue
      name="$(basename "$entry")"
      slug="${name#thread.}"
      local _cb
      _cb=$(frontmatter_get "$entry/tasks.md" "claimed_by")
      if [[ -n "$_cb" ]]; then
        if grep -q "$_cb" "$log_file"; then
          _report_ok "thread.$slug claimer '$_cb' appears in event log"
        else
          _report_warn "thread.$slug claimed by '$_cb' but agent not found in event log (orphaned claim?)"
        fi
      fi
    done
  fi

  # 3. Debrief coverage (done threads without debrief.md)
  for entry in "$session_dir"/done.thread.*; do
    [[ -d "$entry" ]] || continue
    name="$(basename "$entry")"
    if [[ -f "$entry/debrief.md" ]]; then
      _report_ok "$name has debrief.md"
    else
      _report_warn "$name missing debrief.md"
    fi
  done

  # 4. Stale thread detection (active threads with no recent log activity)
  local stale_days
  stale_days=$(config_get "stale_thread_days")
  stale_days="${stale_days:-7}"
  if [[ -f "$log_file" ]]; then
    local now_epoch
    now_epoch=$(date +%s)
    for entry in "$session_dir"/thread.*; do
      [[ -d "$entry" ]] || continue
      name="$(basename "$entry")"
      slug="${name#thread.}"
      # Find last log entry mentioning this thread's slug
      local last_ts
      last_ts=$(grep "$slug" "$log_file" | tail -1 | cut -f1)
      if [[ -n "$last_ts" ]]; then
        local last_epoch
        last_epoch=$(date -j -f "%Y-%m-%dT%H:%M:%SZ" "$last_ts" "+%s" 2>/dev/null || echo 0)
        local age_days=$(( (now_epoch - last_epoch) / 86400 ))
        if (( age_days >= stale_days )); then
          _report_warn "thread.$slug is stale (last activity ${age_days}d ago, threshold: ${stale_days}d)"
        fi
      fi
    done
  fi
}

reconcile() {
  local repo_root_path main_root branch_name session_key issue_key shared_root session_dir

  repo_root_path=$(repo_root)
  main_root=$(main_worktree)
  branch_name=$(current_branch)
  session_key=$(resolve_session_key "$branch_name")
  issue_key=$(extract_issue_key "$branch_name")
  shared_root="$main_root/.sessions"
  session_dir="$shared_root/$session_key"

  _ok_count=0
  _fixed_count=0
  _error_count=0

  if [[ "$_mode" == "doctor" ]]; then
    printf 'Session doctor for %s\n' "$repo_root_path"
    printf '  branch:       %s\n' "${branch_name:-DETACHED}"
    printf '  session_key:  %s\n' "$session_key"
    printf '  main_worktree: %s\n' "$main_root"
  fi

  _section "Checking git excludes..."
  _reconcile_excludes

  _section "Checking .sessions/ store..."
  _reconcile_shared_sessions_root "$repo_root_path" "$main_root" "$shared_root"
  if [[ "$_mode" != "doctor" && "$_error_count" -gt 0 ]]; then
    return 1
  fi

  _section "Checking session directory contents..."
  _reconcile_session_directory "$session_dir" "$session_key" "$issue_key"
  if [[ "$_mode" != "doctor" && "$_error_count" -gt 0 ]]; then
    return 1
  fi

  _section "Checking .session symlink..."
  _reconcile_active_symlink "$repo_root_path" "$session_key"
  if [[ "$_mode" != "doctor" && "$_error_count" -gt 0 ]]; then
    return 1
  fi

  if [[ "$_mode" == "doctor" ]]; then
    _section "Validating SESSION.md content..."
    _validate_session_md "$session_dir/SESSION.md" "$session_key" "$session_dir" "$issue_key"

    _section "Checking threads..."
    _validate_threads "$session_dir"

    printf '\n--- Summary ---\n'
    printf '  OK: %d  FIXED: %d  ERROR: %d\n' "$_ok_count" "$_fixed_count" "$_error_count"
  fi

  [[ "$_error_count" -eq 0 ]]
}

# --- JSON helpers ---

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/	/\\t/g' | tr '\n' ' '
}

# --- Commands ---

# @cmd Show current session wiring for this checkout
# @flag --json Output as JSON
status() {
  local repo_root_path main_root branch_name session_key issue_key session_dir
  repo_root_path=$(repo_root)
  main_root=$(main_worktree)
  branch_name=$(current_branch)
  session_key=$(resolve_session_key "$branch_name")
  issue_key=$(extract_issue_key "$branch_name")
  session_dir="$main_root/.sessions/$session_key"

  if [[ "${argc_json:-}" == "1" ]]; then
    local issue_url=""
    [[ -n "$issue_key" ]] && issue_url=$(linear_issue_url "$issue_key")
    printf '{'
    printf '"repo_root":"%s",' "$repo_root_path"
    printf '"main_worktree":"%s",' "$main_root"
    printf '"branch":"%s",' "${branch_name:-DETACHED}"
    printf '"session_key":"%s",' "$session_key"
    printf '"issue_key":%s,' "${issue_key:+\"$issue_key\"}"
    printf '"issue_url":%s,' "${issue_url:+\"$issue_url\"}"
    printf '"session_dir":"%s",' "$session_dir"
    printf '"threads":['
    local first=true
    list_threads "$session_dir" | while IFS=$'\t' read -r st n slug; do
      [[ "$first" == "true" ]] || printf ','
      first=false
      if [[ "$st" == "done" ]]; then
        printf '{"status":"done","n":%s,"slug":"%s"}' "$n" "$slug"
      else
        printf '{"status":"active","slug":"%s"}' "$slug"
      fi
    done
    printf ']}\n'
    return
  fi

  echo "repo_root=$repo_root_path"
  echo "main_worktree=$main_root"
  echo "branch=${branch_name:-DETACHED}"
  echo "session_key=$session_key"
  echo "issue_key=${issue_key:-}"
  [[ -n "$issue_key" ]] && echo "issue_url=$(linear_issue_url "$issue_key")"
  echo "session_dir=$session_dir"

  echo "threads:"
  list_threads "$session_dir" | while IFS=$'\t' read -r st n slug; do
    if [[ "$st" == "done" ]]; then
      echo "  done #$n $slug"
    else
      echo "  active $slug"
    fi
  done
}

# Extract a ## section from SESSION.md, including subsections (###, ####, etc.)
# Stops at the next ## heading at the same level, or EOF.
_extract_section() {
  local file="$1" section="$2"
  awk -v section="$section" '
    $0 == "## " section { found = 1; next }
    found && /^## [^#]/ { exit }
    found { print }
  ' "$file"
}

# @cmd Full session context for agent preflight (mission, decisions, threads, files)
# @flag --json Output as JSON
# @flag --brief One-line summary for dispatchers
# @flag --inject Compact block for hook injection (session state + conventions + routing)
context() {
  local main_root branch_name session_key issue_key session_dir session_file
  main_root=$(main_worktree)
  branch_name=$(current_branch)
  session_key=$(resolve_session_key "$branch_name")
  issue_key=$(extract_issue_key "$branch_name")
  session_dir="$main_root/.sessions/$session_key"
  session_file="$session_dir/SESSION.md"

  # Count threads
  local active_count=0 done_count=0 active_slugs=""
  list_threads "$session_dir" | while IFS=$'\t' read -r st n slug; do
    if [[ "$st" == "done" ]]; then
      done_count=$((done_count + 1))
    else
      active_count=$((active_count + 1))
      [[ -n "$active_slugs" ]] && active_slugs="$active_slugs, "
      active_slugs="$active_slugs$slug"
    fi
    # Export for brief mode
    printf '%s\t%s\t%s\t%s\n' "$active_count" "$done_count" "$active_slugs" "$st"
  done > /dev/null

  # Re-count (subshell above doesn't export)
  active_count=0; done_count=0; active_slugs=""
  while IFS=$'\t' read -r st n slug; do
    if [[ "$st" == "done" ]]; then
      done_count=$((done_count + 1))
    else
      active_count=$((active_count + 1))
      [[ -n "$active_slugs" ]] && active_slugs="$active_slugs, "
      active_slugs="$active_slugs$slug"
    fi
  done < <(list_threads "$session_dir")

  # Brief mode
  if [[ "${argc_brief:-}" == "1" ]]; then
    local issue_url=""
    [[ -n "$issue_key" ]] && issue_url=" | $(linear_issue_url "$issue_key")"
    local active_info=""
    if [[ "$active_count" -gt 0 ]]; then
      active_info=" ($active_slugs)"
    fi
    printf '%s | %d active%s | %d done%s\n' "$session_key" "$active_count" "$active_info" "$done_count" "$issue_url"
    return
  fi

  # Inject mode: compact block for hook injection
  if [[ "${argc_inject:-}" == "1" ]]; then
    local S="$session_key"
    local issue_line=""
    [[ -n "$issue_key" ]] && issue_line="Issue: $issue_key — $(linear_issue_url "$issue_key")"

    # Worktree model
    local repo_root_path wt_type wt_shared
    repo_root_path=$(repo_root)
    wt_shared="$main_root/.sessions/"
    if [[ "$repo_root_path" == "$main_root" ]]; then
      wt_type="main"
    else
      wt_type="linked"
    fi

    cat <<'CONVENTIONS'
<session-context>
CONVENTIONS
    printf 'Session: %s\n' "$S"
    [[ -n "$issue_line" ]] && printf '%s\n' "$issue_line"
    printf 'Worktree: %s (%s)\n' "$repo_root_path" "$wt_type"
    printf 'Shared store: %s\n' "$wt_shared"
    printf 'Note: Thread files are shared across worktrees. Code is worktree-local.\n'

    # Mission (first non-empty line only)
    if [[ -f "$session_file" ]]; then
      local mission_line
      mission_line=$(_extract_section "$session_file" "Mission" | sed '/^$/d' | head -1)
      [[ -n "$mission_line" ]] && printf 'Mission: %s\n' "$mission_line"
    fi

    # Threads
    if [[ "$active_count" -gt 0 || "$done_count" -gt 0 ]]; then
      printf '\nThreads:\n'
      list_threads "$session_dir" | while IFS=$'\t' read -r st n slug; do
        if [[ "$st" == "done" ]]; then
          printf '  done #%s %s\n' "$n" "$slug"
        else
          local td="$session_dir/thread.$slug"
          local claimed=""
          local _cb
          _cb=$(frontmatter_get "$td/tasks.md" "claimed_by")
          [[ -n "$_cb" ]] && claimed=" [$_cb]"
          printf '  active %s%s\n' "$slug" "$claimed"
          list_thread_files "$td" | while IFS=$'\t' read -r fst ftype fn fname fpath; do
            case "$fst/$ftype" in
              active/plan)    printf '    plan.md\n' ;;
              done/plan)      printf '    done.plan.%s.md (locked)\n' "$fn" ;;
              active/tasks)   printf '    tasks.md\n' ;;
              active/debrief) printf '    debrief.md\n' ;;
              active/review)  printf '    review.%s.md (open)\n' "$fname" ;;
              done/review)    printf '    done.review.%s.%s.md (closed)\n' "$fn" "$fname" ;;
            esac
          done
        fi
      done
    fi

    local cli="~/.claude/skills/session/scripts/session.sh"
    local ref="~/.claude/skills/session/reference.md"
    cat <<RULES

CLI: $cli
Ref: $ref (read for full conventions, worktree model, naming grammar)
Routing:
- Your thread is .session/thread.<slug>/. Stay in it.
- CLI for lifecycle: $cli thread {create,done,resume,list,show,exists,which}
- CLI for mutations: $cli thread tasks {add,check}, plan lock, review {create,close}
- CLI for coordination: $cli thread claim {set,release,check}
- CLI for protocol: $cli start, $cli stop
- Read/Edit for content: writing plans, reviews, task reasoning.
RULES
    cat <<'CONVENTIONS'
</session-context>
CONVENTIONS
    return
  fi

  if [[ "${argc_json:-}" == "1" ]]; then
    local issue_url=""
    [[ -n "$issue_key" ]] && issue_url=$(linear_issue_url "$issue_key")
    local mission="" decisions=""
    if [[ -f "$session_file" ]]; then
      mission=$(_extract_section "$session_file" "Mission")
      decisions=$(_extract_section "$session_file" "Decisions")
    fi
    printf '{"session_key":"%s"' "$session_key"
    printf ',"issue_key":%s' "${issue_key:+\"$issue_key\"}"
    printf ',"issue_url":%s' "${issue_url:+\"$issue_url\"}"
    printf ',"mission":"%s"' "$(json_escape "$mission")"
    printf ',"decisions":"%s"' "$(json_escape "$decisions")"
    printf ',"threads":['
    local first=true
    list_threads "$session_dir" | while IFS=$'\t' read -r st n slug; do
      [[ "$first" == "true" ]] || printf ','
      first=false
      if [[ "$st" == "done" ]]; then
        printf '{"status":"done","n":%s,"slug":"%s"}' "$n" "$slug"
      else
        local td="$session_dir/thread.$slug"
        printf '{"status":"active","slug":"%s","files":[' "$slug"
        local ffirst=true
        list_thread_files "$td" | while IFS=$'\t' read -r fst ftype fn fname fpath; do
          [[ "$ffirst" == "true" ]] || printf ','
          ffirst=false
          printf '{"status":"%s","type":"%s"' "$fst" "$ftype"
          [[ "$fn" != "-" ]] && printf ',"n":%s' "$fn"
          [[ "$fname" != "-" ]] && printf ',"name":"%s"' "$fname"
          printf '}'
        done
        printf ']}'
      fi
    done
    printf ']}\n'
    return
  fi

  # Human-readable markdown output
  printf '# Session: %s\n\n' "$session_key"

  if [[ -n "$issue_key" ]]; then
    printf '%s\n\n' "**Issue:** [$issue_key]($(linear_issue_url "$issue_key"))"
  fi

  if [[ -f "$session_file" ]]; then
    local mission decisions
    mission=$(_extract_section "$session_file" "Mission")
    decisions=$(_extract_section "$session_file" "Decisions")
    if [[ -n "$mission" ]]; then
      printf '## Mission\n%s\n' "$mission"
    fi
    if [[ -n "$decisions" ]]; then
      printf '\n## Decisions\n%s\n' "$decisions"
    fi
  fi

  # Linear documents
  local linear_dir="$session_dir/linear"
  if [[ -d "$linear_dir" ]]; then
    local has_docs=false
    if [[ -f "$linear_dir/issue.json" ]]; then
      local issue_title
      issue_title=$(awk -F'"' '/"title"/ { print $4; exit }' "$linear_dir/issue.json")
      if [[ -n "$issue_title" ]]; then
        printf '\n## Linear Issue\n\n'
        printf '%s\n' "**$issue_key:** $issue_title"
        has_docs=true
      fi
    fi
    if [[ -d "$linear_dir/documents" ]]; then
      local doc
      for doc in "$linear_dir/documents"/*.md; do
        [[ -f "$doc" ]] || continue
        if [[ "$has_docs" == "false" ]]; then
          printf '\n## Linear Documents\n\n'
          has_docs=true
        fi
        printf '%s\n' "- $(basename "$doc" .md)"
      done
    fi
  fi

  printf '\n## Threads\n\n'
  if [[ "$active_count" -eq 0 && "$done_count" -eq 0 ]]; then
    printf '%s\n' 'No threads yet. Create with: `session thread create <slug>`'
  else
    list_threads "$session_dir" | while IFS=$'\t' read -r st n slug; do
      if [[ "$st" == "done" ]]; then
        printf '%s\n' "- ~~#$n $slug~~ (done)"
      else
        printf '%s\n' "- **$slug** (active)"
        local td="$session_dir/thread.$slug"
        list_thread_files "$td" | while IFS=$'\t' read -r fst ftype fn fname fpath; do
          case "$fst/$ftype" in
            active/plan)    printf '  - plan.md\n' ;;
            done/plan)      printf '  - ~~done.plan.%s.md~~ (locked)\n' "$fn" ;;
            active/tasks)   printf '  - tasks.md\n' ;;
            active/debrief) printf '  - debrief.md\n' ;;
            active/review)  printf '  - review.%s.md\n' "$fname" ;;
            done/review)    printf '  - ~~done.review.%s.%s.md~~ (closed)\n' "$fn" "$fname" ;;
          esac
        done
      fi
    done
  fi
}

# @cmd Sync the current checkout's session wiring
sync() {
  _mode="sync"
  reconcile
}

# @cmd Sync session wiring for every current git worktree
sync_all() {
  local cli_path failure_count

  cli_path="$(script_path)"
  failure_count=0

  while IFS= read -r worktree_root; do
    if [[ -z "$worktree_root" ]]; then
      continue
    fi

    if (cd "$worktree_root" && "$cli_path" sync >/dev/null); then
      log "synced $worktree_root"
    else
      warn "failed to sync $worktree_root"
      failure_count=$((failure_count + 1))
    fi
  done < <(list_worktrees)

  [[ "$failure_count" -eq 0 ]]
}

# @cmd Sync session wiring for git-hook automation (exits non-zero on failure)
hook_sync() {
  _mode="hook"
  if ! reconcile; then
    warn "hook sync failed — run 'session doctor' to diagnose"
    return 1
  fi
}

# @cmd Diagnose and autofix session wiring issues
doctor() {
  _mode="doctor"
  reconcile
}

# --- Thread lifecycle commands ---

_resolve_session_dir() {
  local main_root branch_name session_key
  main_root=$(main_worktree)
  branch_name=$(current_branch)
  session_key=$(resolve_session_key "$branch_name")
  printf '%s/.sessions/%s\n' "$main_root" "$session_key"
}

# @cmd Thread lifecycle commands
thread() { :; }

# @cmd Create a new thread
# @arg slug! Thread slug (e.g. "schema-design")
# @flag --plan Also scaffold plan.md
# @flag --no-claim Skip auto-claiming the thread
# @flag --worktree Create a git worktree for this thread
# @option --base Base branch for the worktree (default: config worktree.base_branch or current branch)
# @option --dir Worktree directory template (default: config worktree.directory or "../{repo}-{slug}")
thread::create() {
  validate_slug "$argc_slug"

  local worktree_dir=""

  # --- Worktree creation (before thread, since sync changes session context) ---
  if [[ "${argc_worktree:-}" == "1" ]]; then
    local base_branch dir_template repo_name repo_root_path

    # Resolve base branch: --base > config > current branch
    base_branch="${argc_base:-$(config_get "worktree.base_branch")}"
    base_branch="${base_branch:-$(current_branch)}"
    if [[ -z "$base_branch" ]]; then
      warn "cannot determine base branch (detached HEAD and no --base or config)"
      return 1
    fi

    # Verify base branch exists
    if ! git rev-parse --verify "$base_branch" >/dev/null 2>&1; then
      warn "base branch '$base_branch' does not exist"
      return 1
    fi

    # Resolve directory template: --dir > config > default
    # Note: the default uses {braces} which can't go inside ${:-} directly (bash parser
    # treats the first } as closing the parameter expansion). Use a variable instead.
    local default_dir_template='../{repo}-{slug}'
    dir_template="${argc_dir:-$(config_get "worktree.directory")}"
    dir_template="${dir_template:-$default_dir_template}"

    # Expand template variables
    repo_root_path="$(repo_root)"
    repo_name="$(basename "$repo_root_path")"
    worktree_dir="${dir_template//\{repo\}/$repo_name}"
    worktree_dir="${worktree_dir//\{slug\}/$argc_slug}"
    worktree_dir="${worktree_dir//\{branch\}/$base_branch}"

    # Resolve to absolute path (relative paths are relative to repo root)
    if [[ "$worktree_dir" != /* ]]; then
      worktree_dir="$repo_root_path/$worktree_dir"
    fi

    # Check for existing directory
    if [[ -e "$worktree_dir" ]]; then
      warn "path already exists: $worktree_dir"
      return 1
    fi

    # Check for existing branch with same name as slug
    if git rev-parse --verify "$argc_slug" >/dev/null 2>&1; then
      warn "branch '$argc_slug' already exists; use a different slug or remove the branch"
      return 1
    fi

    # Create the worktree with a new branch named after the slug
    git worktree add -b "$argc_slug" "$worktree_dir" "$base_branch"
    log "created worktree at $worktree_dir (branch: $argc_slug from $base_branch)"

    # Canonicalize the path now that the directory exists
    worktree_dir="$(canonical_path "$worktree_dir")"

    # Run session sync in the new worktree to set up .sessions symlink + session dir
    local cli_path
    cli_path="$(script_path)"
    (cd "$worktree_dir" && "$cli_path" sync)
  fi

  # --- Thread creation ---
  local session_dir thread_dir

  if [[ -n "$worktree_dir" ]]; then
    # In worktree mode, resolve session from the new worktree's branch (= the slug)
    local wt_session_key
    wt_session_key=$(resolve_session_key "$argc_slug")
    local main_root
    main_root=$(main_worktree)
    session_dir="$main_root/.sessions/$wt_session_key"
    mkdir -p "$session_dir"
  else
    session_dir=$(_resolve_session_dir)
  fi

  thread_dir="$session_dir/thread.$argc_slug"

  # Idempotent: succeed silently if already exists
  if [[ -d "$thread_dir" ]]; then
    printf '%s\n' "$thread_dir"
    return 0
  fi

  mkdir -p "$thread_dir"

  # Build frontmatter for tasks.md
  local created
  created="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  local agent="${CLAUDE_AGENT_NAME:-}"
  local claim_line=""
  if [[ "${argc_no_claim:-}" != "1" && -n "$agent" ]]; then
    claim_line="claimed_by: $agent"
  fi

  {
    printf '%s\n' "---"
    [[ -n "$claim_line" ]] && printf '%s\n' "$claim_line"
    printf '%s\n' "created: $created"
    [[ -n "$worktree_dir" ]] && printf '%s\n' "worktree: $worktree_dir"
    printf '%s\n' "---"
    cat <<EOF

# Thread: $argc_slug

### Active

### Todo

### Done
EOF
  } > "$thread_dir/tasks.md"

  if [[ "${argc_plan:-}" == "1" ]]; then
    cat > "$thread_dir/plan.md" <<EOF
# Plan: $argc_slug

## Goal

## Approach

## Tasks
EOF
  fi

  # Log claim event if we auto-claimed
  if [[ "${argc_no_claim:-}" != "1" && -n "$agent" ]]; then
    _log_event "$session_dir" "thread.claim" "$argc_slug by $agent"
  fi

  _log_event "$session_dir" "thread.create" "$argc_slug${worktree_dir:+ (worktree: $worktree_dir)}"

  # Set current-thread marker when creating with worktree
  if [[ -n "$worktree_dir" ]]; then
    printf '%s\n' "$argc_slug" > "$session_dir/.current-thread"
  fi

  log "created thread.$argc_slug"
  [[ -n "$worktree_dir" ]] && log "worktree: $worktree_dir"

  # Run post_create hooks from config
  if [[ -n "$worktree_dir" ]]; then
    local post_create_cmd
    while IFS= read -r post_create_cmd; do
      [[ -z "$post_create_cmd" ]] && continue
      log "running post_create: $post_create_cmd"
      (cd "$worktree_dir" && eval "$post_create_cmd") || warn "post_create command failed: $post_create_cmd"
    done < <(config_get_list "worktree.post_create")
  fi

  printf '%s\n' "$thread_dir"
}

# @cmd Mark a thread as done (assigns next sequence number)
# @arg slug! Thread slug to complete
# @option --note Closing note to append to tasks.md
# @flag --force Complete even if thread has active reviews
# @flag --rm-worktree Also remove the git worktree associated with this thread
thread::done() {
  validate_slug "$argc_slug"
  local session_dir thread_dir n dest
  session_dir=$(_resolve_session_dir)
  thread_dir="$session_dir/thread.$argc_slug"

  if [[ ! -d "$thread_dir" ]]; then
    warn "thread.$argc_slug does not exist"
    return 1
  fi

  # --- Pre-flight: read worktree path and validate before mutating ---
  local worktree_path=""
  if [[ "${argc_rm_worktree:-}" == "1" ]]; then
    worktree_path=$(frontmatter_get "$thread_dir/tasks.md" "worktree")
    if [[ -z "$worktree_path" ]]; then
      warn "no worktree recorded for thread.$argc_slug (was it created with --worktree?)"
      return 1
    fi
    if [[ ! -d "$worktree_path" ]]; then
      warn "worktree directory does not exist: $worktree_path (already removed?)"
      # Clear the flag — worktree is gone, proceed with thread done
      worktree_path=""
    else
      # Safety: refuse if worktree has uncommitted or untracked changes
      if (cd "$worktree_path" && [[ -n "$(git status --porcelain 2>/dev/null)" ]]); then
        warn "worktree at $worktree_path has uncommitted or untracked changes; commit, stash, or clean first"
        return 1
      fi
    fi
  fi

  # Check for active reviews unless --force
  if [[ "${argc_force:-}" != "1" ]]; then
    local active_reviews=0
    for f in "$thread_dir"/review.*.md; do
      [[ -f "$f" ]] && active_reviews=$((active_reviews + 1))
    done
    if [[ "$active_reviews" -gt 0 ]]; then
      warn "thread.$argc_slug has $active_reviews active review(s); close them first or use --force"
      return 1
    fi
  fi

  # Append closing note if provided
  if [[ -n "${argc_note:-}" ]]; then
    printf '\n---\n**Closed:** %s\n' "$argc_note" >> "$thread_dir/tasks.md"
  fi

  # Lock: prevent concurrent done operations (macOS-compatible mkdir lock)
  local lockdir="$session_dir/.thread-done.lock"
  # Clean up stale regular file from old flock approach
  [[ -f "$lockdir" ]] && rm -f "$lockdir"
  local lock_acquired=false
  for _attempt in 1 2 3 4 5; do
    if mkdir "$lockdir" 2>/dev/null; then
      lock_acquired=true
      break
    fi
    sleep 1
  done
  if [[ "$lock_acquired" != "true" ]]; then
    warn "could not acquire lock for thread done (rmdir $lockdir to force)"
    return 1
  fi

  n=$(next_done_number "$session_dir" "thread")
  dest="$session_dir/done.thread.$n.$argc_slug"
  mv "$thread_dir" "$dest"
  rmdir "$lockdir" 2>/dev/null || true
  _log_event "$session_dir" "thread.done" "#$n $argc_slug"
  log "thread.$argc_slug -> done.thread.$n.$argc_slug"

  # --- Remove worktree if requested ---
  if [[ -n "$worktree_path" ]]; then
    git worktree remove "$worktree_path"
    _log_event "$session_dir" "worktree.remove" "$worktree_path"
    log "removed worktree at $worktree_path"
  fi

  printf '%s\n' "$dest"
}

# @cmd List threads in the current session
# @flag --json Output as JSON
thread::list() {
  local session_dir
  session_dir=$(_resolve_session_dir)

  if [[ "${argc_json:-}" == "1" ]]; then
    printf '['
    local first=true
    list_threads "$session_dir" | while IFS=$'\t' read -r st n slug; do
      [[ "$first" == "true" ]] || printf ','
      first=false
      if [[ "$st" == "done" ]]; then
        printf '{"status":"done","n":%s,"slug":"%s"}' "$n" "$slug"
      else
        printf '{"status":"active","slug":"%s"}' "$slug"
      fi
    done
    printf ']\n'
    return
  fi

  list_threads "$session_dir" | while IFS=$'\t' read -r st n slug; do
    if [[ "$st" == "done" ]]; then
      printf 'done\t#%s\t%s\n' "$n" "$slug"
    else
      printf 'active\t\t%s\n' "$slug"
    fi
  done
}

# @cmd Show detailed inventory of a single thread
# @arg slug! Thread slug
# @flag --json Output as JSON
thread::show() {
  local session_dir thread_dir
  session_dir=$(_resolve_session_dir)

  if ! thread_dir=$(find_thread_dir "$session_dir" "$argc_slug"); then
    warn "thread $argc_slug not found"
    return 1
  fi

  local dir_name
  dir_name="$(basename "$thread_dir")"
  local thread_status="active"
  [[ "$dir_name" == done.thread.* ]] && thread_status="done"

  if [[ "${argc_json:-}" == "1" ]]; then
    printf '{"slug":"%s","status":"%s","dir":"%s","files":[' "$argc_slug" "$thread_status" "$thread_dir"
    local first=true
    list_thread_files "$thread_dir" | while IFS=$'\t' read -r fst ftype fn fname fpath; do
      [[ "$first" == "true" ]] || printf ','
      first=false
      printf '{"status":"%s","type":"%s"' "$fst" "$ftype"
      [[ "$fn" != "-" ]] && printf ',"n":%s' "$fn"
      [[ "$fname" != "-" ]] && printf ',"name":"%s"' "$fname"
      printf ',"path":"%s"}' "$fpath"
    done
    # Check claim
    local claimed_by=""
    claimed_by=$(frontmatter_get "$thread_dir/tasks.md" "claimed_by")
    printf '],"claimed_by":%s}\n' "${claimed_by:+\"$claimed_by\"}"
    return
  fi

  printf 'Thread: %s (%s)\n' "$argc_slug" "$thread_status"
  printf 'Dir: %s\n' "$thread_dir"
  local claimed_by=""
  claimed_by=$(frontmatter_get "$thread_dir/tasks.md" "claimed_by")
  if [[ -n "$claimed_by" ]]; then
    printf 'Claimed by: %s\n' "$claimed_by"
  fi
  printf '\nFiles:\n'
  list_thread_files "$thread_dir" | while IFS=$'\t' read -r fst ftype fn fname fpath; do
    case "$fst/$ftype" in
      active/plan)    printf '  plan.md (active)\n' ;;
      done/plan)      printf '  done.plan.%s.md (locked)\n' "$fn" ;;
      active/tasks)   printf '  tasks.md\n' ;;
      active/debrief) printf '  debrief.md\n' ;;
      active/review)  printf '  review.%s.md (open)\n' "$fname" ;;
      done/review)    printf '  done.review.%s.%s.md (closed)\n' "$fn" "$fname" ;;
    esac
  done
}

# @cmd Check if a thread exists (exit 0 if yes, exit 1 if no)
# @arg slug! Thread slug to check
thread::exists() {
  local session_dir
  session_dir=$(_resolve_session_dir)
  find_thread_dir "$session_dir" "$argc_slug" > /dev/null
}

# @cmd Get or set the current thread for this agent
# @arg slug Thread slug to set (omit to get current)
thread::which() {
  local session_dir
  session_dir=$(_resolve_session_dir)
  local marker="$session_dir/.current-thread"

  if [[ -n "${argc_slug:-}" ]]; then
    validate_slug "$argc_slug"
    if ! find_thread_dir "$session_dir" "$argc_slug" > /dev/null; then
      warn "thread $argc_slug does not exist"
      return 1
    fi
    printf '%s\n' "$argc_slug" > "$marker"
    log "current thread set to $argc_slug"
  else
    if [[ -f "$marker" ]]; then
      cat "$marker"
    else
      warn "no current thread set"
      return 1
    fi
  fi
}

# @cmd Resume a done thread (move back to active)
# @arg n! Sequence number of the done thread
thread::resume() {
  local session_dir
  session_dir=$(_resolve_session_dir)

  local found=""
  for d in "$session_dir"/done.thread."$argc_n".*; do
    [[ -d "$d" ]] && found="$d" && break
  done

  if [[ -z "$found" ]]; then
    warn "done.thread.$argc_n.* not found"
    return 1
  fi

  local dir_name slug
  dir_name="$(basename "$found")"
  slug="${dir_name#done.thread."$argc_n".}"
  local dest="$session_dir/thread.$slug"

  if [[ -d "$dest" ]]; then
    warn "thread.$slug already exists as active — cannot resume"
    return 1
  fi

  mv "$found" "$dest"
  _log_event "$session_dir" "thread.resume" "#$argc_n $slug"
  log "done.thread.$argc_n.$slug -> thread.$slug"
  printf '%s\n' "$dest"
}

# @cmd Claim/unclaim/check thread ownership
thread::claim() { :; }

# @cmd Claim a thread for this agent
# @arg slug! Thread slug
# @option --agent Agent name (defaults to CLAUDE_AGENT_NAME)
thread::claim::set() {
  local session_dir thread_dir agent
  session_dir=$(_resolve_session_dir)
  agent="${argc_agent:-${CLAUDE_AGENT_NAME:-unknown}}"

  if ! thread_dir=$(find_thread_dir "$session_dir" "$argc_slug"); then
    warn "thread $argc_slug not found"
    return 1
  fi

  frontmatter_set "$thread_dir/tasks.md" "claimed_by" "$agent"
  _log_event "$session_dir" "thread.claim" "$argc_slug by $agent"
  log "thread.$argc_slug claimed by $agent"
}

# @cmd Release a thread claim
# @arg slug! Thread slug
thread::claim::release() {
  local session_dir thread_dir
  session_dir=$(_resolve_session_dir)

  if ! thread_dir=$(find_thread_dir "$session_dir" "$argc_slug"); then
    warn "thread $argc_slug not found"
    return 1
  fi

  frontmatter_set "$thread_dir/tasks.md" "claimed_by" ""
  _log_event "$session_dir" "thread.unclaim" "$argc_slug"
  log "thread.$argc_slug claim released"
}

# @cmd Check who claimed a thread (exit 0 + print if claimed, exit 1 if not)
# @arg slug! Thread slug
thread::claim::check() {
  local session_dir thread_dir
  session_dir=$(_resolve_session_dir)

  if ! thread_dir=$(find_thread_dir "$session_dir" "$argc_slug"); then
    warn "thread $argc_slug not found"
    return 1
  fi

  local claimed_by
  claimed_by=$(frontmatter_get "$thread_dir/tasks.md" "claimed_by")
  if [[ -n "$claimed_by" ]]; then
    printf '%s\n' "$claimed_by"
  else
    return 1
  fi
}

# @cmd Plan operations
thread::plan() { :; }

# @cmd Lock a plan (alias for mark done <slug> plan)
# @arg slug! Thread slug
thread::plan::lock() {
  argc_thread_slug="$argc_slug"
  argc_type="plan"
  argc_name=""
  mark::done
}

# @cmd Review operations
thread::review() { :; }

# @cmd Create a review file in a thread
# @arg slug! Thread slug
# @arg name! Review name (e.g. "quality", "perf")
thread::review::create() {
  local session_dir thread_dir
  session_dir=$(_resolve_session_dir)

  if ! thread_dir=$(find_thread_dir "$session_dir" "$argc_slug"); then
    warn "thread $argc_slug not found"
    return 1
  fi

  local review_file="$thread_dir/review.$argc_name.md"
  if [[ -f "$review_file" ]]; then
    printf '%s\n' "$review_file"
    return 0
  fi

  cat > "$review_file" <<EOF
# Review: $argc_name

Thread: $argc_slug

## Findings

## Actions
EOF

  _log_event "$session_dir" "review.create" "$argc_slug/$argc_name"
  log "created review.$argc_name.md in thread.$argc_slug"
  printf '%s\n' "$review_file"
}

# @cmd Close a review (alias for mark done <slug> review <name>)
# @arg slug! Thread slug
# @arg name! Review name
thread::review::close() {
  argc_thread_slug="$argc_slug"
  argc_type="review"
  # argc_name already set by argc
  mark::done
}

# @cmd Task operations within a thread
thread::tasks() { :; }

# @cmd Add a task item to a thread's tasks.md
# @arg slug! Thread slug
# @arg item! Task item text
# @option --section Target section (default: "Todo")
thread::tasks::add() {
  local session_dir thread_dir tasks_file section
  session_dir=$(_resolve_session_dir)
  section="${argc_section:-Todo}"

  if ! thread_dir=$(find_thread_dir "$session_dir" "$argc_slug"); then
    warn "thread $argc_slug not found"
    return 1
  fi

  tasks_file="$thread_dir/tasks.md"
  if [[ ! -f "$tasks_file" ]]; then
    warn "tasks.md not found in thread $argc_slug"
    return 1
  fi

  # Insert the item after the target section header
  local tmp
  tmp=$(mktemp)
  awk -v section="### $section" -v item="- [ ] $argc_item" '
    printed == 0 && $0 == section { print; print ""; print item; printed = 1; next }
    { print }
  ' "$tasks_file" > "$tmp"
  mv "$tmp" "$tasks_file"

  _log_event "$session_dir" "task.add" "$argc_slug: $argc_item"
  log "added task to thread.$argc_slug ($section)"
}

# @cmd Check off a task item by line number
# @arg slug! Thread slug
# @arg line! Line number to check off
thread::tasks::check() {
  local session_dir thread_dir tasks_file
  session_dir=$(_resolve_session_dir)

  if ! thread_dir=$(find_thread_dir "$session_dir" "$argc_slug"); then
    warn "thread $argc_slug not found"
    return 1
  fi

  tasks_file="$thread_dir/tasks.md"
  if [[ ! -f "$tasks_file" ]]; then
    warn "tasks.md not found in thread $argc_slug"
    return 1
  fi

  local tmp
  tmp=$(mktemp)
  awk -v target="$argc_line" '
    NR == target { sub(/- \[ \]/, "- [x]") }
    { print }
  ' "$tasks_file" > "$tmp"
  mv "$tmp" "$tasks_file"

  _log_event "$session_dir" "task.check" "$argc_slug:L$argc_line"
  log "checked task at line $argc_line in thread.$argc_slug"
}

# @cmd Mark items as done (assigns next sequence number)
mark() { :; }

# @cmd Mark a file as done within a thread
# @arg thread_slug! Thread slug containing the file
# @arg type! File type to mark done (plan, review)
# @arg name File qualifier (required for review, omitted for plan)
mark::done() {
  local session_dir thread_dir src n dest
  session_dir=$(_resolve_session_dir)

  if ! thread_dir=$(find_thread_dir "$session_dir" "$argc_thread_slug"); then
    warn "thread $argc_thread_slug not found"
    return 1
  fi

  case "$argc_type" in
    plan)
      src="$thread_dir/plan.md"
      ;;
    review)
      if [[ -z "${argc_name:-}" ]]; then
        warn "review type requires a name argument"
        return 1
      fi
      src="$thread_dir/review.$argc_name.md"
      ;;
    *)
      warn "unknown type: $argc_type (expected: plan, review)"
      return 1
      ;;
  esac

  if [[ ! -f "$src" ]]; then
    warn "$(basename "$src") does not exist in $(basename "$thread_dir")"
    return 1
  fi

  n=$(next_done_number "$thread_dir" "$argc_type")
  case "$argc_type" in
    plan)   dest="$thread_dir/done.plan.$n.md" ;;
    review) dest="$thread_dir/done.review.$n.$argc_name.md" ;;
  esac

  mv "$src" "$dest"
  _log_event "$session_dir" "$argc_type.done" "$argc_thread_slug: $(basename "$src") -> $(basename "$dest")"
  log "$(basename "$src") -> $(basename "$dest")"
  printf '%s\n' "$dest"
}

# @cmd Show session event log
# @option --tail Number of recent entries (default: 20)
log_show() {
  local session_dir
  session_dir=$(_resolve_session_dir)
  local log_file="$session_dir/log"

  if [[ ! -f "$log_file" ]]; then
    echo "No events logged yet."
    return 0
  fi

  local n="${argc_tail:-20}"
  tail -n "$n" "$log_file" | while IFS=$'\t' read -r ts agent event detail; do
    printf '%s  %-12s  %-16s  %s\n' "$ts" "$agent" "$event" "$detail"
  done
}

# --- Protocol commands ---

# @cmd Run the start protocol (sync, inject context, log event)
# @arg thread Thread slug to auto-claim (optional)
start() {
  local session_dir cli_path

  cli_path="$(script_path)"

  # 1. Sync wiring
  "$cli_path" sync

  session_dir=$(_resolve_session_dir)

  # 2. Auto-claim thread if specified
  if [[ -n "${argc_thread:-}" ]]; then
    local agent="${CLAUDE_AGENT_NAME:-}"
    if [[ -n "$agent" ]]; then
      "$cli_path" thread claim set "$argc_thread" --agent "$agent" 2>/dev/null || true
    fi
  fi

  # 3. Log start event
  _log_event "$session_dir" "agent.start" "${argc_thread:+thread=$argc_thread}"

  # 4. Output inject context
  "$cli_path" context --inject
}

# @cmd Run the stop protocol (release claim, log event, summary)
# @arg thread Thread slug to release (optional)
stop() {
  local session_dir cli_path

  cli_path="$(script_path)"
  session_dir=$(_resolve_session_dir)

  # 1. Release claim if thread specified
  if [[ -n "${argc_thread:-}" ]]; then
    "$cli_path" thread claim release "$argc_thread" 2>/dev/null || true
  fi

  # 2. Log stop event
  _log_event "$session_dir" "agent.stop" "${argc_thread:+thread=$argc_thread}"

  # 3. Output summary
  "$cli_path" context --brief
}

eval "$(argc --argc-eval "$0" "$@")"
