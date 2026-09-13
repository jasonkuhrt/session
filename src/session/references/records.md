# Records

The session root holds the five stage directories, a `.gitignore` of exactly `*`,
and, when the user has set standing rules for the session, `RULES.md` (see the
skill's Rules section). Supporting context lives in `context/` when needed.
`ignore/` and `archive/` hold inactive history and are not ordinary agent
context. Existing
supporting files should be migrated deliberately, preserving evidence and links
rather than discarding them because their names differ from the new convention.

Each item is one file. Its first line is `## ID — Short title`, with an em dash,
and the rest is the body: a short lead paragraph, then the stage's meaningful
section. IDs are unique across all five stages and survive moves. Add only useful
evidence and constraints. There is no universal eight-field form.

## Triage

```markdown
## DEV-1 — Protect worktree backups

Parallel commits may share backup state. Current safety is unverified.

### Decision

Investigate backup ownership and verify concurrent recovery?
```

Triage asks whether to take on the action. Approval to investigate authorizes
that investigation, not an unexamined implementation. A small accepted action
with a settled outcome can move directly to Batch.

## Design

```markdown
## DEV-2 — Prepare new worktrees

New worktrees need dependencies, local configuration, and a clear cache result.

### Open questions

Should setup use one repository command or compose existing commands?

### Proposal

One idempotent entrypoint keeps the setup contract in the repository.
```

Keep the actual open questions here. Do not retain completed designs as checked
items, recaps, or a separate completed section. Once settled, replace open
questions with the agreed Outcome and Acceptance and move the whole item.

## Batch

```markdown
## DEV-2 — Prepare new worktrees

Make a fresh worktree ready through the ordinary setup command.

### Outcome

One repository-owned entrypoint installs dependencies, safely links the main
checkout's configuration, and reports the cache import outcome.

### Acceptance

- Running setup twice preserves worktree-local configuration.
- Missing source configuration produces an actionable error.
```

Batch is a flat pool of settled work. Its item files sit directly in `BATCH/`,
with no batch directories and no other grouping. Compose any coherent set of
ready items into the next batch with `session batch "<name>" <ID...>`, which
appends it to the end of Queue.

## Queue and Execute

Queue and Execute hold one directory per batch, with the batch's item files
inside: `QUEUE/010-Email backend peel/010-BE-16.md`. The item file is the same as
in Batch, and it keeps the Outcome and Acceptance sections it carried there. The
batch an item belongs to is its directory, so nothing inside the file names it,
and every item in these two stages belongs to a batch. Batch names are non-empty
and trimmed, contain no `/`, and are unique within a stage.

Queue holds the composed batches in order, none of them started. Execute holds
the one running batch and is frozen. `session start` is the only way in: it
requires Execute to be empty and carries the first Queue batch across under its
own name. Content can be clarified without expanding the selected item set.
`session done` is the way out for finished work and `session archive` for work
that is abandoned; both file the item under `archive/`.

## Archive

`archive/` is flat: one file per archived item, named for the day it was
archived, the item, and the state it left.

```
archive/
  2026-09-13 BE-16 — Peel the email backend (done).md
  2026-09-13 DEV-3 — Protect worktree backups (triage).md
```

The state is `done` for an item finished in Execute with `session done`, and the
lowercase stage it left for one filed with `session archive <ID>`, which works
from any stage. `(batch)` is settled work that never ran, `(triage)` a candidate
that was rejected, and `(execute)` a started item that was abandoned. A `/` in
the title becomes `-` in the file name, and an existing archive file is never
overwritten. The content is the item's chunk exactly as its own file held it.
Like `ignore/`, the directory is outside agent context: a refresh skips it, and
it is never loaded as a stage.

## Executing agent

An item being executed may carry a trailing `### Agent` section whose one line
identifies the agent that picked it up, by harness and session id:

```markdown
### Agent

claude session_0135i3KrKC2ekfxKBAPee12d
```

`codex <thread-id>` is the same convention for a Codex thread. Other agents,
including mixed-model teams, address the item's owner through it. It is a
convention only: the engine does not read or write it, `session start` does not
add it, and the executing agent writes it when it picks the item up.

## Directory layout

A stage is always a directory. A flat stage holds item files; Queue and Execute
hold batch directories:

```
TRIAGE/
  010-BE-16.md
  020-BE-14.md
QUEUE/
  010-Email backend peel/
    010-BE-16.md
    020-BE-12.md
  020-Second batch/
    010-DEV-3.md
```

- Every entry is a number, a hyphen, then the rest: for a file the rest is
  `<ID>.md`, for a directory the rest is the batch name. Entries whose name
  starts with `.` are ignored, which is also how a write in progress stays
  invisible until it is renamed into place. Anything else is an error, as are a
  missing prefix and two entries sharing a prefix in one directory.
- Ascending numeric prefix is the order, and that order is card order.
- An item file is exactly the item's chunk: `## ID — Title` on the first line,
  with the ID matching the filename, then the body, ending in a single newline. A
  `# ` heading inside an item file is an error, because batch names live in the
  directory name.
- Prefixes step by 10 and pad to three digits. The engine keeps existing numbers
  when it can fit an entry between them and renumbers the whole directory from
  `010` otherwise, so gaps are normal and hand-renumbering is unnecessary.
- Emptying a batch removes its directory on the next write; the stage directory
  itself stays, empty.

## Evidence and migration

Use normal Markdown links to relevant files under `context/`, or put long
technical context under `### Evidence`, which the board collapses by default.
Keep completion criteria visible when they determine whether the work is ready
or done.

Migrate item by item using actual approval and design state. Preserve source
material before restructuring it, stable IDs, constraints, and intended batch
relationships. Merge duplicate concerns without losing provenance. References
to supporting context are not duplicate work items.

An old burndown can contain both Design and Batch items. An old design document
can contain undecided candidates and already settled work. Its filename does
not decide the destination. Do not create an execution batch merely as a side
effect of migration.

The CLI never converts an old session. A `.session` that is a symlink is refused
until it is replaced by a real directory, and a `STAGE.md` from the single-file
layout is reported by `check` until it is folded into `STAGE/` by hand: split it
at its `## ` headings into one numbered file per item, then delete it. A
`BATCH.md` may still hold `# ` headings; batches live in Queue now, so drop them
and re-form each group with `session batch "<name>" <ID...>`.
