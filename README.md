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
bun run dev -- /absolute/path/to/worktree --port 53045
```

The app finds `.session` at the worktree root and shows its Git branch and
worktree name. A shared `.session` symlink does not change that identity.

The app binds to localhost. It reads the four stage files, shows a Kanban board
and Markdown reader, and supports editing, moves, batch selection, and completion.
Disk edits refresh the view every five seconds while visible and when returning
to the tab. Refresh pauses during editing and dragging. Mutations check the source revision so a stale tab
cannot overwrite a later file edit. A recoverable journal protects file moves.

The [skill](src/session/SKILL.md) owns the workflow and
[record format](src/session/references/records.md). Supporting evidence belongs
under `context/`; completed records live under `ignore/` and are not loaded as
active context.

## Project contracts

Markdown is the work record. The browser and server read and update the four
stage files directly; they must not add a second task database or hidden
lifecycle state. File order is card order. Moves preserve stable IDs and record
content, while revision checks and the existing recovery journal protect writes.

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
server and skill CLI share the file engine.
