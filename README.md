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
`.session`, its five stage directories, and its `.gitignore` when they are
missing; `check` only reads what is there. `session init` does that scaffolding
and nothing else, printing what it made, for handing the directory to your
editor. Every command defaults to the current worktree; `-C` goes before the
command to point at another one. The
[operations reference](src/session/references/operations.md) has every command.

`session open` starts one daemon for your user on `127.0.0.1:53045`, adds this
worktree to it, and opens its board. The index at the root lists every worktree
the daemon knows, with its branch, running batch, item counts per stage, and last
change; each board sits under `/w/<worktree name>/`. The daemon also finds the
other worktrees of the same repository that already have a `.session`. When a [portless](https://github.com/vercel-labs/portless) proxy is running on
the machine, `open` registers the daemon as its `session` alias and the board
lives at `https://session.localhost/`; the raw port stays reachable.

A board reads that worktree's five stage directories and shows a Kanban board and
Markdown reader. It is a viewer with workflow actions: move an item, compose a
batch, start the queued batch, complete an item. It follows the files as they
change, over a stream the daemon pushes, and pauses while a card is being
dragged. Every mutation checks the revision, so a stale tab cannot overwrite a
later edit on disk.

The [skill](src/session/SKILL.md) owns the workflow and
[record format](src/session/references/records.md). The user's standing rules
for a session live in `RULES.md` at the session root and are read first;
supporting evidence belongs under `context/`; finished and abandoned items live
under `archive/`, one file each, and are not loaded as active context.

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
prefix is card order. The browser and server read and move those files directly;
they must not add a second task database or hidden lifecycle state, and the board
never writes an item's content. Moves preserve stable IDs and record content. A
revision check guards every mutation, and a mutation writes its files before it
deletes the ones it replaced.

The app is desktop-only and uses stock shadcn components with Base UI and the
Nova neutral preset. Keep the stock theme and component appearance. Card
placement uses the native behavior of the established sortable library. Keep
custom code limited to the board, Markdown workflow, and file boundary. Do not
add separate mobile behavior, accessibility work, or concurrent-edit
coordination unless Jason changes this contract.

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
command. `SESSION_STATE_DIR` and `SESSION_PORT` override where the daemon keeps
its state and which port it listens on. They exist for verification and
development, so a scratch run leaves the real daemon alone. `bun app/server/daemon.ts`
runs the daemon in the foreground with its log on the terminal, which is the
form to use while changing it.
