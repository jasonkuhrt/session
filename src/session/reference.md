# Session System Reference

## Model

Sessions are **issue-scoped work containers** shared across git worktrees. Each session has threads — independent units of work with their own plans, tasks, reviews, and debriefs.

### Directory Layout

```
.sessions/                          # shared store (real dir in main worktree, symlink in linked)
  <session-key>/                    # one per issue or branch
    SESSION.md                      # mission + decisions (frontmatter: issue_key)
    linear/                         # issue snapshot + linked docs (optional)
    log                             # append-only event log
    thread.<slug>/                  # active thread
      tasks.md                      # task tracking (frontmatter: claimed_by, created)
      plan.md                       # implementation plan (active)
      done.plan.<n>.md              # frozen plan
      review.<name>.md              # open review
      done.review.<n>.<name>.md     # closed review
      debrief.md                    # agent reflective closeout
    done.thread.<n>.<slug>/         # completed thread (n = completion order)
.session -> .sessions/<session-key> # per-worktree symlink
```

### Session Key Resolution

1. Extract `HEA-\d+` from branch name (issue-scoped — all branches with same issue share a session)
2. Otherwise slugify the full branch name

### Worktree Model

- `.sessions/` is a real directory in the **main worktree** only
- Linked worktrees get a `.sessions` **symlink** pointing to main's `.sessions/`
- `.session` is a relative symlink per-worktree: `.session -> .sessions/<key>`
- **Thread files are shared.** Two agents in different worktrees editing the same thread's `tasks.md` is a concurrent write. Claims prevent this.
- **Code is worktree-local.** Session state is shared, but `git status`, dev servers, and file edits are per-worktree.

## Naming Convention

### Done Prefix

`done.<type>.<n>.<rest>` — monotonically increasing `<n>` preserves completion order.

| Active | Done |
|--------|------|
| `thread.<slug>/` | `done.thread.<n>.<slug>/` |
| `plan.md` | `done.plan.<n>.md` |
| `review.<name>.md` | `done.review.<n>.<name>.md` |

### Slugs

`[a-z0-9-]+` only. No dots, spaces, or uppercase.

### Thread Files

| File | Cardinality | `done.` applies | Description |
|------|-------------|-----------------|-------------|
| `tasks.md` | singular | no | Task tracking + thread metadata (frontmatter) |
| `plan.md` | singular | yes (locked) | Implementation plan |
| `review.<name>.md` | stacks | yes (per review) | Reviews, each locks independently |
| `debrief.md` | singular | no | Agent reflective closeout (written at thread close) |

### tasks.md Frontmatter

```yaml
---
claimed_by: <agent name or empty>
created: <ISO 8601 timestamp>
worktree: <absolute path to git worktree, if created with --worktree>
---
```

### SESSION.md Frontmatter

```yaml
---
issue_key: <HEA-1234 or omitted for non-issue sessions>
---
```

### Debrief Frontmatter

```yaml
---
session_id: <claude session resume ID>
agent_name: <$CLAUDE_AGENT_NAME or "lead">
thread: <slug>
timestamp: <ISO 8601 with timezone>
git_head_sha: <short sha>
git_commit_shas:
  - <short shas, oldest first>
---
```

## CLI

```
~/.claude/skills/session/scripts/session.sh <command>
```

### Wiring
- `status [--json]` — session key, issue, threads
- `context [--inject|--brief|--json]` — full preflight context
- `sync` / `sync-all` / `hook-sync` — ensure session wiring
- `doctor` — diagnose + autofix (frontmatter, threads, sequence gaps)

### Thread Lifecycle
- `thread create <slug> [--plan] [--no-claim] [--worktree] [--base <branch>] [--dir <template>]` — create thread (auto-claims); `--worktree` creates an isolated git worktree
- `thread done <slug> [--note] [--force] [--rm-worktree]` — complete thread; `--rm-worktree` removes the associated git worktree
- `thread resume <n>` — reopen a done thread
- `thread list [--json]` / `thread show <slug> [--json]` / `thread exists <slug>`
- `thread which [<slug>]` — get/set current thread marker

### Thread Content (mechanical mutations — no Read/Edit needed)
- `thread tasks add <slug> <item> [--section]` — atomic task append
- `thread tasks check <slug> <line>` — atomic checkbox toggle
- `thread plan lock <slug>` — freeze plan
- `thread review create <slug> <name>` / `thread review close <slug> <name>`
- `mark done <slug> <type> [name]` — generic done-marker

### Coordination
- `thread claim set <slug> [--agent]` / `thread claim release <slug>` / `thread claim check <slug>`
- `log-show [--tail <n>]` — session event log

### Protocol
- `start` — run start protocol (sync, inject, claim)
- `stop` — run stop protocol (debrief, release, log)

## Agent Protocol

### Start (when beginning work)
1. `session sync` — ensure wiring
2. `session context --inject` — load session state + conventions
3. `session thread which` or `session thread claim set <slug>` — identify/claim thread
4. Read `tasks.md` and `plan.md`/`done.plan.*.md` in your thread

### Stop (when ending work)
1. Update tasks.md (check off completed items)
2. `/debrief` if thread is being closed
3. `session thread claim release <slug>` if releasing
4. `session stop` — log event

### Routing Rules
- Your thread is `.session/thread.<slug>/`. Stay in it.
- CLI for lifecycle + mechanical mutations. Read/Edit for content.
- Don't read/modify other agents' claimed threads.
- `session context` to refresh state. `session thread show <slug>` for thread inventory.

## Configuration

`.sessions/.config.yml` (optional):

```yaml
linear_org: heartbeat-chat
stale_thread_days: 7
worktree:
  base_branch: develop              # Default base branch for --worktree (fallback: current branch)
  directory: ../{repo}-{slug}       # Directory template. Variables: {repo}, {slug}, {branch}
  post_create:                      # Commands to run in the new worktree after creation
    - npm install
start_protocol:
  - sync
  - context --inject
stop_protocol:
  - log-event agent.stop
```

Config supports dotted keys for 2-level nesting: `config_get "worktree.base_branch"` reads the nested value.

## Related Skills

- `/session` — natural language router for all session operations
- `/session:thread:land` — closeout audit before completing a thread
- `/session:retro` — synthesize all debriefs into a retrospective
- `/session:dashboard` — thread timeline, agent roster, commit counts
- `/session:thread:handoff` — structured handoff brief + claim transfer
- `/session:debrief` — reflective debrief written at thread close
