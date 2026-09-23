# Operations

Installation links `session` into `~/.local/bin`. It works from anywhere inside a
worktree. `-C` points it elsewhere, at either a worktree or a `.session`
directory, and defaults to the current directory; a worktree is resolved through
Git.

```
session [-C <worktree-or-.session>] <command>

init                       create whatever the session is missing and print it; for handing off to your editor
check                      validate; prints "OK <revision>, <n> items" or "OK <revision>, empty", or the first error and exits 1
refresh [--previous F]     JSON path/hash inventory, and what it skipped
ls [STAGE]                 one line per item: ID, path, title; the path encodes stage, batch, and order
add <STAGE> <ID> "<title>" new item, body on stdin; refuses Queue and Execute
mv <ID> <STAGE> [--before ID]   refuses into Queue or Execute and out of Execute
batch "<name>" <ID...>     compose a named batch from Batch items and append it to Queue
start                      move the first Queue batch into Execute
done <ID>                  finish an Execute item into archive/
archive <ID>               archive an item from any stage into archive/, recording the stage
log "<by>" "<title>"       write a ledger entry, body on stdin; prints "Logged <date> — <title>"
open                       ensure the daemon and this worktree, then open its board
```

Running the installed script with Bun is equivalent, and is the form to use when
the command is not on PATH:

```sh
bun ~/.codex/skills/session/scripts/session.ts -C /absolute/path/to/worktree check
```

Success prints one short line, such as `Queued "Email backend peel" (3 items)`
or `Moved BE-16 to BATCH`. Errors print a message on stderr and exit 1. `add` and
`log` are the commands that read stdin, in full and trimmed. `add` takes the new
item's body there, reads it to its end whatever stdin is, and rejects an empty
one. `log` takes the entry's body, which may be empty: a terminal gives none; a
pipe or a file is read to its end; and a socket, which is what a program that
spawns the CLI hands it, is read to its end once it starts sending within half
a second. A socket that stays silent, like the one an agent's shell tool holds
open without writing to it, gives no body instead of a wait that never ends.

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
item into `.session/archive/` and then delete its file, and both refuse when
that name is already taken. On the board, "Complete work" runs `done`; `archive`
has no button.

An archive file is named for the day it was archived, the item, and the state it
left: `2026-09-13 BE-16 — Peel the email backend (done).md`. The state is `done`
for a finished item and the lowercase stage otherwise, so `(batch)` is settled
work that never ran and `(triage)` a rejected candidate.
[records.md](records.md) has the rest of the format. Like `ignore/`, `archive/`
stays out of agent context: a refresh skips it, and it is never loaded as a
stage. The board does serve it, read-only, for a person looking back: a listing
of its records, and each record through the files route.

### Close an item from a commit

A commit can finish items itself. End its message with a `Session-Done` trailer
naming them, in the final paragraph where Git keeps trailers:

```text
feat(email): one tenant-scoped reader

Session-Done: BE-12
Session-Done: BE-13, BE-14
```

The daemon watches every tracked worktree's reflog, so it sees the commit the
moment it is made, and the engine files each named item as done from whatever
stage it is in: the commit is the evidence of completion, so the route through
Execute that `done` insists on does not apply. The item's text gains a
`### Closed by commit` section with the commit's hash and subject, which is what
says later why the item left. Git's own trailer parser reads the message, and
the key matches without regard to case, as Git's does. The daemon also reads
again when the session changes and when a push moves a remote-tracking ref, so
a report clears the moment its commit is pushed. A change under `context/` or
`ledger/` is not such a change: nothing there can make an item exist or bring
one back, so it never starts a pass.

Only this branch's commits that no remote has yet are read, first parent only,
so a merged branch contributes none of its own claims. That range is also the
catch-up: a commit made while the daemon was down is honoured when it starts.
Every pass is derived from the history and the files as they are, decided under
the session's own lock. An item that a commit filed away and a person then
brought back is left alone: moved back, its text still carries that commit's
note; added again, its archived record does.

A trailer that cannot be acted on is reported on that worktree's board, in one
sentence per commit, and as a count beside its name on the index:

- the id is not in the session, open or archived;
- the `Session-Done:` line is outside the last paragraph, so Git does not read
  it as a trailer and nothing was closed;
- filing the item away failed, for instance because a record of that name
  already exists that day; this is tried again whenever the session changes
  outside `context/` and `ledger/`, or the branch changes.

The fix for the first two is to amend the commit. A report lasts while the
commit is unpushed and goes once it is fixed or pushed, when it can no longer be
amended without rewriting published history.

