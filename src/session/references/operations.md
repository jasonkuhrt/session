# Operations

Installation links `session` into `~/.local/bin`. It works from anywhere inside a
worktree. `-C` points it elsewhere, at either a worktree or a `.session`
directory, and defaults to the current directory; a worktree is resolved through
Git.

```
session [-C <worktree-or-.session>] <command>

init                       create whatever the session is missing and print it; for handing off to your editor
check                      validate; prints "OK <revision>, <n> items" or "OK <revision>, empty", or the first error and exits 1
brief                      what an agent reads first: check's line or its error, RULES.md, the newest ledger titles, ls; exits 0
refresh [--previous F]     JSON path/hash inventory, and what it skipped
ls [STAGE]                 one line per item: ID, path, title; the path encodes stage, group, and order
add <STAGE> <ID> "<title>" new item, body on stdin; refuses Queue and Execute
mv <ID> <STAGE> [--before ID|GROUP]   refuses into Queue or Execute and out of Execute; another stage drops the group
group "<name>" <ID...>     gather items of one stage into a named group; refuses Queue and Execute
ungroup <ID...>            take items out of their groups, to the end of their stage; refuses Queue and Execute
batch "<name>" <ID...>     compose a named batch from Batch items, grouped or not, and append it to Queue
start                      move the first Queue batch into Execute
done <ID>                  finish an Execute item into archive/
archive <ID>               archive an item from any stage into archive/, recording the stage
log "<by>" "<title>"       write a ledger entry, body on stdin; prints "Logged <date> — <title>"
join "<epic>"              put this worktree in the named epic, out of any other; refuses a main worktree
leave                      take this worktree out of its epic
order [--before <worktree>]  place this worktree among its siblings, before that one or last among the ranked
open                       ensure the daemon and this worktree, then open its board
daemon status              whether the daemon runs and was started from the sources on disk; its pid, port, start and log
daemon restart             stop the daemon and start one from the sources on disk, current or not; prints the pids
```

Running the installed script with Bun is equivalent, and is the form to use when
the command is not on PATH:

```sh
bun ~/.codex/skills/session/scripts/session.ts -C /absolute/path/to/worktree check
```

`STAGE` is a stage's name, `Triage`, `Design`, `Batch`, `Queue` or `Execute`,
in any case, so `session mv BE-16 design` and `session mv BE-16 Design` are one
command. What the CLI prints names a stage as it is named and a file by its
path, which starts with the stage's directory, such as `3-Batch/`.

Success prints one short line, such as `Queued "Email backend peel" (3 items)`,
`Moved BE-16 to 3-Batch/030-BE-16.md` or
`Grouped 2 items in 1-Triage/020-Needs a decision`. Errors print a message on
stderr and exit 1. `add` and
`log` are the commands that read stdin, in full and trimmed. A pipe or a file is
read to its end. A socket, which is what a program that spawns the CLI hands
it, is read to its end once it starts sending within half a second; one that
stays silent that long, like the one an agent's shell tool holds open without
writing to it, gives no body instead of a wait that never ends. `add` takes the
new item's body, reads a terminal to its end too, and rejects an empty body, so
on a silent socket it refuses at once. `log` takes the entry's body, which may
be empty, and reads nothing from a terminal. When a body starts on its socket
in the half second after that, it is too late: `log` has written the entry
without it, says on stderr that the body was not written, and keeps the exit
code of the write. A body that starts later still is not seen at all.

## Move, group and batch rules

The engine owns placement, so the CLI refuses what the stage rules forbid. `add`
creates an item in Triage, Design, or Batch, in no group at the end of the
stage, and refuses Queue and Execute, because a Queue batch is composed with
`batch` and Execute is entered only by `start`. `mv` moves between Triage,
Design, and Batch, and out of Queue into any of them. It never moves an item
into Queue or Execute, and never out of Execute, which `done` and `archive` do.
The target stage's required sections are validated on arrival, so rewrite the
item file first and then move it; that is the ordinary way an item leaves Design
for Batch.

An item `mv` takes to another stage leaves its group, as one that leaves Queue
leaves its batch, and lands in no group there. Inside its own stage it keeps
its group. Without `--before`, an item lands at the end of its group, or at the
end of the stage when it is in none. `--before` names the item it goes in front
of, which must be in the same group, or in none for an item in none; that is how
an item is reordered inside its Queue batch, or inside a group anywhere. In
Triage, Design and Batch, `--before` may name a group of the target stage
instead: a group is an entry of its stage beside the items in no group, ordered
by the same prefixes, so the item leaves any group it is in and goes just
before the group's directory, in no group. A name that is both an item's and a
group's in that stage is read as the item's. An item that is all its group
holds and goes in front of that group leaves it where it is, and the emptied
group goes.

`group "<name>" <ID...>` gathers items that are all in one of Triage, Design, and
Batch into the group of that name there. A group the stage does not hold yet
starts at the end of the stage; one it holds takes the items at its own end, in
the order given, so a second `group` with the same name adds to the first. An
item already in that group stays where it is, because `group` says what an item
belongs to and `mv --before` says where it sits. `ungroup <ID...>` takes items
out of their groups, each to the end of its own stage, and leaves an item in no
group where it is. Both refuse Queue and Execute, where every group is a batch:
a batch is composed from Batch with `batch`, and a queued item leaves its batch
only by leaving Queue. `group` trims the name, as `batch` does, and refuses one
that is empty or holds a `/`; [records.md](records.md) has the rules a group
directory keeps.

`batch` takes items that are all in Batch, in a group there or not. Each leaves
its group for the batch, and a group it empties goes with it. `start` requires
Execute to be empty and keeps the batch's name.

The board makes the same changes through its own routes, each checked against
the revision and answered with the session:

- `POST /w/<key>/api/move {id, to, beforeId?, beforeGroup?, group?, revision}`
  moves as `mv` does. `group` is the drop target's group: one the target stage
  already holds, or `null` for none. Left out, the item keeps its group inside
  its own stage and has none in another, as with `mv`. A group the target stage
  does not hold is refused rather than started, because starting one is
  `group`'s to do. `beforeGroup` names a group of the target stage that the
  item goes in front of, as `--before` does when it names a group, and puts the
  item in no group when `group` is left out; it is refused together with
  `beforeId`, with a `group` that is not `null`, and for a group the stage does
  not hold.
- `POST /w/<key>/api/group {ids, name, revision}` is `group`.
- `POST /w/<key>/api/ungroup {ids, revision}` is `ungroup`.

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
stage. The board does serve it, read-only, for a person looking back: the
archive page lists its records, and each opens on the file page.

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
a report clears the moment its commit is pushed. A change under `context/`,
`ledger/` or `meta/` is not such a change: nothing there can make an item exist
or bring one back, so it never starts a pass.

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
  outside `context/`, `ledger/` and `meta/`, or the branch changes.

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

## Epics

