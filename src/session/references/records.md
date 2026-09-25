# Records

The session root is closed. It holds exactly:

- the five stage directories, `1-Triage/`, `2-Design/`, `3-Batch/`, `4-Queue/`
  and `5-Execute/`, which [Directory layout](#directory-layout) describes;
- a `.gitignore` of exactly `*`;
- `RULES.md`, when the user has set standing rules for the session (see the
  skill's Rules section);
- `context/`, supporting material for agents;
- `ledger/`, the session's shared log;
- `meta/`, facts about this worktree's session, one file each;
- `archive/` and `ignore/`, inactive history that is not ordinary agent context.

Entries whose name starts with `.` are outside this rule, as they are in the
stage directories. `check` reports any other entry by name with its fix: move it
under `context/` or delete it, or, when only its case differs from one of these,
rename it. A directory that holds a stage under another name, bare as the stages
were named before they were numbered (`TRIAGE/`), in another case, or behind a
prefix that is not its place, stops every command, not only `check`, with its
rename, `1-Triage/`, or, when the stage's own directory is there too, with what
to move into it. Each entry must also be its own kind: the stages, `context/`,
`ledger/`, `meta/`, `archive/` and `ignore/` directories, and `RULES.md` and
`.gitignore` files. Existing supporting files should be migrated deliberately,
preserving evidence and links rather than discarding them because their names
differ from the new convention.

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

Batch is the pool of settled work. A group there is a proposed composition:
items gathered so the batch they could make shows before anyone queues it.
Compose any coherent set of ready items, in groups or not, into the next batch
with `session batch "<name>" <ID...>`, which appends it to the end of Queue;
each item leaves its group for the batch.

## Groups

Any lane can gather its items into named groups, the way Queue gathers them into
batches. A group is a directory inside the stage directory, numbered like an
item file and named for the group, and it holds the group's item files:
`1-Triage/020-Needs a decision/010-BE-14.md`. In Triage, Design and Batch, item
files and group directories sit side by side and one sequence of prefixes orders
them together, so a group has its place in the lane among the items outside it.
In Queue and Execute every item is in a group, and there the group is a batch.

- The group an item belongs to is its directory, so nothing inside the file
  names it. An item file directly in the stage directory is in no group.
- A group's name is the rest of its directory's name: non-empty, with no
  surrounding spaces and no `/`, and unique within its stage. The same name in
  two lanes is two groups.
- A group directory holds item files only; groups do not nest.
- Emptying a group removes its directory on the next write, with anything left
  in it whose name starts with a dot, such as Finder's `.DS_Store`: no reader
  sees those, so they cannot keep a group alive. Until that write, no reader
  counts the directory as a group either, so one left behind by a write that
  was interrupted breaks nothing.

`session group "<name>" <ID...>` gathers items of one lane into a group, and
`session ungroup <ID...>` takes them out to the end of their lane. An item that
leaves its lane leaves its group, as an item that leaves Queue leaves its batch.
A group made by hand is the same thing: a numbered directory in the stage, with
the item files moved into it and numbered. [operations.md](operations.md) has
each command's rules.

## Queue and Execute

A batch is a group that gets started as a unit. Queue and Execute hold only
batches, one directory each, with the batch's item files inside:
`4-Queue/010-Email backend peel/010-BE-16.md`. The item file is the same as in
Batch, and it keeps the Outcome and Acceptance sections it carried there. Every
item in these two stages belongs to a batch, and batch names follow the rules
for group names.

Queue holds the composed batches in order, none of them started. Execute holds
the one running batch and is frozen. `session start` is the only way in: it
requires Execute to be empty and carries the first Queue batch across under its
own name. Content can be clarified without expanding the selected item set.
`session done` is the way out for finished work and `session archive` for work
that is abandoned; both file the item under `archive/`.

## Context

`context/` is for agents: any file, in any layout, with no lifecycle, and
`check` does not look inside it. `archive` and `ignore` are names of the root
only, so a directory called either inside `context/` is an ordinary one. Material about one item lives under
`context/<ID>/` and is linked from that item's `### Evidence`, so the item stays
the one place its outcome is read. Nothing that needs the user goes here; that
is a stage move.

## Ledger

`ledger/` is the session's shared log: what another agent, or the user, must
know to act correctly in this session and would not learn from the items, such
as a design pivot, a batch abandoned, a rule learned, a decision taken outside
any item, or `RULES.md` changed. Routine progress is not an entry, and neither
is anything that needs the user, which is a stage move. Each entry is one file,
so agents writing at once never share one, and it is never edited or deleted: a
mistake is corrected by a later entry. The engine writes none of its own.

```
ledger/
  2026-09-23 14-02-11Z — Pivot to per-item evidence.md
  2026-09-23 16-40-05Z — Batch "Email backend peel" abandoned.md
```

An entry is YAML frontmatter, then the body:

```markdown
---
date: 2026-09-23T14:02:11Z
title: Pivot to per-item evidence
by: claude session_0135i3KrKC2ekfxKBAPee12d
branch: feat/agents
commit: 8d287cf
batch: Email backend peel
---

Reports and the inbox are dropped; evidence lives with its item.
```

- The frontmatter is the record. `date`, `title` and `by` are required;
  `branch`, `commit` and `batch` are the other keys, and there are no others.
  `date` is a UTC instant to the second, `by` names the writer as `claude
  <session id>`, `codex <thread id>` or a person's name, `branch` and `commit`
  are Git's when the entry was written, and `batch` is the batch Execute was
  running.
- The frontmatter is flat: one `key: value` line per key, and each value one
  line of text. A value written without quotes must read back exactly as
  written, so one that YAML would read otherwise, such as `0123456`, `true`, or
  `Fix #12`, whose `#` starts a comment, goes in double quotes.
- The file's name comes from the frontmatter, so the two always agree: `date`
  with `-` for `:` and a space for `T`, then ` — `, then `title` with any `/` as
  `-`, then `.md`.
- The body is Markdown with no headings: it is read the way the board renders
  it, and a heading of any level anywhere, in a quote or a list item too, breaks
  the rule. That covers a line opening with `#` marks and a line underlined with
  `=` or `-`; code, fenced or indented, is not read as Markdown. The body may be
  empty.
- The ledger holds its entries itself: `ledger/` is a directory, not a link to
  one, and every entry in it is a regular file, not a link or a directory.
  Names starting with `.` are skipped, as in the stages.

`session log "<by>" "<title>"` writes an entry in this form, and an agent may
also write one by hand with the same keys and no others. `check` rejects
anything in `ledger/` that breaks one of these rules.

## Meta

`meta/` holds facts about this worktree's session, one file each, named for the
fact it holds. It is a directory of its own, never a link, since a worktree's
facts are its own. The session defines one fact, `epic`; `check` reports
anything else in it by name with its fix, to move it under `context/` or delete
it, and names starting with `.` are outside the rule. Scaffolding creates it
empty; a session without it is sound and sets no fact.

`meta/epic` names the epic this worktree is in: one line, the epic's name,
ending in a newline, and nothing else.

```
Back burner
```

- The name follows the rules for a group's: non-empty, with no surrounding
  spaces and no `/`. No file means no epic.
- The file is the membership. An epic is the name its worktrees' files share,
  so two worktrees naming one epic are in the same epic, an epic exists while
  one names it, and a worktree is in one at most. Renaming an epic rewrites the
  file in each of its worktrees, so a name another epic has merges the two.
- `meta/epic` is a regular file, not a link or a directory. `check` names a
  file or a link that breaks any of these rules with its fix, to rewrite it
  with `session join "<epic>"` or remove it with `session leave`, and the index
  shows the same sentence on the worktree's row, which it draws in no epic and
  serves as ever.
- A directory under that name is not mended that way: `check` and the index
  name it with `meta/epic must be a file; move this directory under context/ or
  delete it.`, and `join` and `leave` refuse it until it is gone.
- `check` and the index read it, and so do `join` and `leave`, to say which
  epic the worktree left. A command about the items does not: nothing about
  them depends on it.
- A main worktree is never in an epic, since Git keeps the repository there and
  lists it first: `session join` refuses one, and the index pins it above the
  epics whatever its file says.
- It is ignored with the rest of `.session/`, so it never enters a repository,
  and it goes with the worktree when the worktree is removed.

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
it is never loaded as a stage. It is still viewable: the board serves a listing
of its records and each record, read-only, which is for a person looking back,
not context for an agent. A record is read by its name, and only a name exactly
as the engine writes it counts: one renamed by hand is listed as it is, and a
commit trailer naming its item no longer finds it archived.

## Executing agent

An item being executed may carry a trailing `### Agent` section whose one line
identifies the agent that picked it up, by harness and session id:

```markdown
### Agent

claude session_0135i3KrKC2ekfxKBAPee12d
```

`codex <thread-id>` is the same convention for a Codex thread. Other agents,
including mixed-model teams, address the item's owner through it. It is a
convention only: neither the engine nor the board reads or writes it, `session
start` does not add it, and the executing agent writes it when it picks the item
up.

## Directory layout

A stage is always a directory, named for its place in the flow and its name:
`1-Triage`, `2-Design`, `3-Batch`, `4-Queue` and `5-Execute`. The digit makes a
file tree list the stages in the order work moves through them, and the word
after the hyphen is the stage's name, written the same way by the CLI and the
board. Triage, Design and Batch hold item files and group directories side by
side; Queue and Execute hold batch directories only:

```
1-Triage/
  010-BE-18.md
  020-Needs a decision/
    010-BE-14.md
    020-BE-15.md
  030-BE-17.md
4-Queue/
  010-Email backend peel/
    010-BE-16.md
    020-BE-12.md
  020-Second batch/
    010-DEV-3.md
```

- Every entry is a number, a hyphen, then the rest: for a file the rest is
  `<ID>.md`, for a directory the rest is the group's name. Entries whose name
  starts with `.` are ignored, which is also how a write in progress stays
  invisible until it is renamed into place, and so is a directory that holds
  nothing but such entries, or nothing. Anything else is an error, as are a
  missing prefix, two entries sharing a prefix in one directory, and a
  directory inside a group directory.
- Ascending numeric prefix is the order, and that order is card order. A group
  directory's prefix places the group among the stage's entries, and the
  prefixes inside it order its items.
- An item file is exactly the item's chunk: `## ID — Title` on the first line,
  with the ID matching the filename, then the body, ending in a single newline. A
  `# ` heading inside an item file is an error, because a group's name, a
  batch's included, lives in its directory's name.
- Prefixes step by 10 and pad to three digits. The engine keeps existing numbers
  when it can fit an entry between them and renumbers the whole directory from
  `010` otherwise, so gaps are normal and hand-renumbering is unnecessary.
- Emptying a group, a batch included, removes its directory on the next write,
  dot entries and all; the stage directory itself stays, empty.

## Evidence and migration

Use normal Markdown links to relevant files under `context/<ID>/`, or put long
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
until it is replaced by a real directory. A session from before the stages were
numbered holds `TRIAGE/`, `DESIGN/`, `BATCH/`, `QUEUE/` and `EXECUTE/`: every
command refuses it with the first rename to make, since scaffolding `1-Triage/`
beside `TRIAGE/` would split the stage in two, and `check` names each in turn.
Rename the five directories to `1-Triage/` to `5-Execute/`; their groups and
items move with them unchanged. The session repository's one-off
`scripts/rename-stage-directories.ts` does that for every session named on its
command line. A stage file from the single-file layout, such as `TRIAGE.md`, is
reported by `check` until it is folded into its stage's directory by hand: split
it at its `## ` headings into one numbered file per item, then delete it. A
`BATCH.md` may still hold `# ` headings; drop them, and re-form each heading's
items as a group in Batch with `session group "<name>" <ID...>`, or compose them
straight into a batch with `session batch "<name>" <ID...>`.
