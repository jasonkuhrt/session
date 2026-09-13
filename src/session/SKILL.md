---
name: session
description: Manage .session as the working record for Triage, Design, Batch, Queue, and Execute, and drive it with the session CLI, under the session's standing rules. Use when organizing session work, deciding, batching, queueing or executing items, refreshing context, maintaining the five stage records or RULES.md, or opening the session board.
---

# Session

One item, one file, one meaning. The five stages are work states, not a mandatory
sequence; simple work can skip Design. The user owns priorities, acceptance,
batch composition, and when execution begins.

| Stage | Contains | Leaves when |
| --- | --- | --- |
| `TRIAGE` | Candidates not yet accepted. | The user accepts, rejects, or redirects. |
| `DESIGN` | Accepted work with open questions. | Outcome and acceptance are settled. |
| `BATCH` | Settled work, a flat pool ready to batch. | The user composes it into a queued batch. |
| `QUEUE` | Named batches in order, composed, not started. | The user starts the first batch. |
| `EXECUTE` | The one running batch. Frozen. | Each item completes, or the user changes the batch. |

Those are the stage names, in that order, in the files, the CLI, and the UI.
Finished designs leave Design immediately. Readiness does not authorize
execution: ready items wait in Batch, composed batches wait in Queue, and
starting the first one is the user's explicit act. Work that arrives while a
batch is running waits in Batch. Do not add it to Execute without the user's
explicit change of scope.

## The files are the source of truth

The CLI and the board are viewers and writers over the files, never owners.
Everything must keep working when the user opens `.session/` in a file manager
and an editor and never runs either tool: nothing in the layout requires a
process to be running or to have run, every rule is checkable from the files
alone, and every record is ordinary Markdown.

## The session directory

`.session` is a real directory at the worktree root, never a symlink. It holds a
`.gitignore` of exactly `*`, which ignores the directory and that file.

Every stage is a directory of numbered item files. One item is one file, and an
empty stage is an empty directory. Triage, Design, and Batch hold their item
files directly. Queue and Execute hold one directory per batch with that batch's
item files inside, so every item there belongs to a batch.
[references/records.md](references/records.md) has the format.

Nothing has to be set up. A command that touches the records creates `.session`,
the five stage directories, and the `.gitignore` when they are missing; `check`
only reads what is on disk. `session init` does that scaffolding and nothing
else, printing what it created, for handing the directory to an editor.

The CLI never migrates an old session. A `.session` that is a symlink is refused
by every command, and a leftover `STAGE.md` is reported by `check`, both naming
the fix. Convert an old session by hand.

## Rules

`RULES.md` at the session root holds the user's standing working procedure for
this session: who stages and commits, what qualifies as work, what is closed
for now, and the roles of the agents sharing the worktree. It is ad hoc and
per session; it is not a record, a plan, or a checkpoint, and it holds no items.

Read it first in every session and again whenever a refresh reports it changed.
It governs over habits, memories, and defaults for as long as the session
lasts. Write it only from the user's own words, naming who set each rule and
when; never add, relax, or reinterpret a rule on the agent's initiative. A
session without standing rules has no `RULES.md`; nothing scaffolds one.

## Work with the files

Use the active worktree's `.session` directory. Never change checkouts just to
refresh context.

Use the `session` CLI for structure: adding, moving, composing a batch, starting
it, and completing an item. It owns placement, numbering, and validation. Write
content in an editor, in the item files themselves, and run `session check` after
hand edits. [references/operations.md](references/operations.md) has the
commands.

Read [references/records.md](references/records.md) when creating, migrating, or
moving items. It defines the small stage-specific format and supporting folders.
Use stable IDs across stages. Do not infer authorization from an old filename,
confidence label, or another agent's suggestion; reconcile the conversation.

Before acting, refresh changed context with the CLI. Load `RULES.md` when it
exists, the five stage records, and only relevant supporting context. Keep the
path/hash inventory in the conversation; read changed files and avoid reloading
unchanged material.
`ignore/` and `archive/` are outside normal context: do not traverse, read,
summarize, or follow links into them during a refresh. Read inactive history only
when the user asks for it.

## Design and execute

Use `design-together` for consequential choices and `show-me` for a focused
explanation or prototype. Keep settled choices with the item as it moves; don't
leave a finished copy in Design. Resolve incidental implementation choices using
the accepted intent. If execution exposes a consequential change, discuss it
and update the affected item's state rather than quietly changing the contract.

An agent that picks up an item in Execute writes a trailing `### Agent` section
naming itself by harness and session id, so other agents, including mixed-model
teams, can address it. It is a convention the engine neither writes nor enforces,
and `session start` does not add it.

Execution continues through the agreed outcome, including verification and
landing when requested. A task is not complete merely because only tests or CI
remain. Finish an item in Execute with `session done`, which files it under
`archive/`, outside live context. `session archive <ID>` files an item from any
stage the same way and records the stage it left, so a rejected candidate or an
abandoned one stays on the record. An empty stage is an empty directory, and
`session check` reports a session with no items left as empty.

## Board and validation

The board is a viewer with workflow actions. It shows the five lanes and it
moves, queues, starts, and completes items; it never writes an item's content.
One daemon serves the board of every worktree it knows, along with an index of
them, and each board follows the files as they change. Run `session open` only
when the user asks for the board. For the app and its file operations, read
[references/operations.md](references/operations.md). The UI owns no second copy
of work state. Do not recreate a per-task viewer, content module, or task
database.

Validate after editing or migrating records. The checker proves structural
invariants, not that a design is sound or the user agreed. The agent still owns
those judgments. Keep explanations short, titles concrete, and detailed evidence
out of the first reading view.
