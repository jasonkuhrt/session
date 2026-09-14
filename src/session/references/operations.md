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
naming it; there is no fallback port. When a portless proxy is alive on the machine, `open` registers the daemon as
the `session` alias (once, again only if the port moves) and prints and opens
`https://session.localhost/w/<key>/` instead of the raw port.

Every `open` also has the daemon rescan. For each Git repository among the
worktrees it tracks, it lists that repository's worktrees and tracks every one
that exists and holds a `.session` directory; paths that have gone away are
dropped. Nothing watches for new worktrees, so one created later appears on the
next `open` or when someone presses Refresh on the index.

The index at `/` lists the tracked worktrees: name, branch, the running batch and
its size, the item counts per stage, and activity. Each board sits under
`/w/<key>/`, where the key is the worktree name, `Heartbeat` or
`email-backend/Heartbeat`. Two tracked worktrees whose names collide are a
conflict: the later one is listed with the reason and is not served.

## Use the board

A board's header shows its worktree's name and Git branch, and "All sessions"
links back to the index. A non-Git folder uses its own `.session` and has no
branch.

The board is a viewer with workflow actions. It shows the five lanes in stage
order and reads the item files directly; it never writes an item's content, and
there is no way to type a body or create an item in it. A card's title is a link
to that item's page at `/w/<key>/item/<ID>`, which reads its Markdown at a
reading width, shows the item's id and file path, and resolves Markdown links
inside the body against the session directory; it is an ordinary link, so it
opens in a tab like any other. The page carries the stage control, which moves
an item in one click and leaves you on the page in its new stage; unavailable
destinations explain what is needed first. "Complete work" is there for an item
in Execute, and returns you to the board. Settle missing content with the agent
or in the editor.

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

## Agents on the board

The board also shows the coding agents at work in that worktree. It is a
read-only overlay: it never moves, writes, or names an item, and the files stay
the work. Every fact in it is read from the agents' own listings at the moment
it is shown; nothing is kept between listings and nothing is inferred from what
a listing does not say. No CLI command lists agents, and the daemon starts no
session and sends nothing into one.

The Claude Code rows are the sessions Claude Code's own listing reports. That
listing does its own liveness filtering and the daemon adds none of its own,
so a row exists because Claude Code says it does. They are grouped to worktrees
by working directory: a session belongs to the worktree whose path is its
directory or a parent of it, and the longest match wins, so a worktree nested
inside another keeps its own sessions. Interactive and background sessions both
appear. The Codex rows are that worktree's interactive threads, the newest three
by recency, started from the Desktop, an editor, or the CLI. Archived threads,
`exec` runs, and subagent threads are left out: they are runs, not sessions to
go to.

A Claude chip carries the session's status as the listing gives it, the
session's name, and its actions. `waiting` is drawn in the accent colour with
the reason it is waiting, because it is the one status that means the session is
blocked on a person. A derived name is dimmed: it is a label, and `--resume`
cannot find it. "Terminal" focuses the cmux tab holding the session's process,
and appears only when the process is in one; when cmux refuses, the chip shows
the line cmux returned. "claude.ai" appears only when a Remote Control link was
recorded for the session, and opens it. When there is no terminal to focus, the
chip offers the session's resume command to copy instead, if it has one:
`claude --resume <session id>` for an interactive session, `claude attach <id>`
for a background one.

A Codex chip carries the thread's origin, its name or, failing that, its first
line, and how long ago it was last active. "Open in Codex" opens
`codex://threads/<id>` and is always available, because that id comes from the
same listing being rendered. A dot marks a thread that is loaded, meaning a live
process holds its writer lock. The resume command is offered only for a thread
nothing holds, because Codex refuses to resume one that already has an active
writer.

The index carries the same reading in one column per worktree: the Claude
sessions counted by status, waiting first, and how many Codex threads are
loaded. A worktree with neither shows a dash, and notices are printed once under
the header rather than on every row.

Its Activity column answers when the worktree last did anything, from either
side of the board. A worktree holding a session that is `busy` or in a shell
reads `busy now`, in the present tense, and sorts to the top; otherwise the
column names the newest moment left behind and what left it, `agent` for a
Claude session's status change or a Codex thread, `records` for an item file,
with the exact time on hover. A worktree where neither has happened reads a dash
and falls into the last band. A status time is when that status last changed and
nothing more: it dates activity, it is not a heartbeat, and an old one is an
agent that has held still rather than an agent that has gone.

The listing is recomputed when the index renders, when Refresh is pressed, and
when the Claude session registry or the Codex writer-lock directory changes. A
change pushes an `agents` event to the index and to every open board, and they
refetch; a board request otherwise reuses the last listing until it is thirty
seconds old.

The overlay claims nothing its sources do not state. Nothing is concluded from a
timestamp: a session that has written no status for days is not marked stale,
hung, or dead, and `idle` is not read as "ready for you". There is no Codex turn
status; a thread is loaded in an app or it is not, and whether it is mid-turn is
knowable only inside the process that owns it. No count is a count of all your
agents: agent-team teammates, in-process subagents, bare sessions, and cloud
sessions never register, so what you see is what registered under this worktree.
A name is never a resume handle, which is why the command is there to copy. The
claude.ai link records that the session was bridged at some point, not that it
is bridged now, so it may open a page that is disconnected. And not every
session has a terminal to focus; that is ordinary, not a fault.

A source that cannot be reached says so. "Claude Code not available" means its
listing could not be run or did not answer in time. "Codex not available" means
`codex` could not be started or refused the handshake, and "Codex unavailable
(timeout)" that it started and did not answer inside its budget. Each notice
stands for its own source, the other source and the rest of the board are
unaffected, and an empty strip reads "No agent sessions here" with the notices
beside it, so a failed listing never passes for an empty one. A machine running
no cmux is not a failure: those rows simply carry no "Terminal" action.

The `### Agent` line an executing agent writes into its item file, in
[records.md](records.md), stays a convention between agents. The board does not
read it, does not match it against the sessions it lists, and never writes it.

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
