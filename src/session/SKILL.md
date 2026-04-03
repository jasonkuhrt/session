---
name: session
description: >-
  Manage sessions, threads, and session wiring. Use when the user mentions
  sessions, threads, plans, reviews, claims, debriefs, or session sync/doctor.
  Also triggered by natural language like "create a thread", "what threads are
  open", "close this thread", "show me the session", "sync the session",
  "check session health", "claim the frontend thread", "lock the plan",
  "add a task", or "what's the session status".
argument-hint: "[instruction]"
---

# /session

Interpret the user's instruction, resolve the operation, and execute via the session CLI.

## CLI

```
~/.claude/skills/session/scripts/session.sh <command>
```

All session operations go through this CLI. Never mkdir, mv, or rm session dirs directly.

## Operations

Resolve the user's natural language to one of these:

### Wiring

| Intent | Command |
|--------|---------|
| show session state | `context` |
| one-line summary | `context --brief` |
| sync session wiring | `sync` |
| sync all worktrees | `sync-all` |
| check session health | `doctor` |
| show session status | `status` |

### Thread Lifecycle

| Intent | Command |
|--------|---------|
| create a thread | `thread create <slug> [--plan]` |
| complete/close a thread | invoke `/session:thread:land` (audit first) |
| force-close a thread | `thread done <slug> [--force] [--note "..."]` |
| resume/reopen a thread | `thread resume <n>` |
| list threads | `thread list` |
| show thread details | `thread show <slug>` |
| check if thread exists | `thread exists <slug>` |
| set/get current thread | `thread which [<slug>]` |

### Thread Content

| Intent | Command |
|--------|---------|
| add a task | `thread tasks add <slug> <item> [--section Active\|Todo]` |
| check off a task | `thread tasks check <slug> <line>` |
| lock/freeze the plan | `thread plan lock <slug>` |
| create a review | `thread review create <slug> <name>` |
| close a review | `thread review close <slug> <name>` |

### Coordination

| Intent | Command |
|--------|---------|
| claim a thread | `thread claim set <slug>` |
| release a claim | `thread claim release <slug>` |
| check who claimed | `thread claim check <slug>` |
| show event log | `log-show [--tail <n>]` |

### Debrief

| Intent | Command |
|--------|---------|
| write a debrief | invoke `/session:debrief` |

## Slug Resolution

When the user names a thread informally ("the schema thread", "my thread", "frontend"), resolve to a slug:

1. Check `thread which` for the current thread marker.
2. Match against active thread slugs from `thread list`.
3. If ambiguous, ask.

When creating, slugify: lowercase, hyphens only, no dots. "Schema Transport Research" → `schema-transport-research`.

## Announce, Don't Block

After resolving the command, announce what you're about to do and execute immediately. Don't wait for confirmation — the announcement is for transparency, not gating.

```
Running: session thread create schema-transport --plan
```

## Reference

For full conventions, worktree model, naming grammar, and protocol details: `~/.claude/skills/session/reference.md`. Single source of truth — read it if the inject block wasn't loaded or you need a refresh.

## Context Injection

`context --inject` outputs a compact block for hook injection. When wired as a session-start hook, agents get session state + routing conventions automatically.

## Related Skills

- `/session:thread:land` — closeout audit before completing a thread
- `/session:retro` — synthesize all debriefs into a retrospective
- `/session:dashboard` — thread timeline, agent roster, commit counts
- `/session:thread:handoff` — structured handoff brief + claim transfer
- `/session:debrief` — reflective debrief written at thread close