`session join "<epic>"` puts the worktree in the epic of that name by writing
its `meta/epic`, which [records.md](records.md#meta) describes, and so takes it
out of any other epic, since a worktree is in one at most; creating an epic and
joining it are the same act. `session leave` removes the file. Neither takes an
option of its own: each acts on the worktree `-C` names, one command per
worktree, so a lead puts its workers in an epic one command each, and each
converges the session and registers it with a running daemon as every command
does. `join` trims the name, as `group` does, and refuses one that is empty,
holds a `/` or breaks a line. It refuses a main worktree, naming the rule: a
main worktree is never in an epic, since Git keeps the repository there and
lists it first. `leave` works in any worktree, a main one included, and in one
in no epic it has nothing to do. Success prints one line: `Joined "Back
burner"`, `Joined "Back burner", leaving "Epics"` when the worktree moved,
`Left "Back burner"`, or `In no epic, so nothing to leave`. Renaming an epic
from a terminal is a `join` in each of its worktrees, and a name another epic
has merges the two; since each is a join, each takes its worktree's rank away,
where the index's rename to a name no epic has, below, keeps every rank.
Deleting a worktree takes its membership with it, and nothing else has to be
done.

The index writes the same file through `POST /api/worktrees/epic {path, epic,
from}`: the worktree by its path, as `POST /api/terminal` takes it, so a row the
index lists but does not serve is reached as well and a key two rows share can
never send a write to the wrong one; the epic's name, or `null` for none; and
`from`, the epic the index had read for that worktree when the change was asked
for. A linked worktree's rank goes with the change, as with `join` and `leave`.
When the file names anything else by then, a file the rules reject reading as
none, the write is refused with 409, changed on disk, as a stale revision
refuses a move. The route answers with the epic the worktree is in now. It
converges nothing else: `meta/epic` depends on no stage, so a session from
before the stages were numbered, which every command refuses, can still be
dragged into an epic and out of one, and `meta/` is made when nothing holds its
name. It refuses a main worktree, a name the rules reject, and, with 404, a path
it does not track or whose session has gone, which it never brings back. The
watch on the session is what tells the index, as it is for a `join` in a
terminal.

The index renames an epic through `POST /api/worktrees/rename {from, to}`, one
request, since a rename is one act on the epic: under the lock its other writes
take, the daemon moves every tracked worktree whose file names `from` to `to`,
and tells from the worktrees it tracks which kind of rename it is. When no other
tracked worktree names `to`, it is the same epic under another name, and every
worktree keeps its rank. When one does, the two merge, and the worktrees that
arrive join `to` unranked, after its ranked ones, whose ranks stay as they are.
The worktrees naming `to` are read again just before the first write, so one
that joined it meanwhile refuses the rename with 409, and each worktree is
written against `from`, so one whose file changed since refuses its write with
409 as well. A name the rules reject is refused with 400, and an epic no tracked
worktree is in now with 409. It answers with the epic's name now and whether it
merged.

## Order

`session order` places the worktree among its siblings by writing its
`meta/rank`, which [records.md](records.md#meta) describes. A main worktree's
siblings are the other main worktrees the daemon tracks, so its rank orders its
project among the projects on the index; any other worktree's are the other
worktrees of its epic, so its rank orders it in the epic's card. Ranked
siblings stand first, in the order of their ranks, and the unranked ones after
them by what is happening in them. `--before <worktree>` names the sibling it
goes before, by any path inside that worktree, which Git resolves as it resolves
`-C`; left out, the worktree goes last among the ranked ones. A sibling that is
not ranked stands after every ranked one, and a command has no drawn order to
follow, so naming one puts the worktree last among the ranked ones too, which
is still before it. It takes no other option,
and like every command it converges the session first, so a main worktree
without one gets one and is placed. The siblings are the worktrees the daemon
tracks, as its state file lists them, so the command reads that file whether or
not the daemon runs, and one tracking nothing gives a worktree no siblings.

The rank is the number halfway between those of the two siblings it goes
between, or 10 past the last one's, and a worktree already between them keeps
the rank it has and nothing is written; only when there is no room are the
ranked siblings numbered again from 10, and only the ranks that change are
written, the siblings first and the worktree last. Just before it writes, it
reads every sibling's rank again, each under its session's lock, and each file
is written against the rank read for it, so a placement whose ranks changed in
the meantime, by another command or a drag on the index, is refused: `Not
ordered: a rank among these worktrees changed on disk since it was read; try
again.` Success prints one line: `Ranked alpha-one 15 in "Back burner", before
alpha-two`, `Ranked session 30 among the projects, after Heartbeat`, `Ranked
session 10 among the projects, the only one ranked`, or `Already ranked …` when
nothing had to change. It refuses a worktree in no epic that is not a main one,
since that stands by what happens in it and is ranked among nothing, with the
fix, to join an epic first; a `--before` that names no sibling, naming the
siblings there are; and a path that does not exist.

The engine's one write of order, `setRank`, which `session order` and the
index's drags reach, is the only thing that gives a worktree a rank. The one
write of membership, `setEpic`, takes the rank away with any change of epic, a
`join`, a `leave` or a drop into or out of an epic, but for a rename on the
index to a name no other epic has, which is the same epic under another name.
That holds for every worktree but a main one, a folder outside Git included; a
main worktree's rank orders its project, and no epic write touches it.

The index places a worktree through `POST /api/worktrees/order {path, before,
after}`, every worktree by its path, as the epic route takes them. `before`
names the ranked sibling it goes in front of, or is `null`. `after` names the
unranked siblings drawn above the place it was dropped, in their drawn order:
they are ranked first, at the end of the ranked ones, and the worktree right
after them, so it lands where it was dropped, and only those ranks and the
renumbering they need are written. A placement names one or the other; with
neither, the worktree goes last among the ranked ones. It is the same write,
and the daemon makes one write of an epic or a rank at a time, answered with the
rank the worktree holds now. It refuses, with 404, a path the daemon does not
track or whose session has gone, and so a main worktree with no session, which
is never tracked; with 409 a `before` or an `after` that is not a sibling, the
worktree itself and one the daemon does not track included, an `after` sibling
that is ranked by now, ranks that changed since they were read, and a worktree
in no epic that is not a main one; and with 400 a placement naming both. Like
the epic route it converges nothing, and the watch on each session it writes is
what tells the index.

## Set up

Nothing has to be set up. A command that touches the records creates the session
first: `.session`, the five stage directories, `meta/`, and the `.gitignore`
when they are missing. `check` only reads what is on disk.

`init` does that scaffolding and nothing else. It prints each action it took, or
that there was nothing to do, and it exists so a new session can be handed
straight to an editor. Nothing depends on it having been run.

The CLI never migrates. A `.session` that is a symlink to something that exists
is refused by every command, with the fix in the message: replace the link with
a real directory, then retry. A dangling link points at nothing, so scaffolding
replaces it with the real directory. A stage kept under another name, such as
`TRIAGE/` from before the stages were numbered, is refused the same way, with
its rename to `1-Triage/` as the fix, and so is one found beside `1-Triage/`,
with the fix to move what it holds into it and delete it: a load never reads
past it, since its items would be missing from every reader, and scaffolding
never writes beside it, since that would split the stage in two. Nothing is
written, and the daemon answers that worktree's board and index row with the
same sentence until it is fixed. Scaffolding creates only what nothing holds: a
file, or a link that leads nowhere, under a stage's name or `meta` is named by
the next load or `check`, such as `3-Batch must be a directory; …`, rather than
written over. A leftover `TRIAGE.md` from the single-file layout is reported by
`check`, which names the file and says to fold it into `1-Triage/` by hand. Old
sessions are converted by hand, the existing ones by one-off sweeps; the session
repository's `scripts/rename-stage-directories.ts` renames the five stage
directories of every session named on its command line, a worktree or its
`.session`, and leaves everything else as it is:

```sh
bun scripts/rename-stage-directories.ts <worktree or .session> ...
```

It refuses a session where a stage's new directory is already there beside its
old one and renames nothing in it, because merging the two is a person's call.
It skips a linked `.session` and a path without one, prints a line for each
session and a count, and exits 1 when it refused or failed any. A stage already
renamed is left alone, so running it again after a fix renames only what is
left.

`check` converges nothing: it reads what is on disk and names the fix for what it
finds, such as that leftover file or a missing `.gitignore` that the next command
will write. When the session is sound it prints one line, the revision and the
item count, or `empty` when no stage holds an item; that line answers whether
everything is done. No command creates `RULES.md`; standing rules are written
from the user's words when the user states them, and the inventory reports the
file like any other. `ledger/` appears with its first entry, and `context/`
when an agent first writes there. `meta/` is scaffolded empty; `session join`
and `session order` write its two facts, and a session without either is
sound.

## Read the brief

`brief` prints what an agent reads before it acts, in the order it reads it,
and nothing it would have to open an item for:

- the line `check` prints, such as `OK <revision>, <n> items`, or `check`'s
  first error in its place;
- `RULES.md` as it is written, under `RULES.md:`, when the session's root lists
  one, or in its place the sentence saying why it could not be read, such as a
  link that leads out of the session;
- the ten newest ledger entries under `Ledger, newest first:`, each the name of
  its file without `.md`, as `log` names the entry it writes, then how many
  older ones `ledger/` holds, such as `and 4 older in ledger/`, and the
  listing's notice for any file it leaves out;
- the items under `Items:`, as `ls` lists them.

A part with nothing to show is left out, and a blank line comes between the
others:

```
OK 49741b205065c15f6e603cd2519c8b6940408090402891d348318a00ed6b1689, 3 items

RULES.md:
# Rules

- Jason stages and commits.

Ledger, newest first:
2026-09-26 16-17-30Z — The index is a stack of projects
2026-09-26 15-02-11Z — Pivot to per-item evidence

Items:
SES-1  1-Triage/010-SES-1.md                   Candidate one
SES-4  3-Batch/010-SES-4.md                    Waiting work
SES-3  5-Execute/010-First batch/010-SES-3.md  Settled work
```

It only reads, as `check` does: nothing is scaffolded and no daemon hears of
it, so loading the skill where there is no session leaves none behind. It exits
0 whatever it finds, because the skill runs it as it loads, and a command that
fails there stops the skill from loading. In a broken session the first line is
`check`'s error and the rest is what can still be read: `RULES.md` and the
ledger, which no stage holds, and the items whenever the stages load, as they
do when what `check` refuses lies outside them, such as a stray file at the
root. Where there is no session it prints one line,
`No session: <path> does not exist.` A `.session` that is a link is refused
with the sentence every command gives, and nothing is read through it. A
mistake in the command itself, such as an operand, is a usage error like any
other and exits 1.

The first line's revision is the one `check` prints and every write checks, so
a later `check` whose revision differs means an item file changed since. It is
not what `refresh --previous` takes, which is an earlier refresh's output saved
to a file: the brief is where an agent starts, and a refresh is how it follows
what changes after.

The skill loads the brief itself, with the line
`` !`session -C "${CLAUDE_PROJECT_DIR}" brief` `` in `SKILL.md`. Whenever the
skill is invoked, typed as a command or chosen by the model, Claude Code runs
the line and puts what it prints where the line was before the model reads the
skill. It first writes the project's directory in place of
`${CLAUDE_PROJECT_DIR}`, so the brief is of the directory Claude Code started
in wherever its shell has moved since, and it writes the session's own id
wherever the skill says `${CLAUDE_SESSION_ID}` the same way. A command there
that fails stops the skill with `Shell command failed for pattern …`, and
nothing of the skill reaches the model. A brief past the Bash tool's inline
ceiling, roughly 30,000 characters by default, reaches the model as its first
2,000 characters and the path of a file holding the rest, which the skill says
to read whole. Nothing in the brief is capped, so a long `RULES.md` or a few
hundred items make one that long.

Claude Code never asks about a command in a skill. It checks the line against
the permission rules, and outside auto mode anything short of an allow stops
the skill with `Shell command permission check failed for pattern …`, a rule
that would ask included. The skill's frontmatter declares
`allowed-tools: Bash(session *)`, which Claude Code applies whenever the skill
is invoked, so the line passes that check with no rule in any settings. The
grant lasts for the turn that invoked the skill, in which any `session` command
runs without asking, and clears with the next message. A settings rule is
needed only where a harness ignores the frontmatter: there, `session` must be
allowed for the brief to load, as `"Bash(session *)"` in `permissions.allow`
of `~/.claude/settings.json` allows it, or a rule that allows all of `Bash`.

Codex reads `SKILL.md` as it is written and runs nothing in it, so a Codex
agent sees the line as a command, and the sentence above it says to run
`session brief` itself. The `$CODEX_THREAD_ID` the skill names a Codex agent by
is the variable Codex sets in its shell to the thread's id.

## Refresh context

`refresh` returns a JSON path/hash inventory and added, changed, and deleted
paths. It does not return file contents. The brief is what an agent reads
first, and a refresh is how it follows what changes after: the first refresh is
the inventory later ones are compared with, and on each later turn the agent
reads only the changed relevant files; a new ledger entry arrives as an added
path, which is how agents in one session hear from each other. A refresh
without `--previous` lists every path as added, so in the first one only the
ledger entries newer than the brief's newest are new. Preserve the inventory in
conversation context. For a deterministic comparison, pass a previous refresh
output saved outside the session directory:

```sh
session refresh --previous /tmp/session-previous.json
```

The root's `ignore/` and `archive/` are excluded before traversal, and those
two only: `archive` and `ignore` are names of the root, and a directory of
either name further down, such as `context/SES-1/archive/`, is read like any
other, and listed on the board's context page alike. The inventory does not make
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
state is `~/.local/state/session/daemon.json`, the worktrees it tracks, which
the next daemon tracks again. It logs beside that file, in `daemon.log`. `open`
reuses a daemon that answers with a stamp matching the sources on disk. It
replaces one started from other sources, stopping the old process first, and
starts one when nothing answers, so a rebuilt board reaches every worktree at
the next `open`. A daemon is known by what answers on the port and by nothing
else: one that does not answer has exited or is still starting, so no pid is
kept to be signalled later, when it may belong to another process. A foreign
process holding the port is an error naming it; there is no fallback port.

`session daemon status` says what answers on the port and changes nothing:
`Running:` with the daemon's pid, port and start time, then `Current:` when it
was started from the sources on disk or `Stale:` with both stamps when it was
not; `Not running:` when nothing listens; or that the port is held by a process
that does not answer as the daemon. It ends with the log's path whichever it
is. `session daemon restart` stops the daemon and starts one from the sources
on disk whether or not it was current, and prints the pid it stopped, when one
answered, and the one it started, which makes it the way to replace a daemon
without opening a board. No other command restarts it: a stale daemon keeps
serving until `open` or `restart` replaces it, so a command about the records
never drops the boards' streams or fails on a build that does not start. Both
read `SESSION_PORT` and `SESSION_STATE_DIR` as `open` does and ignore `-C`,
since the daemon is the user's and not a worktree's.

The daemon starts with the environment of the command that started it, less
what Claude Code, Codex, cmux and Git set for the processes they run, because
it outlives them and passes its environment to every gh, linear, claude, codex
and cmux it runs. It drops Claude Code's `CLAUDE*` and `AI_AGENT`, keeping
`CLAUDE_CONFIG_DIR`, from which Claude Code reads its settings again; what Codex
sets for the commands it runs, its session, thread, version, sandbox,
permission profile, network proxy and install method, keeping its settings such
as `CODEX_HOME`; `ANTHROPIC*`; cmux's `CMUX_*`, keeping `CMUX_SOCKET_PASSWORD`
and `CMUX_SOCKET_CAPABILITY`, with which a process outside cmux reaches its
socket; and the repository variables Git sets for its hooks, the ones
`git rev-parse --local-env-vars` lists. `NODE_OPTIONS` returns to the user's
own value where cmux replaced it to launch Claude Code. PATH loses the
`node_modules/.bin` of the command's directory and of the directories above it,
which a package runner puts first, so a repository's own copy of a tool never
stands in for the user's. The daemon is handed the port and state directory the
command resolved, so a relative `SESSION_STATE_DIR` means one directory to both.

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
soon as its session is gone: a watch on each directory that holds tracked
worktrees re-asks whether their `.session` is still a real directory on every
change there, since on macOS a watch on a directory that is removed hears
nothing at all, and every read of the index re-asks it for all of them; the
first `no` drops the row, rewrites the state file and pushes a `worktrees` event
to every open index. A change under a tracked worktree's `.session` that a row
shows, an item file, `meta/epic` or `meta/rank`, pushes `worktrees` as well,
once the writes of every worktree have settled for half a second, and at least
every two seconds while they keep coming, so a `join` or an `order` in a
terminal, or an agent moving items, reaches an open index at once; a change
under `context/`,
`ledger/`, `archive/` or `ignore/` pushes nothing, since the index shows nothing
of it. `POST /api/worktrees/refresh` remains as the route the CLI registers
through.

The index at `/` draws the tracked worktrees as a stack of sections, one per
project, rather than as a table, under a header that holds only the settings
icon, at its far end. It has no heading: the browser's tab names it Worktrees,
and every head and card says what it is and how it moves from where it is, in
the tips of the marks before a name, of an epic's heading, of a head's badge and
of whatever is dim, so nothing needs a page-wide sentence. A project is a
repository, or a folder outside Git, which is a project of its own. A repository
is what Git names for every worktree of it: the worktrees that share one Git
directory, named by what Git lists first for it, its main worktree. Every row
the daemon serves carries its repository, the name and path of what Git lists
first and what the listing says is checked out there, from the same `git
worktree list` as the row's own branch. Nothing about a repository is stored:
when Git cannot list one, its rows are Not served, with the reason, and keep
their section, named by the main worktree Git listed when each was taken on,
which the daemon holds for as long as it tracks the row.

A section is headed by what heads its project, drawn as the constant it is and
never dragged over the project's cards; a main worktree's head, while it has a
session, is what places its section among the others, as below. A repository's
main worktree with a session is its row, a
worktree's two lines with a house before its name, since a main worktree is
never in an epic. A main worktree with no session heads its repository all the
same, so that its worktrees have a home: by its name and branch as Git lists
them, marked Not tracked, with no glyph, no link, no actions and no agents,
since there is no session there to show and the daemon opens and lists nothing
for a worktree it does not track; when Git cannot list the repository, this head
says so where its branch would be. A repository Git lists by its Git directory,
where a main worktree would be, is headed by that directory's name alone, marked
Git directory, with no branch: Git marks a bare repository's so, and lists the
Git directory of a submodule, or a separate one, in the main worktree's place,
and none of them is a worktree or holds a session. A folder outside Git is
headed by its name, marked Outside Git. Two sections that would carry the same
name carry each its parent folder's name before it, as a linked worktree is
named whose folder shares its main worktree's name. Below its head a section
holds the project's cards: a card per epic whose worktrees all belong to it,
headed by the epic's name, how many worktrees are in it and an icon that renames
it, with its worktrees inside, and a card of its own for each of its worktrees
in no epic. An epic whose worktrees belong to more than one project is drawn
once, in a section of its own, Across projects, since it is the one thing higher
than a project, and a project whose worktrees are all in such epics is its head
alone. So every worktree the index lists is drawn once: as a head, in an epic's
card, or as a card of its own.

The sections whose main worktree was placed by hand come first, in the order of
their ranks, and keep their places when they go quiet, dim but not last. The
rest are ordered as the cards in them are, by what is happening in them, the
one across projects among them: a section with a live agent first, live as a
pill counts it, then the newest activity first, and a section with nothing live
and nothing in five days is drawn dim and last, its head or heading saying so
in its tip. A project is as busy as every worktree of it, wherever that
worktree is drawn, in an epic across projects included, and the section across
projects as busy as the worktrees in its epics. The cards in a section follow
the same order: a card with a live agent first, then the newest activity, and a
card with nothing live and nothing in five days dim and last. The worktrees in
an epic's card stand the same way as the sections: the ones placed by hand
first, in the order of their ranks, then the rest by what is happening in each,
and a name settles a tie. Nothing stores a section or a fold, and the one order
stored is each worktree's rank, in its own `meta/rank`; every read draws the
rest again. Each section's
cards stand in columns as wide as a card needs, the same columns in every
section, and where the browser lays grid items out as masonry, with `display:
grid-lanes` or `grid-template-rows: masonry`, each card packs up under the one
above it; elsewhere each starts at the top of its row. No script lays them out.

A worktree is two lines wherever it is drawn, beside the glyph of what its
session holds at its top left: a folder and its name, a terminal icon and a Zed
icon, and a pill per live agent, then a branch mark and its branch and the pull
request gh reports for it. The marks are the worktree picker's, a folder, a
branch, and a commit in place of the branch for a detached HEAD, so a name and a
branch are told apart wherever a worktree is drawn. The folder's tip says what
the worktree is here: on the page while it has a session, at the head of its
repository, in an epic or in none, under its repository or its own head outside
Git, and where it can be dropped. A name stands without its path, which is its tip:
the name already tells the worktrees apart, since one whose folder shares the
main checkout's name carries its parent folder's name before it. A worktree with
a commit checked out rather than a branch reads `Detached HEAD` where the branch
would be, and a folder outside Git reads `No branch`. What every row has checked
out comes from one `git worktree list` per repository, run in the Git directory
the repository's worktrees share, rather than from Git asked once per row. The
pull request is the chip a board's header carries, or gh's sentence in its
place, and a branch with no pull request, like a repository with no remote on
GitHub, shows none. The glyph says what the session holds in place of words: one
small bar per stage in the flow's order, Triage to Execute, and no total beside
it. Every glyph on the page is measured against one range, the fewest and the
most items any stage drawn on the page holds, so a bar's height is the same
count on every card: the fewest sits at the baseline and the most is full
height, which with an empty stage anywhere is a count's share of the page's
largest. An empty stage is a dim stub at the baseline, and when every stage on
the page holds the same number every bar is drawn there. The range is read from
the rows each time the page draws them and kept nowhere, and a row the daemon
does not serve draws no glyph and counts for none of it. The Execute bar takes
the accent while a batch runs there, and the tip names each stage with its
count, the batch under way, which is where a batch is named, and the total. Each
board sits under `/w/<key>/`, where the key is the worktree name, `Heartbeat` or
`email-backend/Heartbeat`. Two tracked worktrees whose names collide are a
conflict: the later one is listed with a reason that names both folders, and is
not served until the first one leaves. A row the daemon does not serve, for such
a conflict or for a session or a Git it cannot read, reads Not served with the
reason in place of its second line and has no link to its board; it stays in its
epic's card while its file names one. A `meta/epic` the rules reject puts its
worktree in no epic and says why on the second line, in the sentence `check`
gives, and the row is served as ever: the file is about the index, not the work.

The cards change their epics by drag, and the heads and the worktrees in an epic
their order. A worktree is held by its row, a whole epic by its heading, and a
project by its head; the pointer carries a copy of what is held while the card
itself stays in place, faint, and the copy says above it what dropping it there
would do, `Join "Back burner"`, `Merge into "Back burner"`, `New epic with
alpha-two` or `Leave "Back burner"`, and nothing when the drop would change
nothing; the card it would land in is outlined. A place among siblings is drawn
as a dashed line where the held thing would go instead, and its words say where
it would stand, `Before alpha-two`, `After Heartbeat` or `First`. Where the
pointer is decides the drop. A worktree dropped onto an epic's card joins it,
and so do all of a whole epic's worktrees. A worktree dropped onto another
worktree's card in no epic makes an epic of the two, named in the dialog groups
and batches are named in, which starts empty and makes nothing without a name.
While a worktree is held, from a card of its own or out of an epic, a `+` is
drawn after its project's cards, and only then, since it can do nothing
otherwise, and there, since an epic of one worktree stands with its project; its
tip is `New epic of <name>`, and so are the words over the held copy. A worktree
dropped on it opens the same dialog and makes an epic of that one worktree, or
puts it in the epic that already has the name given, and no name makes nothing.
A worktree dragged out of its epic onto the space between and below the cards,
the heads included, leaves it and becomes a card of its own in its project's
section, whichever section it was dropped in. Escape puts it back. Every drop
works across projects as it does within one, and where the epic stands follows
from whose worktrees it holds: a worktree dropped onto a card or an epic of
another project makes or joins an epic that moves to the section across
projects; a worktree that leaves such an epic goes back to its project, and the
epic, once what it holds belongs to one project, goes into that project's
section. The rename icon opens the same dialog with the epic's name in it and
moves every worktree in the epic to the new name. A name no epic has is the same
epic under another name, so every worktree keeps its rank and the card its
order; a name another epic already has merges the two, and the worktrees that
arrive join it unranked, after its ranked ones, whose ranks are untouched. The
daemon tells which it is from the worktrees it tracks, through the rename route,
one request for the epic. A drop is written with the epic route, one request per
worktree, which is drawn where it lands at once and read again once it is
written; a refusal, such as a file changed since the index read it, shows above
the cards in the daemon's words. While a card is held, the index draws what it
drew when the card was picked up, its rows, pull requests and clock alike, so no
card moves under the pointer: a change it is told of meanwhile is read once the
card is let go, and a read already under way at pickup lands unseen until then.
While a drop is being written it holds its reads the same way, and then reads
once. Every worktree the index lists can be dragged into and out of epics but a
main one, a worktree it does not serve included, since the epic route takes a
path; a main one is held by its head, to place its project, served or not, since
the order route takes a path too. Each drop is written against the epic drawn
for every worktree when it was dropped, a new epic's worktrees through the
dialog as well, so one whose file was changed in the meantime is refused as
changed on disk, and the index reads again.

A project is held by its head only while a main worktree with a session heads
it, since no other head has a file of its own to keep a place in: a main
worktree with no session, a Git directory, a folder outside Git and the epics
across projects are never held, and stand after the projects placed by hand.
Held, a project goes before or after the section nearest the pointer, the gaps
between the sections included, by which half of it the pointer is in. A worktree
held within its own epic's card goes before or after the worktree of that epic
it is over, the same way, and first over the card's heading; over a row of
another epic's card it joins that epic, as over the card. It lands where it was
dropped. Over the ranked siblings it goes in front of the one it would be drawn
before; among the unranked ones, the siblings drawn above the place it was
dropped are ranked first, in their drawn order, and it right after them, so what
stood above it still does, and the siblings below it stay unranked. A section
that cannot hold a rank, one that no main worktree with a session heads, stands
after every ranked one, so a project dropped below one lands right after the
last section ranked before it; the line and the words show that place. Over the
place it already has, nothing is drawn and nothing written. A placement is
written with the order route, one request, since the engine ranks and renumbers
whatever it needs, and is drawn where it lands at once and read again once it is
written, as a drop into an epic is. A drop that puts a worktree in another epic,
or takes it out of one, removes its rank, as `join` and `leave` do; a rename
keeps every rank unless it merges, as above.

## Use the board

A board's header starts with "All worktrees", which links back to the index,
then the worktree picker with the terminal and Zed icons beside it, since both
open that worktree, then the branch's pull request, the Linear issues the
worktree names, an icon for the session's rules when it has `RULES.md`, which
opens it on the file page, and one icon apiece for its Ledger, Context and
Archive pages; the settings icon is at the far end. The picker is
where the worktree and its branch are named: the control shows the worktree's
name over the branch checked out in it, and opens a list of every worktree the
daemon serves, each as the same two lines, its name over its branch, cut short
rather than wrapped. Each line is marked with what it is: a folder for the
worktree, and a branch for the branch, or a commit when the worktree has a
detached HEAD. Typing in the list narrows it by name or branch, and
picking one opens that worktree's board. Until the index answers, and if it
never does, the name and branch are plain text. The page icons carry no count
and no age; each names its page as its tip. A non-Git folder uses its own
`.session` and has no branch, so it has no pull request and names no issue
either.

The settings icon, at the far end of the board's header, of every page's
trail, and of the index, opens the board's own settings. They are kept in the
browser's localStorage under `session.settings`, as the JSON an Effect Schema
writes, so they survive a reload and follow a change made in another tab of
the same address; they say only how the board draws, and nothing in them
reaches the daemon or the files. A setting missing from what is stored reads as
its default; a stored value the schema cannot read leaves the defaults
standing, and a write the browser refuses holds on the page until it reloads,
and the menu says so either way. The one setting is Tips, off by default. With
Tips on, every word and control says what it means when it is hovered or
focused: the sentences this reference calls a tooltip, or says are on hover,
are tips. With Tips off nothing comes up under the pointer, and a word that
only carried a tip is plain text. A title that reports what just happened,
such as a copy the clipboard refused, is not a tip and shows either way.

The pull request is one chip, and the chip is a link to it: its number, gh's
state word (`open`, `merged` or `closed`, and `draft` for an open draft), gh's
review decision when it gives one (`approved`, `changes requested`,
`review required`), and one glyph for the head commit's checks: a cross when any
failed, a dashed circle while any has not finished, a tick when all passed, and
none when gh reports no checks. The tooltip names gh's exact words, prints the
three counts, and says when gh was asked. The counts are taken from gh's
`statusCheckRollup`, every entry once: a check run passed when it completed with
`SUCCESS`, `NEUTRAL` or `SKIPPED` and failed when it completed any other way; a
commit status, such as a deployment's, carries only a state, and passed on
`SUCCESS` and failed on `FAILURE` or `ERROR`; anything else is pending. Nothing
on the chip has a colour. A branch with no pull request and a detached head
draw no chip. Any other way gh can fail, missing from the daemon's PATH, signed
out, or offline, reads "gh did not answer, so the pull request is not shown."
where the chip would be.

The Linear issues the worktree names are one chip after the pull request's,
however many there are. One issue's chip is a link to it that shows its
identifier, such as `HEA-5454`, and nothing else; the tooltip gives the issue's
title, its state in linear's own words, and when linear was asked. Several
issues share a chip that shows the first one named and how many more, such as
`HEA-5523 +3`, and opens a list of them all, each with its identifier, title
and state in linear's own words, under a line saying when linear was asked;
each opens its issue as a single chip does. The identifiers are read from the branch
name and from the pull request's title and body: anything written the way
Linear writes one, a team key of two or more letters and digits that starts with a letter, a hyphen, and a number
that does not start with 0, in any case, so `jason/hea-5454-upgrade` names
`HEA-5454`. They are uppercased and kept once each, in the order they are first
named. Each is asked for with `linear issue view <ID> --json` in the worktree,
so linear reads that worktree's own configuration, and an issue is shown only
when linear answers with it. An identifier linear cannot find draws
nothing, so a word that only looks like one, such as `to-400` in a branch name,
costs one ask and nothing else. Linear answers a moved issue's old identifier
with the issue under its new one, so two names for one issue show it once. A
worktree that names no identifier asks linear nothing. linear without an API
key reads "linear is not authenticated, so issues are not shown." where the
chip would be. linear missing from the daemon's PATH, offline, slower than
fifteen seconds, or answering any other way reads "linear did not answer, so
issues are not shown.", and when linear printed a reason, the daemon's log has
it. Either way no issue is drawn, because a partial list would read as the
whole one. When gh does not answer, only the branch is read.

Everything the board opens outside itself is opened once, except a Markdown
link whose address the URL parser rejects, which is left to the browser as a
plain link. A click on a chip
opens its pull request or issue in a tab named for its address, and a later
click brings that tab forward as it is, without reloading it, instead of
opening another; a tab is opened only when there is none. The name is found
from the board tab that opened it, so a board opened separately in a tab of
its own opens its own, and a middle click or a click with a modifier is left
to the browser, so a copy of the reader's own is always one gesture away. The
tab keeps the board as its opener, because Chrome loses the name of a tab that
has none as soon as it loads another site; that tab can therefore reach back to
the board's.

The daemon asks gh with `gh pr view` in the worktree, reading the branch with
`git branch --show-current` at the same moment, and asks linear about every
identifier that branch and gh's answer name, four at a time. It keeps only the
last answer of each, and gh's answer is one answer for the index and the
worktree's boards alike, each source dated by its own ask. gh's answer stands
while it is under a minute old and nothing has moved since it was asked, where
a move is another branch checked out in the worktree, or a push or fetch moving
the remote-tracking ref of the branch gh answered for; a fetch that moves only
the repository's other refs moves nothing. A board's read is served gh's answer
while it stands and asks again once it does not; the index's read,
`GET /api/pull-requests`, serves the last answer of every served row and leaves
the asking to the daemon. The issues are served while they were read from gh's
current answer, so linear is asked again whenever gh is, for a board and never
for the index. While a board of that worktree or the index is open, the daemon
also asks gh again once its answer is a minute old or at once after a move, and
with a board open it asks linear after each new answer of gh's; with neither
open it spawns nothing. An index that starts listening for `pull-requests`
starts an ask for every served row whose answer does not stand. The index's
asks take turns, four at a time, and one whose turn comes after every page that
wanted it has closed, or after a board has already asked, is dropped; a board's
own ask never waits behind them. A page's stream carries only the events that
page names, and an item page names only `changed`, so an open item page keeps
nothing asking. Every ask of gh, and every ask of linear read from gh's newest
answer, pushes a `links` event to that worktree's open boards, and every ask of
gh a `pull-requests` event to the open index. Each ask of gh is at least one
GitHub API request counted against the signed-in account's hourly limit, more
when gh pages a long list of checks, so an open index spends at least one a
minute for each Git worktree it serves. The pull request is the one gh reports
for the branch when it is asked, and nothing about it is inferred: no state is
concluded from a
timestamp, and no check outcome is one gh did not report. An issue is drawn
only once linear has confirmed it: the identifiers are read from the branch
and the pull request, and each is confirmed by linear before it is drawn.
Each ask costs one Linear API request per identifier, counted against the
key's hourly limit, and a request Linear refuses for that reads "linear did
not answer, so issues are not shown." The index shows no issues, which is why
it never asks linear.

The terminal icon, in the header and beside each name on the index, asks the
daemon for a terminal in that worktree with `POST /api/terminal`. The daemon
lists cmux's windows and each window's workspaces, and brings forward the
workspace working in that worktree: one whose directory is the worktree itself
first, else one inside it, where a directory belongs to the longest tracked
worktree holding it, as an agent's does. When the listing works and names
none, it runs `cmux <path>`, which opens a new workspace there, so asking again
brings back the workspace it opened rather than opening another. A listing that
fails is not an empty one: when cmux cannot list its windows, or one of them,
nothing opens and the line cmux printed shows beside the icon, unless
`cmux ping` fails too, which means cmux is not running, and then `cmux <path>`
starts it. When cmux refuses any step, its line shows beside the icon. The
icon is drawn only while `cmux` is on the daemon's PATH, which `GET /api/daemon`
reports as `terminal`, so a daemon started from a shell without cmux on its
PATH draws none.

The Zed icon beside it asks the daemon for Zed on that worktree with
`POST /api/zed`, and the daemon runs `zed --classic <path>`. `--classic`
decides the same whatever the user's `cli_default_open_behavior`:
- **Focus.** Zed brings forward the window one of whose projects has the
  worktree itself as a root.
- **New window.** A worktree no window has opens in a new window, never in
  another window's sidebar.
- **Parent folders.** A window on a folder that holds the worktree matches
  only while that project has not scanned the worktree as a folder yet, or
  excludes it from scanning.
- **Without the flag.** A CLI that no one can answer settles on the existing
  window, and Zed writes that choice into the user's settings and puts the
  worktree in the active window's sidebar.

The Zed CLI hands Zed its whole environment, and Zed gives it to the new
window's terminals, tasks and language servers in place of the one Zed would
load for the folder. So the daemon runs the CLI where Zed itself would look. It
starts the user's login shell from only what launchd gives every app. The shell
moves into the worktree, so its directory hooks such as direnv run; fish is
first given a prompt, which its hooks wait for. Then the shell becomes the CLI.

Afterwards the daemon brings forward, with `open -a`, the app that CLI lies
in, since a request that starts in a background process cannot count on Zed
reaching the front by itself. A worktree whose session has gone opens nothing,
in Zed or in cmux, and leaves the index. Zed would read a path that has gone as
a file, and open it in the active window.

When zed or `open` refuses, its line shows beside the icon. When Zed is not
running, it first restores its last session, so a worktree that was in it can
end up with a second window. The icon is drawn only while `zed` is on the
daemon's PATH, which `GET /api/daemon` reports as `zed`.

The board is a viewer with workflow actions. It shows the five lanes in stage
order and reads the item files directly; it never writes an item's content, and
there is no way to type a body or create an item in it. A card shows the start of
the item's first paragraph under its title, up to 180 characters, as a reader
of the Markdown sees it, without the marks around its words. Headings, code,
tables and HTML are not paragraphs and a footnote is not where a body starts,
so a body that opens with an example shows the paragraph after it, and a body
with no paragraph shows nothing more than the title. The item's id sits
under that, very dim until pointed at, and a click copies it. A card's title is a link
to that item's page at `/w/<key>/item/<ID>`, which reads its Markdown at a
reading width, shows the item's id and its path under the session, and above
its title the name of its group when it has one, labelled Batch in Queue and
Execute and Group elsewhere, and resolves
Markdown links inside the body against the session directory; the path copies
the absolute file, which is what a terminal beside the page can open. An id
with a dot in it, such as `BE-1.2`, has its page like any other: a path under
a board that is not one of its routes gets the app, dots and all, except an
unknown `/api/` path, which is an error, and a path ending in the name of one of
the app's own files, which is that file. It is an
ordinary link, so it opens in a tab like any other. The page carries the stage
control, which moves an item in one click and leaves you on the page in its new
stage. All five stages are always drawn, because together they show the shape
of the flow: a stage the item cannot reach is drawn very dim and says on hover
what is needed first. "Complete work" is there for an item in Execute, and
leaves you on the page with the item archived. Settle missing content with the
agent or in the editor. A code block on the page is a band across the window's
full width, its text starting where the prose starts, and a line longer than
the room to the right scrolls inside the band.

An item filed under `archive/`, by "Complete work", `done`, `archive` or a
commit's trailer, keeps its page. When no stage holds the id, the page reads
the record under `archive/` whose name carries it, the one filed on the latest
day when there are several, and shows the item as it was filed: "Archived" above the title with the state its name gives, `done`
or the stage it was filed from, and the day; the record's path under the
session; all five stages very dim, saying the item is archived; and the
record's text in the reader. The record is read before the page changes, so an
item filed while its page is open goes from its stage to the archive in one
step. An id that is in no stage and no record reads "No item <ID> in this
session.".

A relative link in an item's Markdown names a path under the session. A link to
a Markdown file opens it on the file page, below; a link to any other file, and
an image, resolve through the board's files route, `/w/<key>/files/<path>`, so
an image kept under `context/` shows in the body. Each link opens beside the
page, once, in a tab named for its address, as the header's chips do. The route
serves any regular file under the session: Markdown as Markdown, PNG, JPEG, GIF,
WebP and SVG images as images, and anything else as plain text. Nothing under
the root's `ignore/` is served, whether asked for by path or reached through a
link, and neither is anything that resolves outside the session; `archive/` is
served, and a directory named `ignore` further down is an ordinary one. What the
route serves never runs: it is sent sandboxed and is never sniffed into another
type.

Every lane draws its groups as they are filed: a group is a heading over its
cards, in its place in the lane's file order among the cards in no group. The
heading's tooltip says what a group is in that lane: candidates or work
gathered under one name in Triage and Design, a proposed batch in Batch, and a
batch in Queue and Execute. A card carries no checkbox until its lane is
choosing: "Group…" beside the heading of Triage, Design or Batch starts it, and
in Batch "Queue batch…" too. Only then do that lane's cards offer a checkbox,
the lane says "Choose the items for the group" or "for the batch" until one is
chosen, and "Cancel" stops it with nothing changed. With cards chosen, "Group
(n)" names them as a group of that lane in the dialog "Queue batch" uses; a
name the lane already has adds them to that group, as `group` does. "Queue
batch (n)" names them as a batch and appends it to Queue. Chosen items join the
group or the batch in the order the lane shows them. A group's heading in Batch offers
"Queue batch" too: the dialog starts from the group's name, and it queues
exactly that group's items, which takes the group with them. A group's heading
in Triage, Design or Batch offers "Ungroup", which takes its items out of the
group, each to the end of its lane, as `ungroup` does. A batch's heading in
Queue and Execute offers nothing, because a batch is composed in Batch and a
queued card leaves it only by leaving Queue. The Queue lane offers "Start next
batch" while there is a batch to start and Execute is empty. None of these is
ever drawn disabled with a reason: an empty choice and an occupied Execute
are already visible in the lanes themselves. Execute is frozen: its cards can
only be completed, which files them under `archive/`.

A card is dragged by its whole self, and picking it up moves nothing. While it
is held, the board draws it where the move would write it and outlines the list
it would land in: one group, or the lane's cards in no group. Held over a card,
it goes in front of that card while its own centre is above the card's centre
and right after it once below, whichever list either is in, and it follows as it
moves. Right after a card in no group it goes in front of whatever follows that
card, a group included, so it lands just where it is drawn. Held over a group's
heading or edge it joins the group, at its start over the group's top half and
at its end over the bottom half, and a group the drag has emptied is still there
to take it back until the drop. Held over the lane's heading it leaves any group
for the start of the lane, in front of its first entry, a group included, and
held over the space that runs on below the lane's last entry it leaves any group
for the end of the lane. So a card dropped among a group's cards joins that
group, one dropped among the lane's cards in no group leaves its group, and one
dropped in another lane lands in no group there unless it was dropped among one
of that lane's groups. `POST /api/move` carries that as `group`, the group it
lands in or `null`, and names the card or, for a card in no group, the group it
goes in front of. Nothing drops into Queue or Execute; a Queue card can be
reordered inside its own batch or dragged back to Batch, Design, or Triage, into
a group there or not. Escape puts the held card back, and so does a move the
engine refuses.

Beside the session, each board serves three read-only listings. `GET
/w/<key>/api/ledger` is the ledger's entries, newest first by date and then by
name, with a notice naming each file in `ledger/` that breaks the ledger's
rules and is left out. `GET /w/<key>/api/context` is every file and directory
under `context/`, depth first, each with when it was written, and a notice for
an entry left out, such as a link that resolves outside the session. It lists
what refresh reads there: a directory named `archive` or `ignore` under
`context/` is an ordinary one, and only a link into the root's `archive/` or
`ignore/` is left out. Names starting with a dot are left out as well.
`GET /w/<key>/api/archive` is the archive's records as their names give them,
the day, the item, the title and the state it left in, newest first; a name the
engine did not write is listed as it is.

The header's icons for those three listings open a page apiece, and a fourth
page renders one file, `RULES.md` among them from the header's rules icon. Each carries the trail All worktrees / worktree / page,
with the settings at its far end, reads at the item page's width, and follows
the files as the board does. The ledger page, `/w/<key>/ledger`, shows the
entries newest first as cards: the title, the age with the exact moment on
hover, the body in the item page's reader, and one small line of the entry's
other keys as `key: value`. The context page, `/w/<key>/context`, shows
`context/` as a tree, directories first and then by name. A directory starts
collapsed and shows how many entries it holds; a file shows when it was written,
copies its absolute path, and opens: a Markdown file on the file page, anything
else as it is on disk, once, in a tab of its own. The archive page,
`/w/<key>/archive`, lists the records newest first with the day, the id, the
title and the state, whose meaning is on hover; each opens on the file page, and
a name the engine did not write is listed as it is. The file page,
`/w/<key>/file/<path>`, renders one Markdown file of the session with the item
page's reader, Evidence collapsed and code at the window's width, under the
file's path as its trail and a copy of its absolute path; frontmatter at the top
of a file, such as a ledger entry's, shows as the block of keys it is. A
listing's notices stand above it, and an empty one reads "No entries.", "No
files." or "No records.". A session whose items cannot be read still shows these
pages, with the reason above them, because none of them reads the items.

The board follows the files, and so does every page under it. The daemon watches
that worktree's `.session` and pushes an event when anything under it changes,
`context/` and `ledger/` included, and the board refetches; it never polls.
Refetching pauses while a card is being dragged.

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

A row reads in one line and lines up with every other row: the session's name
first, then its harness, its word with its time, what is in its context when
that can be read, and its actions, as icon buttons in a column as wide as the
most actions any row has, right after what the row says about the session.

The name is the listing's `name`. Claude Code makes one from the folder for a
session nobody named, the folder in lower case and two hex digits,
`heartbeat-fc`, and the session's registry file, `sessions/<pid>.json` in Claude
Code's directory, records it as `nameSource: derived`. Such a name repeats the
folder and says nothing about the work, so it is drawn very dim; it is still
drawn, because it is what tells two sessions in one folder apart. A name given
with `/rename` or `--name` is recorded as `user` and drawn as it is, and any
other word the registry writes there is shown in the name's tip as it arrived.
The registry's word is the whole test: a name that only looks made up is not
second-guessed, and a session with no process has no registry file to say, so
its name is drawn as it is.

The word is the `status` of a live session, and for a resumable one the `state`
Claude Code last knew it in:

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

A live session's word carries its time in status, labeled for what it is, `busy
for 16 min`, because how long it has held is what decides whether to go to it.
It is the time since the registry file's `statusUpdatedAt`, which Claude Code
writes when the status changes, and the tip names that stamp and its file. No
other stamp stands in for it: the file's `updatedAt` moves on a rename as well.
A live session whose registry file cannot be read, and a resumable session,
show when they started instead, `started 3 d ago`. Every time carries the exact
moment.

What is in a live session's context is read from the tail of its transcript,
`projects/<key>/<session id>.jsonl` in Claude Code's directory, where the key is
the working directory with every character but a letter or a digit turned into
`-`, as Claude Code names it; past 200 characters Claude Code cuts the key and
adds a hash, so a long one is found by its cut name. The last 64 KB are read,
line-aligned, which holds the last reply for nearly every transcript whatever
its size, and the count is the last assistant line's `usage`: its input,
cache-creation and cache-read tokens, the count Claude Code's own status line
works from, taken from the last message pass when the usage lists passes. It
reads `128k in context`, and its tip carries the exact count, when the listing
it came from ran, when the line was written and the transcript's path. It is a
count and never a share, because neither the listing nor the line says how large
the window is. The lines Claude Code leaves out of its own count are passed over
here too, before anything else about them is read: one with no usage, one naming
the `<synthetic>` model, as an API error does, an unmetered one, and one that
opens with Claude Code's own canned text, an interruption, a refused or rejected
tool use, or "No response requested."; a count Claude Code writes as null counts
as none. A reply whose count cannot be read ends the search, so an older reply
never stands in for a newer one. A session whose transcript cannot be found or
read, or whose tail holds no reply, shows nothing there and no notice. The count
is read when the agents are listed and at no other time, since only the registry
and Codex's writer locks are watched and never a transcript: it is as of the
last listing, which a status change brings, so a turn that stays busy keeps the
count it was listed with beside a time in status that keeps growing. The
transcript's modification time is never read: hooks, progress and link entries
move it when nothing has been said.

On the strip each action is an icon, named for what it does as the button's
accessible name, with the sentence of what it does as its tip: a terminal for
"Focus terminal", an arrow out for "Open in Codex", a clock turning back for
"Copy resume command", and the copy mark for "Copy session id" and "Copy
thread id". A copy reports itself on its icon, a tick once taken and a cross
when the clipboard refused it. "Focus terminal" focuses the cmux tab holding
the session's process, and appears only when the process is in one; when cmux
refuses, the line cmux returned shows under the row. When there is no terminal
to focus, the chip offers "Copy resume command" instead, if the session has
one: `claude --resume <session id>` for an interactive session,
`claude attach <id>` for a background one. "Copy session id" is there whenever
the listing carries one. Names are never acted on: a name is not a handle.

A Codex row starts the same way, with the thread's name or, failing that, the
first line of its preview, as Codex lists them, then its origin, its word, and
how long ago it was last active; Codex records no context for a thread, so that
column is empty. "Open in Codex" hands `codex://threads/<id>` to the Codex app,
which is where the thread opens, so no tab is opened for it; it is always
available, because that id comes from the same listing being rendered, and
"Copy thread id" is there beside it. The word is
`open` when a live process holds the thread's writer lock, `not open` when the
locks were read and this thread was not among them, and `unknown` when they
could not be read at all. Only `not open` is resumable: it is the one answer
that carries "Copy resume command", because Codex refuses to resume a thread
that already has an active writer, and an `unknown` thread is never demoted as
if nothing held it.

On the index each worktree carries a pill per live session rather than a count:
its dot, its word with its time as the board's row writes it, `busy for 16 min`,
and its name, very dim when Claude Code made it, ordered as the board orders its
rows. A
pill opens the menu of that session's actions, which is the board's own list
rendered as a menu with each action's name written beside its icon, under a line
naming the session, its harness, what its word means, and its age. Copying keeps
the menu open and says what happened; focusing a terminal closes it, or keeps it
open showing the line cmux returned. Only live things are named here: a session
whose process is gone and a thread nothing holds are handles, not work under
way, and listing them would say something is happening where nothing is. They
are on that worktree's own board, which is where a reader has already chosen the
scope. A worktree with nothing live shows no pill, and notices are printed once
under the header rather than on every row.

The index orders its cards by activity, when the worktree last did anything: a
Claude Code session's status change, a Codex thread's update, or an item file
written, whichever is newest. What is happening now is the pills' answer, not
this one's. A worktree where none of the three has happened has no activity and
is quiet. A status time is when that status last changed and nothing more: it
dates activity, it is not a heartbeat, and an old one is an agent that has held
still rather than an agent that has gone.

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
A name is never a resume handle, which is why the command is there to copy. And
not every session has a terminal to focus; that is ordinary, not a fault.

A source that cannot be reached says so, in a sentence that carries the
consequence. "Claude Code did not answer, so its sessions are not listed" means
its listing could not be run or did not answer in time. "Codex is not installed,
so its threads are not listed" means `codex` could not be started or refused the
handshake, and "Codex did not answer in time, so its threads are not listed"
that it started and did not answer inside its budget. Each notice
stands for its own source, the other source and the rest of the board are
unaffected, and an empty strip reads "No agent sessions here" with the notices
beside it, so a failed listing never passes for an empty one. A machine running
no cmux is not a failure: those rows simply carry no "Focus terminal" action.

The `### Agent` line an executing agent writes into its item file, in
[records.md](records.md), stays a convention between agents. The board does not
read it, does not match it against the sessions it lists, and never writes it.

## Edit in your editor

The item files are ordinary Markdown, and the editor is where their content is
written. Edit them with the usual filesystem tools and run `check` afterward.
Preserve any unrelated edits. Prefer `mv`, `group` and `ungroup` to a hand move:
they validate the target stage, keep the group and batch rules, and renumber the
directories. A hand move must carry the whole record and remove its old file;
never leave duplicate IDs. Moving a file into or out of a group directory is a
hand move too, because the directory is the group.

`check` rejects malformed records, duplicate IDs, missing stage-specific
sections, `# ` headings inside item files, Queue or Execute items belonging to
no batch, a directory inside a group directory, a group name that is empty or
has surrounding spaces, two directories naming one group in a stage, entries
whose names break the numbering pattern, a missing `.gitignore`, a `.session`
that is a symlink, and a leftover stage file such as `TRIAGE.md`. It closes the
session root: any entry other than the five stage directories, `archive/`,
`ignore/`, `context/`, `ledger/`, `meta/`, `RULES.md`, `.gitignore` and names
starting with a dot is an error that names it and says to move it under
`context/` or delete it, or to rename it when only its case differs from one of
these. A directory that holds a stage under another name, bare as before the
stages were numbered (`TRIAGE/`), in another case, or behind a prefix that is
not its place (`2-Triage/`), is named with its rename to the stage's directory,
or, when that directory is there too, with the fix to move what it holds into it
and delete it. The directories must be directories, and `RULES.md` and
`.gitignore` files. It rejects a `meta` that is a link, and in `meta/` every
entry but the two facts the session defines, `epic`, which must be a regular
file of one line holding an epic's name, and `rank`, a regular file of one line
holding a non-negative integer, as [records.md](records.md#meta) has them; names
starting with a dot are outside the rule. In `ledger/` it rejects a directory, a
link, and a `ledger` that is itself a link, and an entry whose frontmatter is
missing `date`, `title` or `by`, carries any other key, holds anything but one
line of text per key or a value YAML reads differently from how it is written,
or has a `date` that is not a UTC instant to the second; whose name is not the
one its date and title give; or whose body, read the way the board renders it,
has a heading. It does not look inside `context/`. It does not judge acceptance
criteria or user approval. An empty stage is an empty directory. A directory in
a stage that holds nothing, or nothing but names starting with a dot, is no
group to `check` or to any other reader, whatever its name, and the next write
removes it; so one that an interrupted write leaves beside the entry that took
its prefix or its name fails nothing.

## App development

Development commands and binding design decisions live in the repository
[Project contracts](../../../README.md#project-contracts) and Development
section. Do not rebuild the app for each new session.
