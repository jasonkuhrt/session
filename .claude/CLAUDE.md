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
its own, and the board only shows them. A required section with nothing to hold
says so with the one word `None`, exactly so, alone on its line and all the
section holds: `app/stage-rules.ts` has the one reading of a required section,
as empty, none or content, which the engine, the board's moves, the item page
and a card's line share, so `None` passes wherever a section is required,
nothing reads it as content, and the item page draws it very dim with its
sentence as the tip; no other keyword exists.

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
and a main worktree in none. Membership changes only by Join an epic… and Leave
the epic, which run wherever a worktree is drawn, the index, its own board or
its row on an epic's or a project's board, by a drag on the index, by Rename the
epic… on the index or the epic's own board, or by `session join` and `session
leave`, through the engine's one write, `setEpic`, which the daemon's route
reaches by a worktree's path with the epic the index last read; nothing stores a
fold, and a hand-set order is a worktree's `meta/rank`, which `setRank` alone
gives and any change of epic other than a rename to a new name removes: a main's
rank orders its project among the projects, any other worktree's rank orders it
within its epic, ranked ones come first in their rank, and the rest sorts by
standing. An agent reaches an epic only through the worktree its working
directory is in, and no fact ties an agent to an epic. Each tracked worktree's
`.session` watch also feeds the index's `worktrees` event, settled, for every
change a row shows.

On a board, a card dropped on the middle of another card in no group of its own
lane makes a group of the two, named in the substrate's `NameMode` through
`askName`, in that card's place, and one dropped on a group's heading joins it
last; the held card says what the drop does to its group, the carries only move
cards from place to place, a group is made by key with Group the marks…, and the
board draws the session it drew at pickup until the drop lands, as the index
draws its rows.

The index is an outline of projects. Each is a repository, which is Git's rather
than the tool's, the worktrees sharing one Git directory, or a folder outside
Git. A project's row is headed by the repository's main worktree whether or not
that has a session, by the Git directory's name when Git lists that in its place
and the daemon does not track the main, or by the folder's own row. Under it
stand its epics with their worktrees, then its worktrees in no epic; an epic
whose worktrees span projects is drawn once, under "Across projects". A row is a
name, a stage glyph and marks, and every other fact is in the detail line. Every
served row carries its repository from the same `git worktree list` as its
branch, nothing stores a project's place, and every project, epic and row, those
across projects included, is ordered by its rank, then busiest first, and a
quiet one, with nothing live and nothing recent, is dim and last, a project
counting every worktree of it wherever it is drawn.

The board is the filtered union of sessions: `/w/<key>/` is one worktree's
board, `/e/<name>/` an epic's and `/p/<path>/` a project's, whose worktrees are
read from the rows `/api/worktrees` serves and stored nowhere. An epic's or a
project's board is a view of items: every lane holds each worktree's part under
its name, a worktree's parts stand in one row, each name opens that worktree's
own `/w/` board, every card is keyed by worktree and id for a drag and for the
keys alike, every write goes to that worktree's own board with its own revision,
a card released over another worktree's lanes writes nothing, a worktree's name
carries its marks as it does wherever it is drawn, its part of a lane is a node
of the worktree's scope so its commands run from its row, and its Linear issues
are asked for only on its own board. Such a page gates on the rows before it
mounts, and follows one stream at the root, whose `changed` is every tracked
session's, settled as `worktrees` is, and which only a page that names it
receives.

A main worktree is the one whose Git directory is its repository's own, as `git
rev-parse` says when asked without the variables that aim Git at another
repository, never the one found at its own path in `git worktree list`: Git
lists a submodule's or a separate Git directory's main by that directory, and
such a main is resolved, tracked, kept out of epics and drawn as its
repository's row like any other, under its own name, with its Git directory in
the tip. Only Git's refusal lets a tracked path go: a path Git could not answer
for stays in the state file, is a dim row at the index's end whose detail line
gives Git's line, and is asked about again at every take-on and rescan.

A `Session-Done: <ID>` trailer on a commit closes that item: the daemon watches
each tracked worktree's session, its reflog and the repository's remote-tracking
logs, and the engine files the named item as done from any stage, with the
commit's note written into the item's text. It reads only unpushed commits and
derives every pass from the history and the files, holding no state of its own;
the note travelling with the item is what keeps a restored one from being filed
again. Trailers it cannot act on are reported on their own event stream, never
dropped. A `Session-Done:` value is item ids separated by commas or spaces, and
a line is filed whole or not at all: a line with any word naming no item of the
session, open or archived, files nothing and is one problem naming the line and
those words.

The daemon builds its services once, from only the ones it uses: Node's full set
includes a terminal, which hooks stdin every time it is built. Run server effects
on the daemon's runtime; never provide a Node layer per call.

The board carries a read-only agents overlay beside the records: the Claude Code
sessions Claude Code's own listing reports, grouped to worktrees by working
directory, and each worktree's newest interactive Codex threads. Agents…, `a`,
on a worktree lists them, and choosing one lists its actions: focus a terminal,
open a thread in Codex, or copy a resume command or an id. It is one list of
actions for every agent wherever it is chosen. The overlay is ordered by one
concept: live things have a process behind them and can need you now; resumable
things are handles, never drawn as urgent. Live things are a dot on their
worktree wherever it is drawn and name themselves in its detail line, and only
Agents… lists the resumable ones. Every fact traces to a listing run at render
time, or to the two files read beside it, a live session's registry file and the
tail of its transcript, including the word for a session: the `status` of a live
one, the `state` something last knew a resumable one in, never a word mapped
into another. A session's name is drawn very dim in the detail line, and Agents…
says it is a name Claude Code made from the folder, when its registry file
records it as derived; its status time is the registry's `statusUpdatedAt`,
labeled for what it measures, `busy for 16 min`; and its context is the count on
the last reply in the tail of its transcript, as of the last listing, never a
share of a window no source states, and nothing at all when the transcript
cannot be read. Nothing is inferred from a timestamp, a transcript's
modification time is never read, no Codex turn status is shown, no count is
presented as all of a user's agents, and a source that fails shows a named
notice instead of an empty list.

A worktree's detail line, marks and commands hold to the overlay's rule. The
pull request fact and the Linear issue… list carry only what `gh` and `linear`
answered when the daemon last asked, each dated by its own ask, the fact in its
tip and the list in its prompt. When a source cannot answer, a dim `!` stands in
their place, with the source's named notice, dated by its ask, in the detail
line. The pull request's number is a mark coloured by its state and red while a
check fails. The Terminal and Editor commands ask `cmux` and `zed` when they run
and give the tool's own line in the detail line when it refuses. `e` on an item
opens `zed --classic <worktree> <file>:1`, a file inside that worktree's
`.session` only. The daemon asks a source only for a page that shows its answer:
gh for the index or any board, and linear for a worktree's board alone, so an
open index never spends Linear's limit.

Every rendered thing says what it means from where it is: a word carries its
sentence as a tip, a control says what it will do, and no surface needs a
document to read. Tips are shown only while the Tips setting is on, and it is
off by default, because a sentence under every passing pointer gets in the way
more than it helps; every tooltip and explanatory `title` goes through `Tip`,
`Explained` or `useTip`, so the one setting governs all of them, and the
settings say what each setting does beside it. The card a `@reference` to a term
opens shows the meaning the document's `Term | Meaning` table gives it, which is
the document's own content rather than a tip, so it shows whether or not Tips is
on and does not go through `Tip`. A control that cannot act is not drawn, rather
than drawn disabled with a reason, unless it belongs to a fixed set that shows
the shape of the flow, such as the five stages on an item's page: then it is
drawn very dim, as dim under the pointer as beside it, with the reason as its
tip, because hiding it would make the reader remember the flow instead of seeing
it. An item's page stays with the item when it is archived, all five stages dim.
The key map draws a command that cannot run at the focus dim, and the palette
lists only what can run. The overlay adds no state and no verb: the files remain
the work, the CLI is unchanged, and the `### Agent` convention in the records
stays a convention the board does not interpret.

