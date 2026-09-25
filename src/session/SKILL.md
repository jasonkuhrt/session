---
name: session
description: Manage .session as the working record for Triage, Design, Batch, Queue, and Execute, and drive it with the session CLI, under the session's standing rules. Use when organizing session work, deciding, batching, queueing or executing items, briefing an agent or recording its output, refreshing context, maintaining the five stage records, RULES.md and the ledger, or opening the session board.
---

# Session

One item, one file, one meaning. The five stages are work states, not a mandatory
sequence; simple work can skip Design. The user owns priorities, acceptance,
batch composition, and when execution begins.

| Stage | Contains | Leaves when |
| --- | --- | --- |
| `Triage` | Candidates not yet accepted. | The user accepts, rejects, or redirects. |
| `Design` | Accepted work with open questions. | Outcome and acceptance are settled. |
| `Batch` | Settled work, a pool ready to batch, grouped or not. | The user composes it into a queued batch. |
| `Queue` | Named batches in order, composed, not started. | The user starts the first batch. |
| `Execute` | The one running batch. Frozen. | Each item completes, or the user changes the batch. |

Those are the stage names, in that order, in the files, the CLI, and the UI.
Each stage's directory is named for its place in the flow and its name,
`1-Triage` to `5-Execute`, and the CLI takes a name in any case, `design` or
`Design`.
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

Every stage is a directory of numbered item files, and the directories are
numbered too: `1-Triage/`, `2-Design/`, `3-Batch/`, `4-Queue/` and `5-Execute/`,
so a file tree lists them in flow order. One item is one file, and an empty
stage is an empty directory. Triage, Design, and Batch hold item files and
group directories side by side; a group directory is numbered like an item file,
named for its group, and holds that group's item files. Queue and Execute hold
one directory per batch with that batch's item files inside, so every item there
belongs to a batch.
[references/records.md](references/records.md) has the format.

The root is closed. Beside the five stages and the `.gitignore`, it holds only
`RULES.md`, `context/`, `ledger/`, `meta/`, `archive/`, and `ignore/`. `check`
reports anything else there by name, with its fix, and names starting with `.`
are outside the rule. `context/` is for agents: any file, in any layout, with no
lifecycle, and `check` does not look inside it. `ledger/` is the session's
shared log, described below. `meta/` holds facts about this worktree's session,
one file each: `epic`, below, is the one defined, and `check` reports anything
else in it. `archive/` and `ignore/` hold inactive history, outside agent
context.

Nothing has to be set up. A command that touches the records creates `.session`,
the five stage directories, `meta/`, and the `.gitignore` when they are missing;
`check` only reads what is on disk. `session init` does that scaffolding and
nothing else, printing what it created, for handing the directory to an editor.

The CLI never migrates an old session. A `.session` that is a symlink is refused
by every command, and so is a session with a stage kept under another name,
such as `TRIAGE/` from before the stages were numbered, even beside
`1-Triage/`: nothing reads past it or scaffolds beside it until it is renamed
or merged. A leftover `TRIAGE.md` is reported by `check`. Each names the fix.
Convert an old session by hand, or its stage directories with the session
repository's one-off `scripts/rename-stage-directories.ts`.

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

## Ledger

`ledger/` is the session's shared log: what another agent, or the user, must
know to act correctly in this session and would not learn from the items, such
as a design pivot, a batch abandoned, a rule learned, a decision taken outside
any item, or `RULES.md` changed. Routine progress is not an entry, and neither
is anything that needs the user, which is a stage move. An entry is never edited
or deleted; a mistake is corrected by a later one. The ledger is memory, not a
queue: nothing marks an entry read, and no entry waits for anyone.

Write an entry with `session log "<by>" "<title>"` and its body, if it has one,
on stdin. `<by>` is who is writing: `claude <session id>`, `codex <thread id>`,
or a person's name. The command reads the clock, adds the branch, commit, and
running batch it can observe, and writes one file named for the moment and the
title, such as `2026-09-23 14-02-11Z — Pivot to per-item evidence.md`: flat
frontmatter, then a body with no headings. An entry written by hand takes the
same form and the same keys, which
[references/records.md](references/records.md) defines. The engine writes no
entry of its own; moves and closes are already in the files and in Git.

On the first refresh, read `RULES.md`, then the ledger, then the stages. A later
refresh reports each new entry as an added path; read it, because that is how
agents sharing a session hear from each other.

## Epics

