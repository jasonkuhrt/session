# Operations

Installation links `session` into `~/.local/bin`. It works from anywhere inside a
worktree. `-C` points it elsewhere, at either a worktree or a `.session`
directory, and defaults to the current directory; a worktree is resolved through
Git.

```
session [-C <worktree-or-.session>] <command>

init                       migrate a symlinked .session to a real directory, write .gitignore, create missing stage files
check                      engine check; prints "OK <revision> (<n> items)" or the first error and exits 1
refresh [--previous F]     JSON path/hash inventory
serve [--port N]           run the board
ls [STAGE] [--json]        one line per item: ID, STAGE, batch (or "-"), title
show <ID>                  the item's Markdown chunk
add <STAGE> <ID> "<title>" [--batch NAME]      body on stdin
set <ID> [--title T]                           body on stdin when stdin is not a TTY
mv <ID> <STAGE> [--before ID] [--batch NAME]   body on stdin, when piped, replaces the body
batch "<name>" <ID...>     compose a named batch from Batch items and append it to Queue
start                      move the first Queue batch into Execute
done <ID>                  archive an Execute item under ignore/COMPLETED.md
split <STAGE>              convert a file stage to a directory stage
archive                    move this worktree's .session under the main worktree's .sessions/
```

Running the installed script with Bun is equivalent, and is the form to use when
the command is not on PATH:

```sh
bun ~/.codex/skills/session/scripts/session.ts -C /absolute/path/to/worktree check
```

Success prints one short line, such as `Queued "Email backend peel" (3 items)`
or `Moved BE-16 to BATCH`. Errors print a message on stderr and exit 1. A body
read from stdin is read in full and trimmed; `add` rejects an empty one.

## Move and batch rules

The engine owns placement, so the CLI refuses what the stage rules forbid. `add`
refuses Execute; it requires `--batch` naming an existing Queue batch when adding
to Queue, and refuses `--batch` for every other stage. `mv` never moves an item
into Execute, which `start` does, or out of it, which `done` does. Moving into
Queue needs `--batch` naming an existing batch; moving out of Queue drops the
batch. Within Queue, `--batch` changes the batch and `--before` must name an item
in the resulting batch. Without `--before`, an item lands at the end of the stage
or of its batch. The target stage's required sections are validated on arrival,
so pipe the rewritten body with the move; that is the ordinary way an item leaves
Design for Batch.

`batch` takes items that are all in Batch. `start` requires Execute to be empty
and keeps the batch's name. `done` archives the item under a heading naming its
batch.

## Set up and tear down

`init` makes `.session` real. It resolves an older `.session` symlink and renames
its target into place, removes a retired `.sessions` symlink beside it, writes
the `.gitignore` when missing, and creates a zero-byte file for every stage that
has neither a file nor a directory. It prints each action, preserves existing
content, and is safe to re-run: a real `.session` directory is left alone, and a
real `.sessions` directory is never touched. `serve` also creates missing stage
files; `check` reports an incomplete setup instead. Neither creates `RULES.md`:
standing rules are written from the user's words when the user states them, and
the inventory reports the file like any other.

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

`ignore/` and `.runtime/` are excluded before traversal. The inventory does not
make linked history part of current context. Resolve deleted or moved references
instead of retaining an older item as if it were still live.

## Use the board

`serve` stays running and prints its local URL. Open that URL in the user's
browser or Codex panel. If the port is already serving this board and directory,
reuse it. Otherwise choose another port; do not stop an unknown process.

The header shows the launching worktree's name and Git branch. Non-Git folders
use their own `.session` and have no branch.

The board reads and writes the stage records directly and shows five lanes in
stage order. Cards open an embedded Markdown reader. The stage control moves an
item in one click; unavailable destinations explain what is needed first. Work
with the agent to settle missing content. Source-file actions live in the lane
menu; for a directory stage the source sheet says so, and saving there writes the
item files.

Select ready items in the Batch lane and use "Queue batch" to name them and
append the batch to Queue. The Queue lane groups cards under their batch heading
in file order and offers "Start next batch", disabled with its reason while
Execute has items or Queue is empty. Execute is frozen: its cards can only be
completed, which archives them under `ignore/COMPLETED.md`. Nothing drops into
Queue or Execute; a Queue card can be reordered inside its own batch or dragged
back to Batch, Design, or Triage.

Visible tabs reread disk every five seconds and on return to the tab. Refresh
pauses during editing so drafts keep the revision they opened against.

The server rejects an outdated revision instead of overwriting newer disk edits.
Keep the draft visible, refresh the source, and reconcile it before retrying.
File moves use a recovery journal under `.runtime/`; do not remove that directory
to silence a recovery conflict. Inspect the reported conflicting files first.

Stage moves record decisions; they do not start an agent or grant new authority.
The agent continues execution from the user's request and the selected batch.

## Edit without the board

The format is ordinary Markdown. Edit it with the usual filesystem tools and run
`check` afterward. Preserve any unrelated edits. Cross-stage moves must retain the
whole record and remove its old occurrence; never leave duplicate IDs. Prefer
`mv` to a hand move: it validates the target stage and keeps the batch rules.

`check` rejects malformed records, duplicate IDs, missing stage-specific sections,
`# ` headings outside Queue and Execute, and Queue or Execute items belonging to
no batch. It also reports the layout faults that loading tolerates: a stage still
in one file past the line limit, fixed by `session split <STAGE>`, and a missing
`.gitignore`, fixed by `session init`. It does not judge acceptance criteria or
user approval. Empty stage files must be zero bytes.

## App development

Development commands and binding design decisions live in the repository
[Project contracts](../../../README.md#project-contracts) and Development
section. Do not rebuild the app for each new session.
