# Contributing

## Getting Started

Clone the repo and run `./install.sh`. This creates symlinks from `~/.claude/skills/` into the repo's `src/` directory, so edits are live immediately with no build step.

You need [argc](https://github.com/sigoden/argc) installed (`brew install argc`).

## Codebase Map

```
src/                                   # Source (symlinked into ~/.claude/skills/)
├── session/
│   ├── scripts/session.sh             # Main CLI (~1900 lines, argc)
│   ├── hooks/                         # Claude Code harness hooks
│   │   ├── session-auto-inject.sh
│   │   ├── thread-boundary-guard.sh
│   │   └── event-log-enrichment.sh
│   ├── reference.md                   # Convention source of truth
│   └── SKILL.md                       # /session NL router skill
├── session_thread_land/SKILL.md       # /session:thread:land
├── session_debrief/SKILL.md           # /session:debrief
├── session_thread_handoff/SKILL.md    # /session:thread:handoff
├── session_retro/SKILL.md             # /session:retro
└── session_dashboard/SKILL.md         # /session:dashboard

.claude/CLAUDE.md                      # Agent instructions for this project
.sessions/main/                        # Session state for this repo
install.sh                             # Symlinks src/ into ~/.claude/skills/
```

## Boundaries

**CLI (`src/session/scripts/session.sh`)** owns all filesystem operations — directory creation, renames, frontmatter read/write, event logging, done-numbering, and locking. No other component touches `.sessions/` directly.

**Skills** (`src/*/SKILL.md` files) are prompt instructions that tell the LLM how to use the CLI. They handle judgment calls — synthesizing debriefs, writing handoff briefs, routing natural language to commands. Skills never perform filesystem operations themselves.

**Hooks** (`src/session/hooks/`) fire on Claude Code harness events (SessionStart, PreToolUse, PostToolUse) and call back into the CLI. They're thin wrappers — extract context from stdin, call a CLI command, exit.

**`reference.md`** (`src/session/reference.md`) is the single source of truth for naming conventions, directory layout, frontmatter schemas, and protocol steps. The CLI implements what reference.md specifies. If they disagree, reference.md is wrong and should be updated to match the CLI (the CLI is the runtime truth).

**`.sessions/.config.yml`** is per-project configuration. The CLI reads it via `config_get`. No config is required — all values have defaults.

## Extension Points

**New CLI commands:** Add a function to `src/session/scripts/session.sh` with argc annotations (`# @cmd`, `# @arg`, `# @flag`, `# @option`). argc discovers commands from function names — `thread::foo::bar()` becomes `session thread foo bar`. Read existing commands for the pattern.

**New skills:** Create `src/session_<name>/SKILL.md` with YAML frontmatter (`name`, `description`, `argument-hint`). Use `session:<component>` naming for the `name` field. Run `./install.sh` to create the symlink. The skill's `description` field controls when Claude Code activates it — make it trigger-rich.

**New hooks:** Create a script in `src/session/hooks/`. It receives tool input as JSON on stdin and outputs warnings/context to stdout. Wire it in `~/.claude/settings.json` under the appropriate event (`SessionStart`, `PreToolUse`, `PostToolUse`).

**New doctor checks:** Add to `_validate_threads()` in `src/session/scripts/session.sh`, inside the `if [[ "$_mode" == "doctor" ]]` block. Use `_report_ok`, `_report_warn`, `_report_error` for consistent output.

**New config keys:** Add a `config_get "key_name"` call where needed, with a default fallback (`${value:-default}`). Document in `src/session/reference.md` under Configuration.

## Key Decisions

| Decision | Why | Alternative rejected |
|----------|-----|---------------------|
| Claims in tasks.md frontmatter, not sidecar files | One file per thread is the minimum; metadata there eliminates `.claimed-by` and makes thread state visible in one read | `.claimed-by` sidecar files (original approach) — extra file per thread, invisible without listing hidden files |
| Tab-separated output with sentinels (`0`, `-`) | Bash `read` with `IFS=$'\t'` collapses consecutive tabs (tab is IFS-whitespace). Empty fields silently produce wrong assignments | Empty fields — broken in bash, would require switching to a non-whitespace separator |
| argc for CLI parsing | Annotation-based, zero boilerplate, nested subcommands via function naming | Manual getopts — painful for 30+ subcommands with nested structure |
| Skills for judgment, CLI for mechanics | Skills are prompts — inherently variable. Mechanical operations (create, rename, claim) must happen identically every time | Skills doing filesystem operations — unreliable, agents deviate from instructions |
| Shared `.sessions/` via symlinks | Thread files must be visible from all worktrees. Real dir in main, symlink in linked — `session sync` reconciles | Per-worktree session dirs — threads invisible across worktrees, claims meaningless |
| Config via `.sessions/.config.yml` | Optional, simple `key: value`, no dependencies. Project-level settings shared across worktrees via the same symlink model | Environment variables — not shared, not persistent. JSON — overkill for flat config |

## Common Tasks

**Test a CLI change:**

```bash
# Edit the source
vim src/session/scripts/session.sh

# Verify it parses
src/session/scripts/session.sh --help

# Run doctor to check consistency
src/session/scripts/session.sh doctor

# Test inject output
src/session/scripts/session.sh context --inject

# Test specific thread operations
src/session/scripts/session.sh thread create test-slug
src/session/scripts/session.sh thread show test-slug
src/session/scripts/session.sh thread done test-slug --force
```

**Add a new subcommand:**

1. Add the function to `src/session/scripts/session.sh` with argc annotations.
2. Test via `src/session/scripts/session.sh <command> --help` (argc generates help automatically).
3. Add to `src/session/reference.md` under the appropriate section.
4. Update the `/session` skill's operations table in `src/session/SKILL.md` if it should be NL-routable.

**Edit a skill:**

1. Edit `src/session_<name>/SKILL.md`.
2. The change is live immediately via symlink — no reload needed.
3. Test by invoking the skill in a Claude Code conversation.

**Debug a hook:**

Use the counter-file pattern from `~/.claude/rules/debugging-hooks.md`:

```bash
COUNT_FILE=/tmp/claude-hook-session.count
count=$(($(cat "$COUNT_FILE" 2>/dev/null || echo 0) + 1))
echo "$count" > "$COUNT_FILE"
echo "v1 #$count $(date)" >> /tmp/claude-hook-session.log
```

Read the log to confirm execution. The `hook success` reminder only confirms exit 0, not that the hook did what you expected.
