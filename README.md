# Session

A file-based work board and agent skill: **Triage → Design → Batch → Queue →
Execute**.

The board shows the same Markdown files you open in your editor, and moves them
through the stages. Each item is one file and lives in one stage. Finished
designs wait in Batch, the batches you compose wait in Queue, and starting one
does not absorb new work that arrives later.

## Install

```sh
bun install
bun run build
bun run install:skill
```

Installation links the shared `session` skill into Codex and Claude, and links
`~/.local/bin/session` to this repository's `bin/session`, so `session` is a
command wherever `~/.local/bin` is on PATH.
The old burndown, workbench, and session-refresh entrypoints are moved out of
discovery into `~/.codex/retired-skills/`. An existing unrelated `session`
installation or binary is never overwritten. Re-running installation is safe.

## Use

Ask for `$session`, or run the CLI:

```sh
session open
session ls
session -C /absolute/path/to/worktree check
```

There is nothing to set up. A command that touches the records creates
`.session`, its five stage directories, `1-Triage` to `5-Execute`, its `meta/`,
and its `.gitignore` when they are missing; `check` only reads what is there.
`session init` does that scaffolding and nothing else, printing what it made,
for handing the directory to your editor. Every command defaults to the current
worktree; `-C` goes before the command to point at another one. The
[operations reference](src/session/references/operations.md) has every command.

`session open` starts one daemon for your user on `127.0.0.1:53045`, adds this
worktree to it, and opens its board. The index at the root has no heading, only
its tab's name, Worktrees, and every head and card says what it is in its own
tips. It shows every worktree the daemon knows as a stack of sections, one per
project, each a head that is never dragged over the project's cards: a card per
epic with its worktrees inside and a card of its own for each worktree in none.
A repository is headed by its main worktree, marked with a house; when that has
no session, by its name and branch as Git lists them, marked Not tracked, so its
worktrees still have a home; and when Git lists the repository by its Git
directory, a bare repository's or a submodule's, by that directory's name,
marked Git directory. A folder outside Git is a project of its own, headed by
its name, marked Outside Git. An epic whose worktrees belong to more than one
project is drawn once, in a section of its own, Across projects. A project
whose main worktree has a session is dragged by its head to place it in the
stack, and a worktree within its epic's card to place it there; what was placed
stands first, in the order it was placed, and keeps its place when it goes
quiet. The rest, sections and the cards in each alike, stand in one order: the
ones with a live agent first, then by their latest activity, and one with
nothing live and nothing in five days dim and last, a project counting every
worktree of it wherever it is drawn.
A worktree is two lines, marked as the worktree picker marks them: a folder and
its name with the agents live in it, over a branch and its branch, or a commit
for a detached HEAD, and the pull request gh reports for it. At its top left a
glyph shows how many items each stage holds, every glyph measured against the
fewest and the most any stage on the page holds, so a height means the same on
every card. Drag a worktree onto an epic to join it, onto a worktree in no epic
to make an epic of the two, from any project, onto the `+` that appears after
its project's cards while it is held to make an epic of it alone, or out of its
epic onto empty space to leave it and go back to its project; `session join
"<epic>"` and `session leave` do the same from a terminal, and `session order`
places a project or a worktree as a drag does. Each board sits under
`/w/<worktree name>/`. Activity is when the worktree last did anything: a Claude
Code session's status change, a Codex thread's update, or an item file written.
The index has no refresh button and needs none: any command that scaffolds a
session registers it with a running daemon, a change to a session's items or
epic reaches it as it is written, and a worktree whose `.session` goes away
drops off the index by itself. The daemon also finds the other worktrees of the
same repository that already have a `.session`.

`session daemon status` says whether the daemon is running and whether it was
started from the sources on disk, and `session daemon restart` starts it afresh
from them. Neither opens a board, so a restart is how a changed daemon replaces
the running one. The daemon leaves out of its environment what Claude Code,
Codex, cmux and Git set for the processes they run, since it outlives them.