## Log to the ledger

`session log "<by>" "<title>"` writes one entry into `ledger/`, the session's
shared log, which [records.md](records.md) describes: something another agent,
or the user, must know to act correctly here and would not learn from the
items. `<by>` is who is writing, `claude <session id>`, `codex <thread id>` or a
person's name. The body comes on stdin and may be empty. The command reads the
clock for `date`, to the second, and adds what it can observe: `branch` and
`commit` from Git, and `batch`, the batch Execute is running. A key it cannot
observe is left out: both Git keys outside a repository, `branch` on a detached
HEAD, `commit` before the first commit, and `batch` while Execute is empty. It
takes no flags, and on success prints one line, `Logged 2026-09-23 14-02-11Z —
Pivot to per-item evidence`, which is the entry's file name without `.md`.

The entry is checked by the rules `check` applies before it is written, so a
body with a heading or a title too long for a file name is refused and nothing
is written. It is refused too when `ledger` is a link rather than a directory,
so an entry is never written outside the session. An entry is never
overwritten: a second one with the same title in the same second is refused.
Only the name of Execute's batch directory is read for `batch`, so a broken
item elsewhere does not stop an entry. There is no board button and no HTTP
route for it, because the board never writes content; an agent may also write
an entry by hand, in the same form.

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
file like any other. `ledger/` appears with its first entry, and `context/`
when an agent first writes there.

## Refresh context

`refresh` returns a JSON path/hash inventory and added, changed, and deleted
paths. It does not return file contents. On the first refresh, read `RULES.md`
when it exists, then the ledger, then the five stage records, and relevant
supporting context. On later turns, compare inventories and read only changed
relevant files; a new ledger entry arrives as an added path, which is how
agents in one session hear from each other. Preserve the inventory in
conversation context. For a deterministic comparison, pass a previous refresh
output saved outside the session directory:

```sh
session refresh --previous /tmp/session-previous.json
```

The root's `ignore/` and `archive/` are excluded before traversal, and those
two only: a directory of either name further down, such as
`context/SES-1/archive/`, is read like any other. The inventory does not make
linked history part of current context. Resolve deleted or moved references
instead of retaining an older item as if it were still live.

Outside the five stages, an entry the inventory cannot take in does not fail
the refresh. It is listed under `skipped`, each with its `path` and `reason`,
and the rest of the inventory stands: a link that resolves outside the session
directory, a link that leads nowhere or back into a directory that holds it,
or an entry that could not be read. The stages themselves must load first, as
for every command, so a broken item file still fails the refresh with the
error `check` would name.

```json
"skipped": [{ "path": "context/out.md", "reason": "resolves outside the session directory" }]
```

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

`open` also gives the board a name to answer to. Whenever portless has a state
directory on this machine it registers the daemon as the `session` alias, once,
and again only if the port moves; the alias is a line in portless's route table,
so registering it while no proxy runs is what makes the board reachable by name
the moment one starts. What it then prints comes from that directory and nothing
else: the hostname from the route, the scheme from the marker a running proxy
writes for TLS, and a port unless it is that scheme's default, which is how
portless writes its own URLs. If the alias cannot be used, `open` prints
`http://127.0.0.1:53045/w/<key>/` and one line on stderr saying why, naming the
proxy that is not running or the alias that could not be registered. Nothing
about the address is guessed, because a printed address that does not reach the
board is worse than a plain one.

The daemon answers only at those addresses: its port on `127.0.0.1` and on
`localhost`, and the portless alias routed to that port. A request naming any
other host is refused, so a web page elsewhere that points a name of its own at
this machine cannot read a board.

Every `open` also has the daemon rescan. For each Git repository among the
worktrees it tracks, it lists that repository's worktrees and tracks every one
that exists and holds a `.session` directory; paths that have gone away are
dropped.

The index keeps itself current between those rescans, which is why it carries no
refresh button. A worktree joins it as soon as a session exists: every command
but `check` converges the session it was pointed at, and when that scaffolds
anything it registers the worktree with a daemon that is already running. It
never starts one; `open` is the command that does that. A worktree leaves it as
soon as its session is gone: each tracked worktree's own watcher re-asks whether
the `.session` is still a real directory on every event and when the watch ends,
and the first `no` drops the row, rewrites the state file and pushes a
`worktrees` event to every open index. `POST /api/worktrees/refresh` remains as
the route the CLI registers through.

