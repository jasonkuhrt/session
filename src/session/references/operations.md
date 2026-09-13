# Operations

Installation links `session` into `~/.local/bin`. It works from anywhere inside a
worktree. `-C` points it elsewhere, at either a worktree or a `.session`
directory, and defaults to the current directory; a worktree is resolved through
Git.

```
session [-C <worktree-or-.session>] <command>

init                       create whatever the session is missing and print it; for handing off to your editor
check                      validate; prints "OK <revision>, <n> items" or "OK <revision>, empty", or the first error and exits 1
refresh [--previous F]     JSON path/hash inventory
ls [STAGE]                 one line per item: ID, path, title; the path encodes stage, batch, and order
add <STAGE> <ID> "<title>" new item, body on stdin; refuses Queue and Execute
mv <ID> <STAGE> [--before ID]   refuses into Queue or Execute and out of Execute
batch "<name>" <ID...>     compose a named batch from Batch items and append it to Queue
start                      move the first Queue batch into Execute
done <ID>                  finish an Execute item into archive/
archive <ID>               archive an item from any stage into archive/, recording the stage
open                       ensure the daemon and this worktree, then open its board
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
never out of Execute, which `done` and `archive` do. Within Queue, `--before`
reorders an item inside its own batch. Without `--before`, an item lands at the
end of the stage. The target stage's required sections are validated on arrival,
so rewrite the item file first and then move it; that is the ordinary way an
item leaves Design for Batch.

`batch` takes items that are all in Batch. `start` requires Execute to be empty
and keeps the batch's name.

## Finish and archive

`done <ID>` finishes an item in Execute. `archive <ID>` files an item from any
stage, Execute included, when the work is not going to happen. Both write the
item into `.session/archive/` and then delete its file, both refuse when that
name is already taken, and neither has a button on the board.

An archive file is named for the day it was archived, the item, and the state it
left: `2026-09-13 BE-16 — Peel the email backend (done).md`. The state is `done`
for a finished item and the lowercase stage otherwise, so `(batch)` is settled
work that never ran and `(triage)` a rejected candidate.
[records.md](records.md) has the rest of the format. Like `ignore/`, `archive/`
stays out of agent context: a refresh skips it, the board does not serve files
from it, and it is never loaded as a stage.

## Set up

Nothing has to be set up. A command that touches the records creates the session
first: `.session`, the five stage directories, and the `.gitignore` when they are
missing. `check` only reads what is on disk.

`init` does that scaffolding and nothing else. It prints each action it took, or
that there was nothing to do, and it exists so a new session can be handed
straight to an editor. Nothing depends on it having been run.

The CLI never migrates. A `.session` that is a symlink to something that exists
is refused by every command, with the fix in the message: replace the link with
a real directory, then retry. A dangling link points at nothing, so scaffolding
replaces it with the real directory. A leftover `STAGE.md` from the single-file layout is reported by
`check`, which names the file and says to fold it into `STAGE/` by hand. Old
sessions are converted by hand, the existing ones by a one-off sweep.

`check` converges nothing: it reads what is on disk and names the fix for what it
finds, such as that leftover file or a missing `.gitignore` that the next command
will write. When the session is sound it prints one line, the revision and the
item count, or `empty` when no stage holds an item; that line answers whether
everything is done. No command creates `RULES.md`; standing rules are written
from the user's words when the user states them, and the inventory reports the
file like any other.

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

`ignore/` and `archive/` are excluded before traversal. The inventory does not
make linked history part of current context. Resolve deleted or moved references
instead of retaining an older item as if it were still live.

## Open the board

`session open` ensures the session, ensures the daemon, adds this worktree to it,
prints the board's URL, and opens it in the browser on macOS. Run it when the
user asks for the board, not as a matter of course.

One daemon serves every worktree, one process per user, on `127.0.0.1:53045`. Its
state is `~/.local/state/session/daemon.json`: the pid, the port, the start time,
a stamp of the sources it was started from, and the worktrees it tracks. It logs
beside that file, in `daemon.log`. `open` reuses a healthy daemon whose stamp
still matches the sources on disk. It replaces one that is unhealthy or built
from older sources, killing the old process first, so a rebuilt board reaches
every worktree at the next `open`. A foreign process holding the port is an error
naming it; there is no fallback port.

Every `open` also has the daemon rescan. For each Git repository among the
worktrees it tracks, it lists that repository's worktrees and tracks every one
that exists and holds a `.session` directory; paths that have gone away are
dropped. Nothing watches for new worktrees, so one created later appears on the
next `open` or when someone presses Refresh on the index.

The index at `/` lists the tracked worktrees: name, branch, the running batch and
its size, the item counts per stage, and the last change. Each board sits under
`/w/<key>/`, where the key is the worktree name, `Heartbeat` or
`email-backend/Heartbeat`. Two tracked worktrees whose names collide are a
conflict: the later one is listed with the reason and is not served.

## Use the board

A board's header shows its worktree's name and Git branch, and "All sessions"
links back to the index. A non-Git folder uses its own `.session` and has no
branch.

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
which files them under `archive/`. Nothing drops into Queue or
Execute; a Queue card can be reordered inside its own batch or dragged back to
Batch, Design, or Triage.

The board follows the files. The daemon watches that worktree's `.session` and
pushes an event when anything under it changes, and the board refetches the
session; it never polls. Refetching pauses while a card is being dragged.

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
batch, entries whose names break the numbering pattern, a missing `.gitignore`, a
`.session` that is a symlink, and a leftover `STAGE.md`. It does not judge
acceptance criteria or user approval. An empty stage is an empty directory.

## App development

Development commands and binding design decisions live in the repository
[Project contracts](../../../README.md#project-contracts) and Development
section. Do not rebuild the app for each new session.
