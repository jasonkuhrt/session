# Session

A file-based work board and agent skill: **Triage → Design → Batch → Execute**.

The board edits the same Markdown files you open in your editor. Each item lives
in one stage. Finished designs wait in Batch; starting a batch does not absorb
new work that arrives later.

## Install

```sh
bun install
bun run build
bun run install:skill
```

Installation links the shared `session` skill into Codex and Claude. The old
burndown, workbench, and session-refresh entrypoints are moved out of discovery
into `~/.codex/retired-skills/`. Existing unrelated `session` installations are
never overwritten. Re-running installation is safe.

## Use

Ask for `$session`, or launch the board directly:

```sh
bun run dev -- /absolute/path/to/.session --port 53045
```

The app binds to localhost. It reads the four stage files, shows a Kanban board
and Markdown reader, and supports editing, moves, batch selection, and completion.
Disk edits refresh the view. Mutations check the source revision so a stale tab
cannot overwrite a later file edit. A recoverable journal protects file moves.

The [skill](src/session/SKILL.md) owns the workflow and
[record format](src/session/references/records.md). Supporting evidence belongs
under `context/`; completed records live under `ignore/` and are not loaded as
active context.

## Development

```sh
bun test
bun run build
```

The app uses React, shadcn/Radix primitives, and an Effect-backed file service.
The browser has no separate task database. `app/contract.ts` is the shared wire
contract; the server and skill CLI share the file engine.