An epic gathers worktrees on the index: a name, and the linked worktrees whose
sessions name it in `meta/epic`, one line, and nothing else, so it has no stage,
lifecycle or owner and exists while a worktree names it. `session join
"<epic>"` puts the worktree in the epic of that name, creating it when no
worktree names it yet and taking the worktree out of any other, since it is in
one at most; `session leave` takes it out. A lead puts its workers' worktrees in
one epic with `-C`, one command each. A main worktree is never in an epic, and
`join` refuses it. An agent belongs to the worktree its working directory is
in, and to an epic only through that worktree, which the index shows it under,
so work from inside the worktree you are working on.

## Work with the files

Use the active worktree's `.session` directory. Never change checkouts just to
refresh context.

Use the `session` CLI for structure: adding, moving, composing a batch, starting
it, and completing an item. It owns placement, numbering, and validation. Write
content in an editor, in the item files themselves, and run `session check` after
hand edits. [references/operations.md](references/operations.md) has the
commands.

An item is its own brief: point an agent at the item it is to execute, and keep
what the item does not say under `context/<ID>/`, linked from its `### Evidence`.
The agent's output goes back to the item the same way, into `### Evidence` or
into files under `context/<ID>/` linked from there, so the item stays the one
place its outcome is read. Write into the records only what they need; scratch
work stays out of them. Anything that needs the user is a stage move: the item
goes into the lane where the user decides it, as a new card or a moved one,
because the lanes are where the user looks for it. Nothing in `context/`, the
ledger, or any other file asks for the user's attention.

Read [references/records.md](references/records.md) when creating, migrating, or
moving items. It defines the small stage-specific format and supporting folders.
Use stable IDs across stages. Do not infer authorization from an old filename,
confidence label, or another agent's suggestion; reconcile the conversation.

Before acting, refresh changed context with the CLI. Load `RULES.md` when it
exists, then the ledger, then the five stage records, and only relevant
supporting context. Keep the path/hash inventory in the conversation; read
changed files and avoid reloading unchanged material.
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

When a commit finishes an item, say so in the commit instead: end the message
with a `Session-Done: <ID>` trailer, in the last paragraph with any other
trailers, one per line or several ids separated by commas. The running daemon
files the item as done when the commit is made, from whatever stage it is in,
and writes the commit into the archived record. It reads only commits that no
remote has yet, so a trailer the board reports as not applied is fixed by
amending the commit before it is pushed. A commit that only moves an item along
carries no trailer.

## Board and validation

The board is a viewer with workflow actions. It shows the five lanes and it
moves, queues, starts, and completes items; it never writes an item's content.
One daemon serves the board of every worktree it knows, along with an index of
them, and each board follows the files as they change. Run `session open` only
when the user asks for the board. `session daemon status` says whether the
daemon is running from the sources on disk, and `session daemon restart`
replaces it without opening a board. The board also lists, read-only, the Claude Code
sessions and Codex threads under that worktree, which the operations reference
describes along with what that listing deliberately does not claim. For the app
and its file operations, read
[references/operations.md](references/operations.md). The UI owns no second copy
of work state. Do not recreate a per-task viewer, content module, or task
database.

A board's header shows the branch's pull request and the Linear issues that
the branch and the pull request name, as chips carrying only what gh and linear
answered, several issues sharing one chip that lists them, and the index carries
each worktree's pull request chip on its row. Beside the worktree picker sits a
terminal action that brings forward the worktree's cmux workspace or opens one,
and beside the chips an icon for `RULES.md`, when the session has one, and one
for each of the session's three pages. The chips and the terminal action open
their target once, bringing back the tab or the workspace already open rather
than opening another.

The pages sit beside the board, under its address `/w/<key>/`, where the key
names the worktree; they are read-only views of the files and follow them as
the board does. The ledger page, `/w/<key>/ledger`, shows the entries newest
first. The context page, `/w/<key>/context`, shows `context/` as a tree. The
archive page, `/w/<key>/archive`, lists the archive's records newest first, for
a person looking back rather than as context for an agent. The file page,
`/w/<key>/file/<path>`, renders one Markdown file of the session at the item
page's reading width. A Markdown file opens there from the context page, a
record from the archive page, and a linked Markdown file from an item, so each
has an address to send the user to. No page carries unread state or asks for
anything.

Validate after editing or migrating records. The checker proves structural
invariants, not that a design is sound or the user agreed. The agent still owns
those judgments. Keep explanations short, titles concrete, and detailed evidence
out of the first reading view.
