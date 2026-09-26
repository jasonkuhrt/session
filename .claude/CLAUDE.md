# Session

Before editing this project, read and follow the durable
[Project contracts](../README.md#project-contracts). Preserve them unless Jason
explicitly changes them.

The workflow contract lives in `src/session/SKILL.md`. The five stage records —
Triage, Design, Batch, Queue, Execute — are the work record, and each stage is a
directory of numbered item files, named for its place in the flow and its name,
`1-Triage` to `5-Execute`; the app must not maintain a second task database or
lifecycle. The board is a viewer with workflow actions and never writes an
item's content. The ledger is the session's log: dated, immutable entries under
`ledger/`, written with `session log` or by hand; the engine never writes one of
its own, and the board only shows them.

Commands scaffold the session as they go, its `meta/` of per-worktree facts
included, so nothing depends on an imperative setup step, and the CLI never
migrates an old one: a stage kept under its old name, such as `TRIAGE/`, is
refused with its rename rather than scaffolded beside. One daemon serves every
tracked worktree's board. It is known by what answers on its port and by nothing
else, and only `session open` and `session daemon restart` replace it. It starts
with the environment of whatever started it, less what Claude Code, Codex, cmux
and Git set for the processes they run and the `node_modules/.bin` a package
runner put on PATH, because it outlives them and passes its environment to
everything it runs; the user's own settings stay.

The index's unit above the worktree is the epic: a name and the linked worktrees
whose sessions name it in `.session/meta/epic`, one line, and nothing else, so
it exists exactly while a worktree names it. A worktree is in at most one epic
and a main worktree in none. Membership changes only by a drag on the index, a
rename from an epic's heading, or `session join` and `session leave`, through
the engine's one write, `setEpic`, which the daemon's route reaches by a
worktree's path with the epic the index last read; nothing stores a fold, and a
hand-set order is a worktree's `meta/rank`, which `setRank` alone gives and any
change of epic other than a rename to a new name removes: a main's rank orders
its project among the projects, any other worktree's rank orders it within its
epic, ranked ones come first in their rank, and the rest sorts by standing. An
agent reaches an epic only through the worktree its working directory is in, and
no fact ties an agent to an epic. Each tracked worktree's `.session` watch also
feeds the index's `worktrees` event, settled, for every change a row shows.

The index is a stack of projects, each a repository, which is Git's rather than
the tool's, the worktrees sharing one Git directory, or a folder outside Git: a
section headed by the repository's main worktree whether or not that has a
session, by the Git directory's name when Git lists that in its place and the
daemon does not track the main, or by the folder's name, and holding the
project's epic cards and its worktrees in no epic; an epic whose worktrees span
projects is drawn once, in the section "Across projects". Every served row
carries its repository from the same `git worktree list` as its branch, nothing
stores a section, and every section, the one across projects included, is
ordered and dimmed as cards are, a project counting every worktree of it
wherever it is drawn.

A main worktree is the one whose Git directory is its repository's own, as `git
rev-parse` says when asked without the variables that aim Git at another
repository, never the one found at its own path in `git worktree list`: Git
lists a submodule's or a separate Git directory's main by that directory, and
such a main is resolved, tracked, kept out of epics and drawn at the head of its
repository's section like any other, under its own name, with its Git directory
in the tip. Only Git's refusal lets a tracked path go: a path Git could not
answer for stays in the state file, is named in the index's notices with Git's
line, and is asked about again at every take-on and rescan.

A `Session-Done: <ID>` trailer on a commit closes that item: the daemon watches
each tracked worktree's session, its reflog and the repository's remote-tracking
logs, and the engine files the named item as done from any stage, with the
commit's note written into the item's text. It reads only unpushed commits and
derives every pass from the history and the files, holding no state of its own;
the note travelling with the item is what keeps a restored one from being filed
again. Trailers it cannot act on are reported on their own event stream, never
dropped.

The daemon builds its services once, from only the ones it uses: Node's full set
includes a terminal, which hooks stdin every time it is built. Run server effects
on the daemon's runtime; never provide a Node layer per call.

The board carries a read-only agents overlay beside the records: the Claude Code
sessions Claude Code's own listing reports, grouped to worktrees by working
directory, and each worktree's newest interactive Codex threads, with chips that
focus a terminal, open a thread in Codex, or offer a resume command or an id to
copy. One list of actions serves both surfaces, the board's strip as icon
buttons closing each row, right after what it says about the session, and the
index's pills as menus, so neither can offer what the other does not. The
overlay is ordered by one concept: live things have a process behind them and
can need you now; resumable things are handles, they are never drawn as urgent,
and the index leaves them to the board. Every fact traces to a listing run at
render time, or to the two files read beside it, a live session's registry file
and the tail of its transcript, including the word for a session: the `status`
of a live one, the `state` something last knew a resumable one in, never a word
mapped into another. A session's name leads its row and is drawn very dim when
its registry file records it as the name Claude Code derived from the folder;
its status time is the registry's `statusUpdatedAt`, labeled for what it
measures, `busy for 16 min`; and its context is the count on the last reply in
the tail of its transcript, as of the last listing, never a share of a window no
source states, and nothing at all when the transcript cannot be read. Nothing is
inferred from a timestamp, a transcript's modification time is never read, no
Codex turn status is shown, no count is presented as all of a user's agents, and
a source that fails shows a named notice instead of an empty list.

The board's header and the pull request chips on the index's rows hold to the
overlay's rule: the pull request and Linear chips carry only what `gh` and
`linear` answered when the daemon last asked, each source dated in its tooltips
by its own ask, with a named notice in their place when a source cannot answer,
and the terminal and Zed actions ask `cmux` and `zed` when they are clicked and
show the tool's own line when it refuses. The daemon asks a source only for a
page that shows its answer: gh for the index or a board, linear for a board
alone, so an open index never spends Linear's limit.

Every rendered thing says what it means from where it is: a word carries its
sentence as a tip, a control says what it will do, and no surface needs a
document to read. Tips are shown only while the Tips setting is on, and it is
off by default, because a sentence under every passing pointer gets in the way
more than it helps; every tooltip and explanatory `title` goes through `Tip`,
`Explained` or `useTip`, so the one setting governs all of them, and the
settings menu says what each setting does in the menu itself. A control that
cannot act is not drawn, rather than drawn disabled with a reason, unless it
belongs to a fixed set that shows the shape of the flow, such as the five
stages on an item's page: then it is drawn very dim, with the reason as its
tip, because hiding it would make the reader remember the flow instead of
seeing it. An item's page stays with the item when it is archived, all five
stages dim. The overlay adds no state and no verb: the files remain the work,
the CLI is unchanged, and the `### Agent` convention in the records stays a
convention the board does not interpret.

Where data crosses a boundary, its shape is an Effect Schema and the code's
type for it is that schema's `Type`, never written by hand; this is an axiom,
not a best effort. The shared nouns live in `app/contract.ts` as schemas alone,
the client decodes every answer in `lib/api.ts`, each server source decodes
what it reads, a file, a listing, a tool's answer, a request, and the CLI
decodes what it reads and what `refresh --previous` is given; a parser of a
text format ends in a decode of the record it produced, and no `JSON.parse` or
`.json()` result is used undecoded. A hand-written type beside a schema is a
second truth and is removed.

The board's own settings are an Effect Schema kept in the browser's
localStorage through `KeyValueStore`: how the board draws, never the work, and
nothing in them reaches the daemon. A new setting is a field of the schema with
its default, which is all its storage needs, and an item in the settings menu
that says what it does.

Keep stage names identical in the stage directories, the CLI's output and the
UI: a directory is the stage's place in the flow, a hyphen and its name,
`2-Design`. The CLI also accepts a name in any case, and archive records keep
the lowercase state word. Design collaboration and focused explanations compose
through `design-together` and `show-me`.