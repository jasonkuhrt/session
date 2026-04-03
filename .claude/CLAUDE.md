# Session Tool

This repo develops the session management system for Claude Code agents.

## What This Is

A CLI + skill suite for managing agent work sessions: thread-based work containers with plans, tasks, reviews, debriefs, claims, and lifecycle commands.

## Development Model

Source files live in `src/` in this repo. They're symlinked into `~/.claude/skills/` via `./install.sh`, so edits in the repo are live immediately — no build step.

After cloning, run `./install.sh` to create the symlinks.

## Key Files

### CLI
| File | Role |
|------|------|
| `src/session/scripts/session.sh` | Main CLI (~1900 lines, [argc](https://github.com/sigoden/argc)) |

### Skills
| Directory | Skill | Role |
|-----------|-------|------|
| `src/session/SKILL.md` | `/session` | Natural language router for all session operations |
| `src/session/reference.md` | — | Single source of truth for conventions, naming, protocol |
| `src/session_thread_land/SKILL.md` | `/session:thread:land` | Thread closeout audit |
| `src/session_debrief/SKILL.md` | `/session:debrief` | Reflective debrief at thread close |
| `src/session_thread_handoff/SKILL.md` | `/session:thread:handoff` | Structured handoff brief + claim transfer |
| `src/session_retro/SKILL.md` | `/session:retro` | Synthesize debriefs into retrospective |
| `src/session_dashboard/SKILL.md` | `/session:dashboard` | Thread timeline, agent roster, commit counts |

### Hooks
| File | Event | Role |
|------|-------|------|
| `src/session/hooks/session-auto-inject.sh` | SessionStart | Runs `session start`, injects context |
| `src/session/hooks/thread-boundary-guard.sh` | PreToolUse (Write/Edit) | Warns on cross-thread writes |
| `src/session/hooks/event-log-enrichment.sh` | PostToolUse (Bash) | Logs git commit events |

## CLI Quick Reference

Run `src/session/scripts/session.sh --help` for full usage. Key commands:

```
session sync                          # Ensure session wiring
session doctor                        # Diagnose + autofix
session start [thread]                # Start protocol (sync + inject + claim)
session stop [thread]                 # Stop protocol (release + log + brief)
session context --inject              # Compact context for hook injection
session thread create <slug> [--plan] # Create thread (auto-claims)
session thread done <slug>            # Complete thread
session thread claim set/release/check <slug>
session thread list / show / exists / which
session thread tasks add/check
session log-show [--tail N]
```

## Conventions

- Read `src/session/reference.md` for the full convention set
- Thread claiming uses YAML frontmatter on `tasks.md` (`claimed_by`, `created`)
- Tab-separated output uses sentinel values (`0`, `-`) for empty fields — bash `read` with `IFS=$'\t'` collapses consecutive tabs
- `config_get` reads simple `key: value` from `.sessions/.config.yml` (no nested YAML)
- All session operations go through the CLI — never mkdir/mv/rm session dirs directly

## Agent Protocol

1. `src/session/scripts/session.sh context --inject` — get session state
2. `src/session/scripts/session.sh thread list` — see what threads exist
3. If your task maps to an existing thread, read its `tasks.md` and `plan.md`
4. If your task needs a new thread, `session thread create <slug>`
5. Read `CONTRIBUTING.md` for codebase map, boundaries, and extension points
6. Read `src/session/reference.md` for naming conventions

## Testing Changes

After editing the CLI, test with:
```bash
src/session/scripts/session.sh doctor    # Health check
src/session/scripts/session.sh context --inject  # Verify output
src/session/scripts/session.sh thread list       # Thread operations
```
