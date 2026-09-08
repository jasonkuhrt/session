---
name: session
description: Manage .session as the working record for Triage, Design, Batch, and Execute. Use when organizing session work, deciding or batching items, refreshing context, maintaining the four Markdown files, or opening the session board.
---

# Session

One item, one file, one meaning. The four files are work states, not a mandatory
sequence; simple work can skip Design. The user owns priorities, acceptance,
batch composition, and when execution begins.

| File | Contains | Leaves when |
| --- | --- | --- |
| `TRIAGE.md` | Candidates not yet accepted for work. | The user accepts, rejects, or redirects the candidate. |
| `DESIGN.md` | Accepted work with unresolved consequential design questions. | Its outcome and acceptance conditions are settled. |
| `BATCH.md` | Settled work being grouped for execution. | The user selects a batch to execute. |
| `EXECUTE.md` | The current selected batch. | Each item reaches its agreed completion, or the user changes the batch. |

Finished designs leave `DESIGN.md` immediately. Readiness does not authorize
execution. New ready items wait in `BATCH.md` while a batch is running. Do not
append them to `EXECUTE.md` without the user's explicit change of scope.

## Work with the files

Use the active worktree's `.session` directory, resolving its symlink. Never
change checkouts just to refresh context. Keep records directly readable and
editable as Markdown; the board reads and writes those same files.

Read [references/records.md](references/records.md) when creating, migrating, or
moving items. It defines the small stage-specific format and supporting folders.
Use stable IDs across stages. Do not infer authorization from an old filename,
confidence label, or another agent's suggestion; reconcile the conversation.

Before acting, refresh changed context with the CLI described in
[references/operations.md](references/operations.md). Load the four stage files
and only relevant supporting context. Keep the path/hash inventory in the
conversation; read changed files and avoid reloading unchanged material.
`ignore/` and `.runtime/` are outside normal context: do not traverse, read,
summarize, or follow links into them during a refresh. Read inactive history only
when the user asks for it.

## Design and execute

Use `design-together` for consequential choices and `show-me` for a focused
explanation or prototype. Keep settled choices with the item as it moves; don't
leave a finished copy in Design. Resolve incidental implementation choices using
the accepted intent. If execution exposes a consequential change, discuss it
and update the affected item's state rather than quietly changing the contract.

Execution continues through the agreed outcome, including verification and
landing when requested. A task is not complete merely because only tests or CI
remain. Remove completed items from the active file. Empty stages are literally
zero-byte files; completion records go under `ignore/`, outside live context.

## Board and validation

For the app, launch command, and file operations, read
[references/operations.md](references/operations.md). Stage names in the UI and
filenames are exactly **Triage, Design, Batch, Execute**. The UI owns no second
copy of work state. Do not recreate a per-task viewer, content module, or queue.

Validate after editing or migrating records. The checker proves structural
invariants, not that a design is sound or the user agreed. The agent still owns
those judgments. Keep explanations short, titles concrete, and detailed evidence
out of the first reading view.
