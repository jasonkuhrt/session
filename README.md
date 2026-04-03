# session

A CLI and skill suite that gives Claude Code agents structured, multi-agent work sessions with thread-based task isolation, ownership claims, and shared state across git worktrees.

## Grounding

Claude Code agents can be dispatched in parallel across git worktrees, each working on a different part of a codebase. Without coordination, they overwrite each other's plans, duplicate work, and lose context between conversations. The session system is the coordination layer — it tracks who is working on what, in which worktree, with what plan.

## Problem

When multiple agents work on the same repo:

- **No shared memory.** Agent A finishes a thread of work. Agent B starts fresh with zero context about what A decided, tried, or learned.
- **No ownership.** Two agents edit the same file in `.sessions/` because nothing tracks who claimed what.
- **No lifecycle.** Plans get written but never locked. Threads get abandoned without debriefs. Done work has no completion order. A returning agent can't tell what happened while it was gone.
- **Worktree choreography is manual.** Creating a worktree, symlinking session state, claiming a thread, and starting work is a multi-step dance that agents get wrong.

## Solution

The session system introduces [`threads`](#thread) as the unit of work — each thread has a [`tasks.md`](#tasksmd) for tracking, an optional [`plan`](#plan) for design, [`reviews`](#review) for quality gates, and a [`debrief`](#debrief) for reflective closeout. Threads live in a shared [`session`](#session) directory that's accessible from every git worktree via symlinks.

Ownership is tracked through [`claims`](#claim) — YAML frontmatter on `tasks.md` that records which agent owns a thread. The [`doctor`](#doctor) command detects unclaimed threads, orphaned claims, missing debriefs, and stale work. The [`inject`](#inject) command outputs the full session state as a compact block that agents receive at startup, so every agent knows the current state of every thread.

Everything goes through a single CLI (`session.sh`, built on [argc](https://github.com/sigoden/argc)). No direct filesystem manipulation — the CLI handles naming conventions, sequence numbering, frontmatter, event logging, and concurrent-access locking.

## Quickstart

Clone the repo and run `./install.sh` to symlink the source into `~/.claude/skills/`.

**Prerequisites:** [argc](https://github.com/sigoden/argc) (`brew install argc`), git.

**1. Sync session wiring for a repo:**

```bash
session sync
```

This creates `.sessions/` in the main worktree, `.session` symlinks, `SESSION.md`, and git excludes. Run it once per repo.

**2. Create a thread:**

```bash
session thread create schema-redesign --plan
```

Creates `thread.schema-redesign/` with `tasks.md` (frontmatter: `claimed_by`, `created`) and `plan.md`. Auto-claims for the current agent.

**3. See the full session state:**

```bash
session context --inject
```

Outputs a `<session-context>` block with session key, worktree info, mission, thread inventory, claims, and routing conventions.

**4. Run the start protocol:**

```bash
session start schema-redesign
```

Syncs wiring, claims the thread, logs `agent.start`, and outputs the inject block — everything an agent needs in one command.

**5. Check health:**

```bash
session doctor
```

Diagnoses and autofixes: missing symlinks, broken frontmatter, unclaimed threads, orphaned claims, missing debriefs, stale threads, sequence gaps.

## Concepts

A **[`session`](#session)** is a work container scoped to a branch or issue. When a branch name contains a Linear issue key (like `HEA-1234`), the session key is that issue key — so all branches for the same issue share one session. Otherwise, the branch name is slugified into the key. The session directory lives at `.sessions/<key>/` in the main worktree, with a `SESSION.md` file holding the mission and decisions, and a `log` file recording every event.

**[`Threads`](#thread)** are independent units of work within a session. Each thread is a directory named `thread.<slug>/` containing a required [`tasks.md`](#tasksmd) and optional [`plan.md`](#plan), [`review.<name>.md`](#review) files, and [`debrief.md`](#debrief). When a thread is completed, it's renamed to `done.thread.<n>.<slug>/` where `n` is a monotonically increasing sequence number preserving completion order. This **[done prefix](#done-prefix)** convention applies uniformly: plans become `done.plan.<n>.md`, reviews become `done.review.<n>.<name>.md`.

Thread metadata lives in YAML **[frontmatter](#frontmatter)** on `tasks.md` rather than sidecar files. The `claimed_by` field records which agent owns the thread; `created` records when it was made. The CLI's `frontmatter_get` and `frontmatter_set` helpers read and write these fields atomically.

**[Claims](#claim)** prevent concurrent writes to shared thread files. When an agent claims a thread, other agents see the claim in `context --inject` output and in `thread show`. The [`thread boundary guard`](#hook) hook warns if an agent tries to write into another agent's claimed thread. Claims are advisory — they're enforced by convention and hooks, not filesystem locks.

The **[shared store](#shared-store)** model means `.sessions/` is a real directory only in the main worktree. Linked worktrees get a symlink pointing to the main's `.sessions/`. Thread files (plans, tasks, reviews) are shared across all worktrees. Code is worktree-local. This separation is why claims matter — two agents can have different code checkouts but see the same session state.

**[`config`](#config)** lives at `.sessions/.config.yml` and controls behavior like the Linear organization slug for URL expansion and the stale-thread threshold for doctor checks. All config values have defaults — the file is optional.

## Usage

**List threads and their status:**

```bash
session thread list
# active   session-system-v2
# done  #1 initial-setup
```

**Claim and release threads:**

```bash
session thread claim set schema-redesign --agent worker-1
session thread claim check schema-redesign    # prints: worker-1
session thread claim release schema-redesign
```

**Add tasks and check them off:**

```bash
session thread tasks add schema-redesign "Implement migration" --section Todo
session thread tasks check schema-redesign 12   # checks line 12
```

**Complete a thread:**

```bash
session thread done schema-redesign --note "Shipped in PR #42"
# thread.schema-redesign -> done.thread.2.schema-redesign
```

**View the event log:**

```bash
session log-show --tail 10
```

**Use skills for higher-level operations:**

| Skill | What it does |
|-------|-------------|
| `/session` | Natural language router — "create a thread", "show me the session" |
| `/session:thread:land` | Closeout audit before completing a thread |
| `/session:retro` | Synthesize all debriefs into a retrospective |
| `/session:dashboard` | Thread timeline, agent roster, commit counts |
| `/session:thread:handoff` | Structured handoff brief + claim transfer |
| `/session:debrief` | Reflective debrief at thread close |

## API Overview

Full CLI reference: `session --help`

Full convention reference: `src/session/reference.md`

| Command group | Key commands |
|--------------|-------------|
| Wiring | `sync`, `sync-all`, `hook-sync`, `doctor`, `status`, `context` |
| Thread lifecycle | `thread create`, `thread done`, `thread resume`, `thread list`, `thread show`, `thread exists`, `thread which` |
| Thread content | `thread tasks add`, `thread tasks check`, `thread plan lock`, `thread review create`, `thread review close` |
| Coordination | `thread claim set`, `thread claim release`, `thread claim check` |
| Protocol | `start`, `stop` |
| Diagnostics | `doctor`, `log-show` |

## Glossary

#### claim
YAML frontmatter field (`claimed_by`) on `tasks.md` recording which agent owns a thread. Prevents concurrent writes to shared session files.

#### config
Optional `.sessions/.config.yml` file with project-level settings (`linear_org`, `stale_thread_days`).

#### debrief
Reflective closeout document (`debrief.md`) written when a thread completes. Contains session ID, agent name, git SHAs, and lessons learned.

#### doctor
CLI command that diagnoses and autofixes session wiring issues: missing symlinks, broken frontmatter, unclaimed threads, orphaned claims, debrief gaps, stale threads, sequence gaps.

#### done prefix
Naming convention `done.<type>.<n>.<rest>` that marks completed items with a monotonically increasing sequence number preserving completion order.

#### frontmatter
YAML block at the top of markdown files (`---` delimited) used for structured metadata. `tasks.md` uses `claimed_by` and `created`; `SESSION.md` uses `issue_key`; `debrief.md` uses session/agent/git metadata.

#### hook
Claude Code harness hook that fires on tool use events. The session system provides three: auto-inject on session start, thread boundary guard on Write/Edit, and event log enrichment on git commit.

#### inject
Output of `context --inject` — a compact `<session-context>` block containing session state, worktree info, thread inventory, and routing conventions. Designed to be injected into agent conversations at startup.

#### plan
Implementation plan file (`plan.md`) in a thread. Locked via `thread plan lock` which renames it to `done.plan.<n>.md`.

#### review
Quality gate file (`review.<name>.md`) in a thread. Multiple reviews can exist simultaneously. Closed via `thread review close` which renames to `done.review.<n>.<name>.md`.

#### session
Work container scoped to a branch or Linear issue. Lives at `.sessions/<key>/` with `SESSION.md`, `log`, and thread directories.

#### session key
Identifier derived from the branch name. If the branch contains a Linear issue key (`HEA-1234`), that's the session key. Otherwise the branch name is slugified.

#### shared store
The `.sessions/` directory in the main worktree. Linked worktrees access it via symlink. Thread files are shared; code is worktree-local.

#### slug
Thread identifier matching `[a-z0-9-]+`. No dots, spaces, or uppercase.

#### tasks.md
Required file in every thread. Contains YAML frontmatter (`claimed_by`, `created`) and markdown task lists under `### Active`, `### Todo`, `### Done` headings.

#### thread
Independent unit of work within a session. A directory named `thread.<slug>/` containing `tasks.md` and optional plan, review, and debrief files.

#### worktree
A git worktree — an additional working copy of the repository. The session system manages symlinks so all worktrees share the same `.sessions/` state.
