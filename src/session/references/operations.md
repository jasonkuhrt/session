# Operations

Run the installed entrypoint with Bun. Pass the active worktree's `.session`
path; the file service resolves its symlink without changing the checkout.

```sh
bun ~/.codex/skills/session/scripts/session.ts init /absolute/path/to/.session
bun ~/.codex/skills/session/scripts/session.ts check /absolute/path/to/.session
bun ~/.codex/skills/session/scripts/session.ts refresh /absolute/path/to/.session
bun ~/.codex/skills/session/scripts/session.ts serve /absolute/path/to/.session --port 53045
```

`init` creates only missing stage files and preserves existing content. `serve`
also initializes missing files; `check` reports an incomplete setup.

## Refresh context

`refresh` returns a JSON path/hash inventory and added, changed, and deleted
paths. It does not return file contents. On the first refresh, read the four stage
files and relevant supporting context. On later turns, compare inventories and
read only changed relevant files. Preserve the inventory in conversation context.
For a deterministic comparison, pass a previous refresh output saved outside the
session directory:

```sh
bun ~/.codex/skills/session/scripts/session.ts refresh /absolute/path/to/.session --previous /tmp/session-previous.json
```

`ignore/` and `.runtime/` are excluded before traversal. The inventory does not
make linked history part of current context. Resolve deleted or moved references
instead of retaining an older item as if it were still live.

## Use the board

`serve` stays running and prints its local URL. Open that URL in the user's
browser or Codex panel. If the port is already serving this board and directory,
reuse it. Otherwise choose another port; do not stop an unknown process.

The board reads and writes the four files directly. Cards open an embedded
Markdown reader. Edit an item or a whole stage file, move accepted work to its
appropriate stage, select ready items in Batch, and start the selected batch.
Starting requires an empty Execute file. Completing an Execute item archives it
under `ignore/COMPLETED.md`.

The server rejects an outdated revision instead of overwriting newer disk edits.
Keep the draft visible, refresh the source, and reconcile it before retrying.
File moves use a recovery journal under `.runtime/`; do not remove that directory
to silence a recovery conflict. Inspect the reported conflicting files first.

Stage moves record decisions; they do not start an agent or grant new authority.
The agent continues execution from the user's request and the selected batch.

## Edit without the board

The format is ordinary Markdown. Edit it with the usual filesystem tools and run
`check` afterward. Preserve any unrelated edits. Cross-file moves must retain the
whole record and remove its old occurrence; never leave duplicate IDs.

`check` rejects malformed records, duplicate IDs, missing stage-specific sections,
and multiple execution groups. It does not judge acceptance criteria or user
approval. Empty stage files must be zero bytes.

## App development

In the installed skill's source repository, use `bun run build` for the frontend
and `bun test` for the file/API invariants. Installation and build instructions
live in the repository README. Do not rebuild the app for each new session.