The index at `/` lists the tracked worktrees: name, branch, the agents at work
in it, the item counts per stage, and activity. The batch in Execute is named
beside that stage's count, which is the only place a batch is named, and a stage
holding nothing renders an empty cell, so the five columns read as a pipeline by
what is in them. Each board sits under `/w/<key>/`, where the key is the
worktree name, `Heartbeat` or `email-backend/Heartbeat`. Two tracked worktrees
whose names collide are a conflict: the later one is listed with the reason and
is not served.

## Use the board

A board's header shows its worktree's name and Git branch, and "All sessions"
links back to the index. A non-Git folder uses its own `.session` and has no
branch.

The board is a viewer with workflow actions. It shows the five lanes in stage
order and reads the item files directly; it never writes an item's content, and
there is no way to type a body or create an item in it. A card's title is a link
to that item's page at `/w/<key>/item/<ID>`, which reads its Markdown at a
reading width, shows the item's id and its path under the session, and resolves
Markdown links inside the body against the session directory; the path copies
the absolute file, which is what a terminal beside the page can open. An id
with a dot in it, such as `BE-1.2`, has its page like any other: a path under
a board that is not one of its routes gets the app, dots and all, except an
unknown `/api/` path, which is an error, and a path ending in the name of one of
the app's own files, which is that file. It is an
ordinary link, so it opens in a tab like any other. The page carries the stage
control, which moves an item in one click and leaves you on the page in its new
stage; unavailable destinations explain what is needed first. "Complete work" is
there for an item in Execute, and returns you to the board. Settle missing content with the agent
or in the editor.

The Markdown links in an item resolve through the board's files route,
`/w/<key>/files/<path>`, which serves any regular file under the session:
Markdown as Markdown, PNG, JPEG, GIF, WebP and SVG images as images, and
anything else as plain text. Nothing under a directory named `ignore` is
served, at any depth, and neither is anything that resolves outside the
session; `archive/` is served. What the route serves never runs: it is sent
sandboxed and is never sniffed into another type.

Select ready items in the Batch lane and use "Queue batch", which appears once
something is selected, to name them and append the batch to Queue. The Queue
lane groups cards under their batch in file order and offers "Start next
batch" while there is a batch to start and Execute is empty. Neither button is
ever drawn disabled with a reason: an empty selection and an occupied Execute
are already visible in the lanes themselves. Execute is frozen: its cards can
only be completed, which files them under `archive/`. Nothing drops into Queue
or Execute; a Queue card can be reordered inside its own batch or dragged back
to Batch, Design, or Triage.

Beside the session, each board serves three read-only listings. `GET
/w/<key>/api/ledger` is the ledger's entries, newest first by date and then by
name, with a notice naming each file in `ledger/` that breaks the ledger's
rules and is left out. `GET /w/<key>/api/context` is every file and directory
under `context/`, depth first, each with when it was written, and a notice for
an entry left out, such as a link that resolves outside the session; names
starting with a dot are left out, and so is anything named `ignore`, which the
files route never serves.
`GET /w/<key>/api/archive` is the archive's records as their names give them,
the day, the item, the title and the state it left in, newest first; a name the
engine did not write is listed as it is.

The board follows the files. The daemon watches that worktree's `.session` and
pushes an event when anything under it changes, `context/` and `ledger/`
included, and the board refetches; it never polls. Refetching pauses while a
card is being dragged.

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

The strip is ordered by one concept: live against resumable. A live session has
a process behind it (`pid` is set) and a live thread is one an app holds open;
only a live thing can need you now. A resumable session's process is gone and
its `state` is the last thing Claude Code knew about it, which may be weeks old;
a resumable thread is one no app holds. Live rows come first, resumable rows
follow at reduced contrast, and each tier is named as soon as the second one has
anything in it. Every row keeps its age, because for a resumable row the age is
the one fact that says how stale its state is.

A Claude chip carries one word for the session, its name, its age, and its
actions. The word is the `status` of a live session, and for a resumable one the
`state` Claude Code last knew it in:

| word | what the listing means by it |
| --- | --- |
| `busy` | working on a turn |
| `shell` | running a shell command |
| `idle` | waiting for the next prompt |
| `waiting` | needs you, with the reason beside it |
| `working` | driving its own work: a turn, a loop iteration, or a wait on CI |
| `blocked` | needs you: a question it asked, a permission or sandbox decision, an error only you can clear, or its first prompt |
| `done` | its last turn finished; ready for the next prompt |
| `failed` | ended with an error |
| `stopped` | was stopped |