Where data crosses a boundary, its shape is an Effect Schema and the code's type
for it is that schema's `Type`, never written by hand; this is an axiom, not a
best effort. The shared nouns live in `app/contract.ts` as schemas alone, the
client decodes every answer in `lib/api.ts`, each server source decodes what it
reads, a file, a listing, a tool's answer, a request, and the CLI decodes what
it reads and what `refresh --previous` is given; a parser of a text format ends
in a decode of the record it produced, and no `JSON.parse` or `.json()` result
is used undecoded. A hand-written type beside a schema is a second truth and is
removed. Every JSON answer and refusal goes out through `answer`, encoded
through its route's schema; a text parser's closing decode that fails is refused
where the file was read; and `bun run lint` refuses any type, interface, enum or
re-export in `app/contract.ts` that is not `typeof <Name>Schema.Type`, by the
rule in `scripts/lint/session.js`.

The board is TanStack Start in SPA mode: `bun run build` runs Vite on Bun and
prerenders one shell into `app/dist/client`, beside the one script and the one
stylesheet it names, and the daemon serves that shell, `no-store`, at every
page's address, while an unknown API path answers JSON 404 at the root as it
does under a board; no Start server code runs in the daemon, and nothing a route
module or the root route imports reads a browser global when it loads, since the
prerender loads them all. A page is a file route whose worktree key or project
path the router's rewrite folds into one segment; its params decode through
Effect Schemas, and params a schema rejects are no route, so the address draws
the not-found page; a board's page reads the daemon's description once, before
it mounts, an epic's or a project's page reads the index's rows the same way,
and a name or path no tracked worktree is in draws the not-found page, and a key
the description does not name draws the not-found page; the daemon answers an
unknown key's page load with the shell, anything else with JSON 404; moving
between pages stays in the document, a page being one component per address that
closes its stream and its dialogs as it leaves and reads again when it mounts.
Every read is a TanStack Query query, read when its page mounts and, where its
answer can change, again on the event that names it, one read per event since
the stream carries no payload; an epic's or a project's board reads its rows
again on `worktrees`, since they are its membership, and what the daemon says
about itself when a page mounts and when a stream comes back, a changed
`sourceStamp` reloading the page, drag and all. On the board and the index a
drag or a write holds the events it names until it ends, and the item page's
writes hold nothing; a write's answer lands only over reads that predate it.

