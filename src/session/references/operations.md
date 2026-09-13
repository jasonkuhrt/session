# Operations

Installation links `session` into `~/.local/bin`. It works from anywhere inside a
worktree. `-C` points it elsewhere, at either a worktree or a `.session`
directory, and defaults to the current directory; a worktree is resolved through
Git.

```
session [-C <worktree-or-.session>] <command>

init                       create the real .session, the five stage directories, and .gitignore; migrate an older session
check                      validate; prints "OK <revision> (<n> items)" or the first error and exits 1
refresh [--previous F]     JSON path/hash inventory
serve [--port N]           run the board
ls [STAGE]                 one line per item: ID, path, title; the path encodes stage, batch, and order
add <STAGE> <ID> "<title>" new item, body on stdin; refuses Queue and Execute
mv <ID> <STAGE> [--before ID]   refuses into Queue or Execute and out of Execute
batch "<name>" <ID...>     compose a named batch from Batch items and append it to Queue
start                      move the first Queue batch into Execute
done <ID>                  archive an Execute item under ignore/COMPLETED.md
archive                    move this worktree's .session under the main worktree's .sessions/
```

Running the installed script with Bun is equivalent, and is the form to use when
the command is not on PATH:

```sh
bun ~/.codex/skills/session/scripts/session.ts -C /absolute/path/to/worktree check
```

Success prints one short line, such as `Queued "Email backend peel" (3 items)`
or `Moved BE-16 to BATCH`. Errors print a message on stderr and exit 1. `add` is
the only command that reads stdin: it takes the new item's body there, in full,
trimmed, and rejects an empty one.

## Move and batch rules

The engine owns placement, so the CLI refuses what the stage rules forbid. `add`
creates an item in Triage, Design, or Batch and refuses Queue and Execute,
because a Queue batch is composed with `batch` and Execute is entered only by
`start`. `mv` moves between Triage, Design, and Batch, and out of Queue into any
of them, dropping the batch. It never moves an item into Queue or Execute, and
never out of Execute, which `done` does. Within Queue, `--before` reorders an
item inside its own batch. Without `--before`, an item lands at the end of the
stage. The target stage's required sections are validated on arrival, so rewrite
the item file first and then move it; that is the ordinary way an item leaves
Design for Batch.

`batch` takes items that are all in Batch. `start` requires Execute to be empty
and keeps the batch's name. `done` archives the item under a heading naming its
batch.

## Set up and tear down

`init` makes the session real: it creates `.session`, the five stage directories,
and the `.gitignore` when they are missing, prints each action, preserves
existing content, and is safe to re-run. It also converts an older session in
place. A symlinked `.session` is replaced by its real target directory and a
retired `.sessions` symlink beside it is removed, while a real `.sessions`
directory is never touched. A `STAGE.md` from the single-file layout is parsed
into `STAGE/` item files and the file is removed; a `STAGE.md` sitting beside an
existing `STAGE/` is an error naming both. That conversion is a one-shot for the
rollout and goes away once every worktree has run `init`. `serve` also creates
what is missing; `check` reports an incomplete setup instead. Neither creates
`RULES.md`: standing rules are written from the user's words when the user states
them, and the inventory reports the file like any other.

`archive` moves `.session` to `<main worktree>/.sessions/<slug>`, where the slug
is the branch name with `/` replaced by `-`, or `detached-<short sha>` without a
branch. It refuses when the target already exists, and it needs a Git worktree.
Run it before removing a worktree; the records outlive the checkout.

## Refresh context

`refresh` returns a JSON path/hash inventory and added, changed, and deleted
paths. It does not return file contents. On the first refresh, read `RULES.md`
when it exists, the five stage records, and relevant supporting context. On later
turns, compare inventories and read only changed relevant files. Preserve the
inventory in conversation context. For a deterministic comparison, pass a
previous refresh output saved outside the session directory:

```sh
session refresh --previous /tmp/session-previous.json
```

`ignore/` is excluded before traversal. The inventory does not make linked
history part of current context. Resolve deleted or moved references instead of
retaining an older item as if it were still live.

## Use the board

`serve` stays running and prints its local URL. Open that URL in the user's
browser or Codex panel. If the port is already serving this board and directory,
reuse it. Otherwise choose another port; do not stop an unknown process.

The header shows the launching worktree's name and Git branch. Non-Git folders
use their own `.session` and have no branch.

The board is a viewer with workflow actions. It shows the five lanes in stage
order and reads the item files directly; it never writes an item's content, and
there is no way to type a body or create an item in it. Cards open an embedded
Markdown reader that shows the item's file path, and Markdown links inside a body
resolve against the session directory. The stage control moves an item in one
click; unavailable destinations explain what is needed first. Settle missing
content with the agent or in the editor.

Select ready items in the Batch lane and use "Queue batch" to name them and
append the batch to Queue. The Queue lane groups cards under their batch in file
order and offers "Start next batch", disabled with its reason while Execute has
items or Queue is empty. Execute is frozen: its cards can only be completed,
which archives them under `ignore/COMPLETED.md`. Nothing drops into Queue or
Execute; a Queue card can be reordered inside its own batch or dragged back to
Batch, Design, or Triage.

Visible tabs reread disk every five seconds and on return to the tab. Refresh
pauses while a card is being dragged.

Every mutation checks the revision, a digest over every item file's path and
content, so a stale tab cannot overwrite a later edit on disk; reload and repeat
the action when one is rejected. A mutation writes its files before it deletes
the paths it replaced, so an interrupted one can only leave an item in two
places, which `check` reports as a duplicate ID.

Stage moves record decisions; they do not start an agent or grant new authority.
The agent continues execution from the user's request and the selected batch.

## Edit in your editor

The item files are ordinary Markdown, and the editor is where their content is
written. Edit them with the usual filesystem tools and run `check` afterward.
Preserve any unrelated edits. Prefer `mv` to a hand move: it validates the target
stage, keeps the batch rules, and renumbers the directories. A hand move must
carry the whole record and remove its old file; never leave duplicate IDs.

`check` rejects malformed records, duplicate IDs, missing stage-specific
sections, `# ` headings inside item files, Queue or Execute items belonging to no
batch, entries whose names break the numbering pattern, and a missing
`.gitignore`, which `session init` writes. It does not judge acceptance criteria
or user approval. An empty stage is an empty directory.

## App development

Development commands and binding design decisions live in the repository
[Project contracts](../../../README.md#project-contracts) and Development
section. Do not rebuild the app for each new session.