Without `--all` the listing holds active sessions, so the last three are not
expected; a word this build has never heard of is shown as it arrived and never
folded into one it knows. The accent colour is spent on one thing only: a live
session that is `waiting` or `blocked`, with the reason when the listing gives
one, because that is a session stopped on a person right now. A resumable
session's `blocked` is a memory, not a request, so it is never accented; it
sorts last, and its word's tooltip says that its process is gone, what Claude
Code last knew, and that `claude attach` picks it up.

A live session's age is its time in status, `idle for 3 h`, because how long it
has held is what decides whether to go to it; a resumable session's age is when
it started. Both carry the exact moment.

"Focus terminal" focuses the cmux tab holding the session's process, and appears
only when the process is in one; when cmux refuses, the chip shows the line cmux
returned. "Open on claude.ai" appears only when a Remote Control link was
recorded for the session, and opens it. When there is no terminal to focus, the
chip offers "Copy resume command" instead, if the session has one:
`claude --resume <session id>` for an interactive session, `claude attach <id>`
for a background one. "Copy session id" is there whenever the listing carries
one. Names are never acted on, so nothing on the board says where a name came
from.

A Codex chip carries the thread's origin, its name or, failing that, its first
line, and how long ago it was last active. "Open in Codex" opens
`codex://threads/<id>` and is always available, because that id comes from the
same listing being rendered; "Copy thread id" is there beside it. The word is
`open` when a live process holds the thread's writer lock, `not open` when the
locks were read and this thread was not among them, and `unknown` when they
could not be read at all. Only `not open` is resumable: it is the one answer
that carries "Copy resume command", because Codex refuses to resume a thread
that already has an active writer, and an `unknown` thread is never demoted as
if nothing held it.

The index carries one column per worktree, a pill per live session rather than a
count: its dot, its word, and its name, ordered as the board orders its rows. A
pill opens the menu of that session's actions, which is the board's own list
rendered as a menu, under a line naming the session, its harness, what its word
means, and its age. Copying keeps the menu open and says what happened; focusing
a terminal closes it, or keeps it open showing the line cmux returned. Only live
things are named here: a session whose process is gone and a thread nothing
holds are handles, not work under way, and listing them would say something is
happening where nothing is. They are on that worktree's own board, which is
where a reader has already chosen the scope. A worktree with nothing live shows
a dash, and notices are printed once under the header rather than on every row.

Its Activity column answers when the worktree last did anything and who did it:
`Claude Code` for a session's status change, `Codex` for a thread's update,
`Items` for an item file written, each with the age beside it and the exact
moment in the sentence behind it. What is happening now is the Agents column's
answer, not this one's. A worktree where none of the three has happened reads a
dash and falls into the last band. A status time is when that status last
changed and nothing more: it dates activity, it is not a heartbeat, and an old
one is an agent that has held still rather than an agent that has gone.

The listing is recomputed when the index renders and when the Claude session
registry or the Codex writer-lock directory changes. A change pushes an `agents`
event to the index and to every open board, and they refetch; a board request
otherwise reuses the last listing until it is thirty seconds old.

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

A source that cannot be reached says so, in a sentence that carries the
consequence. "Claude Code did not answer, so its sessions are not listed" means
its listing could not be run or did not answer in time. "Codex is not installed,
so its threads are not listed" means `codex` could not be started or refused the
handshake, and "Codex did not answer in time, so its threads are not listed"
that it started and did not answer inside its budget. Each notice
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
`.session` that is a symlink, and a leftover `STAGE.md`. It closes the session
root: any entry other than the five stages, `archive/`, `ignore/`, `context/`,
`ledger/`, `RULES.md`, `.gitignore` and names starting with a dot is an error
that names it and says to move it under `context/` or delete it, or to rename
it when only its case differs from one of these. The directories must be
directories, and `RULES.md` and `.gitignore` files. In `ledger/` it rejects a
directory, a link, and a `ledger` that is itself a link, and an entry whose
frontmatter is missing `date`, `title` or `by`, carries any other key, holds
anything but one line of text per key or a value YAML reads differently from
how it is written, or has a `date` that is not a UTC instant to the second;
whose name is not the one its date and title give; or whose body, read the way
the board renders it, has a heading. It does not look inside `context/`. It does
not judge acceptance criteria or user approval. An empty stage is an empty
directory.

## App development

Development commands and binding design decisions live in the repository
[Project contracts](../../../README.md#project-contracts) and Development
section. Do not rebuild the app for each new session.