Every command is an Effect Schema value in one registry, with an id, name,
scope, keys, clicks, summary and input. The registry is decoded when the app
loads, so a repeated id, a key twice in one scope, or a root key bound elsewhere
fails the build. TanStack Hotkeys binds the registry's keys in
`app/src/substrate/bind.ts` alone, which `session/hotkeys-in-binder` holds. The
substrate under `app/src/substrate/` holds no session noun and asks the app
through one seam. A key runs the nearest scope's command on the focus path. When
that command cannot run, the detail line says why, and the key never falls
through. The palette on `;` and the key map on `?` read the registry. A click on
a node puts the focus on it and runs the Enter the node binds itself, at once;
an opener names its destination once, in its runner's `to`, which its run and
the node's link both read, so a node whose Enter opens another of the board's
pages, and each step of the path line, is drawn as the app's link to that
address, which the app registers with the substrate through its `Register`
interface and draws with TanStack Router's `Link`, the substrate importing no
router; a click with a modifier or the middle button is then the browser's, and
a node that binds no Enter of its own, or holds other nodes, only takes the
focus. A key never acts in a field outside a mode or during a drag, takes the
browser's default only when it runs or refuses, and acts once when held, unless
it is a move.

The board's own settings are an Effect Schema kept in the browser's localStorage
through `KeyValueStore`: how the board draws, never the work, and nothing in
them reaches the daemon, and the focus lives in the address, replaced as it
moves within a view and pushed when the view changes, and each move brings the
focused node into view, which stands in for scroll restoration. A new setting is
a field of the schema with its default, which is all its storage needs, and a
line in the Settings command's dialog that says what it does.

React Doctor never checks an entry's exports. Its entries are the files
`tsconfig.json`'s `files` names, each one a command or tool starts from that no
file imports, and every script file a package script names, with all it imports.
So no package script names an app module or passes a tsconfig to `-p`:
`check:types` runs a bare `tsc`, and `dev` runs `bin/session open`.

Keep stage names identical in the stage directories, the CLI's output and the
UI: a directory is the stage's place in the flow, a hyphen and its name,
`2-Design`. The CLI also accepts a name in any case, and archive records keep
the lowercase state word. Design collaboration and focused explanations compose
through `design-together` and `show-me`.