If [portless](https://github.com/vercel-labs/portless) is on the machine, `open`
registers the daemon as its `session` alias, and while a portless proxy is
running the board is reached by name at `https://session.localhost/` rather than
by port. The address is read from portless's own state: its scheme is the one
the running proxy marked, and it carries a port unless that is the scheme's
default. When the alias cannot be used, `open` prints the daemon's own port and
says in one line why that is the address, so a proxy that has stopped is never
mistaken for one that is working. The port stays reachable either way.

A board reads that worktree's five stage directories and shows a Kanban board.
Each card is a link to its item's own page at `/w/<worktree name>/item/<ID>`,
which reads the Markdown at a reading width, with code blocks running the
window's full width, and carries the same workflow actions, so a long item is a
page you can link someone to rather than a panel. The page stays with its item
when it is finished or set aside, and shows it as archived.
The board is a viewer with workflow actions: move an item, compose a batch,
start the queued batch, complete an item. It follows the files as they
change, over a stream the daemon pushes, and pauses while a card is being
dragged. Every mutation checks the revision, so a stale tab cannot overwrite a
later edit on disk.

The board's header starts with "All worktrees" and the worktree picker, which
shows the worktree's name over the branch checked out in it, each line marked
with an icon for what it is, and switches to any other worktree's board. The gear at the top right of every page holds the
board's own settings, kept in this browser. Tips, off by default, makes every
word and control say what it means when it is hovered or focused.

The [skill](src/session/SKILL.md) owns the workflow and
[record format](src/session/references/records.md). The user's standing rules
for a session live in `RULES.md` at the session root and are read first. Next
comes `ledger/`, the session's shared log: one dated entry per file, written
with `session log` or by hand, for what another agent must know to act
correctly here and would not learn from the items. Material about one item
belongs under `context/<ID>/`, linked from that item's `### Evidence`. Facts
about the worktree's session live in `meta/`, one file each, in one line, and
there are two: `meta/epic` names the epic the worktree is in, and `meta/rank`
places it among its siblings on the index. Finished and abandoned items live
under `archive/`, one file each, and are not loaded as active context.

A commit can close items itself: end its message with a `Session-Done: <ID>`
trailer and the daemon files that item as done the moment the commit is made,
from whichever stage it is in, and writes the commit into the archived record.
Only commits no remote has yet are read, so a trailer that names a missing item,
or sits where Git does not read it as a trailer, is reported on that worktree's
board and index row while it can still be amended, and goes once it is fixed or
pushed.

## Agents on the board

Each board also shows the coding agents at work in that worktree, as a read-only
overlay: the Claude Code sessions that Claude Code's own listing reports,
grouped by their working directory, and the newest three interactive Codex
threads for that path, from the Desktop, an editor, or the CLI.

The concept that orders all of it is live against resumable. A live thing has a
process behind it: a Claude Code session with a pid, or a Codex thread an app
holds open, and only a live thing can need you now. A resumable thing is a
handle and the state something last knew it in; the only thing to do with one is
pick it back up. The board's strip lists both, live rows first and resumable
rows below them. Each row starts with the session's name, very dim when Claude
Code made it from the folder, then its harness, one word for how it is doing
with how long it has held it, `busy for 16 min`, how many tokens are in its
context when its transcript says, and last the ways to reach it as icon buttons:
focus its cmux tab, open the thread in Codex, or copy its resume command or its
id. The index names only what is live, a pill per session that opens that same
list as a menu; a worktree whose agents are all resumable shows none, and its
board is where they are. The listing is recomputed when the index renders and
when the Claude session registry or the Codex writer locks change, and every
open board is pushed the change.

Everything shown is read when the agents are listed, from the listings and the
files beside them: each live session's registry file, for when its status last
changed and where its name came from, and the tail of its transcript, for what
is in its context. Nothing watches a transcript, so the context count is as of
the last listing, which a status change brings. The board claims nothing
further: no liveness guessed from timestamps, no Codex turn status, and no count
that means all of your agents, because teammates, in-process subagents, bare and
cloud sessions never register. A source that cannot be reached names itself
instead of showing an empty list. The files stay the work; this is only a way to
reach the agents working on them. The
[operations reference](src/session/references/operations.md#agents-on-the-board)
has what each chip shows and what each action does.

## Editors

`.session` is a real directory at the worktree root, not a symlink, and it
ignores itself with a `.gitignore` of exactly `*`. Nothing in it is ever
committed, and editors open the files normally unless they skip gitignored
directories. The board never writes an item's content, so your editor is where
content is written.

Zed defers gitignored directories, so it needs one line of user settings:

```json
"file_scan_inclusions": [".env*", ".session/**"]
```

The glob is root-relative on purpose. A `**/` prefix would make every ignored
directory scannable.

## Project contracts

Markdown is the work record, and the files are the source of truth. The CLI and
the board are viewers and writers over them, never owners. The system must work
when you open `.session/` in a file manager and your editor and never run either
tool: nothing in the layout requires a process to be running or to have run,
every rule is checkable from the files alone, and every record is ordinary
Markdown. Every stage is a directory of numbered item files, and the numeric
prefix is card order. The stage directories are numbered by their place in the
flow, `1-Triage` to `5-Execute`, and the name after the hyphen is the stage's
name, written the same way in the files, the CLI and the board. The browser and
server read and move those files directly;
they must not add a second task database or hidden lifecycle state, and the
board never writes an item's content. The board's own settings are the one thing
kept outside the files: they live in the browser's localStorage, say only how
the board draws, and never reach the daemon. Moves preserve stable IDs and
record content. A revision check guards every mutation, and a mutation writes
its files before it deletes the ones it replaced.

The index's unit above the worktree is the epic, and its model is fixed. An epic
is a name and the linked worktrees whose sessions name it in `meta/epic`, and
nothing else: it has no stage, lifecycle, owner or note, nothing about it
accrues or asks for action, and it exists exactly while some worktree names it.
A worktree is in at most one epic, since one file holds one name, and a main
worktree is never in one: Git keeps the repository there, lists it first and
will not move, lock or remove it, and the index draws it at the head of its
repository's section. Above the epic the index draws the repository, which is
Git's rather than the tool's: the worktrees that share one Git directory, named
by what Git lists first for it, read from `git worktree list` whenever the index
reads its rows, and stored nowhere; when Git cannot list it, its name falls back
to the main worktree Git listed when the worktree was taken on, which the daemon
holds only while it tracks the worktree. A folder outside Git is a project of
its own. An epic whose worktrees all belong to one project is drawn in that
project's section, and one whose worktrees belong to more than one is drawn
once, in a section of its own ordered with the others. Membership changes by a
drag or a rename on the index, or by `session join` and `session leave`;
deleting a worktree takes its membership with it, nothing is pruned, no path is
stored, and nothing stores a fold. The one order stored is a worktree's rank
among its siblings, a number in its `meta/rank`: a main worktree's orders its
project among the projects, any other worktree's orders it among the worktrees
of its epic, and a change of epic removes it, but for a rename on the index to
a name no other epic has, which is the same epic under another name and keeps
every rank. Ranked siblings stand first, by rank, and the rest after them by
what is happening in them, so a placement, by a drag on the index or by
`session order`, ranks only the worktree placed and renumbers its siblings only
where there is no room between two. Everything else about a worktree is read
where it is kept: its session, `.session/`, which it has at most one of and
which puts it on the index; its branch, from `git worktree list`, and none when
detached; that branch's pull request, from `gh pr view`, taken as the one while
one is open; and the agents in it, by the working directory their harness
reports. An agent reaches an epic only through the
worktree it works in, and no fact ties an agent to an epic, because none could
be derived or verified. Linear issues are what the branch and the pull request
name, and are not modeled.

The app is desktop-only and uses stock shadcn components with Base UI and the
Nova neutral preset. It renders in its dark theme, which is Tokyo Night's night
variant, defined in `app/src/styles.css`. Keep that theme and the stock
component appearance. Card placement uses the native behavior of the
established sortable library. Keep custom code limited to the board, Markdown
workflow, and file boundary. Do not add separate mobile behavior, accessibility
work, or concurrent-edit coordination unless Jason changes this contract.

Production checks replace authored tests for this project. Do not add tests,
test dependencies, test scaffolding, or test pipelines unless Jason explicitly
changes that policy. Oxlint, React Doctor, and the Effect-enabled TypeScript
checker use the strictest applicable rules; every enabled diagnostic is an error,
and every exception is explicitly off with a comment explaining why. TypeScript
checks run in CI because they are intentionally kept off the local development
path. Future agents must preserve these contracts unless Jason explicitly
changes them; generic best-practice advice is not authorization to override them.

## Development

```sh
bun run lint
bun run doctor
bun run build
bun run check
bun run check:types # CI
```

`bun run check` runs lint, React Doctor, and the production build. CI also runs
`bun run check:types`. The app uses React, shadcn with Base UI, and an
Effect-backed file service. `app/contract.ts` is the shared wire contract; the
server and the CLI share one file engine, which owns the directory layout,
numbering, and validation.

`bun run dev` is `session open`, so it drives the same daemon as the installed
command, and `session daemon restart` from a checkout replaces that daemon with
one started from the checkout's sources. `SESSION_STATE_DIR` and `SESSION_PORT` override where the daemon keeps
its state and which port it listens on. They exist for verification and
development, so a scratch run leaves the real daemon alone. `bun app/server/daemon.ts`
runs the daemon in the foreground with its log on the terminal, which is the
form to use while changing it.
