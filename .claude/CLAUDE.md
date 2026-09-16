# Session

Before editing this project, read and follow the durable
[Project contracts](../README.md#project-contracts). Preserve them unless Jason
explicitly changes them.

The workflow contract lives in `src/session/SKILL.md`. The five stage records —
TRIAGE, DESIGN, BATCH, QUEUE, EXECUTE — are the work record, and each stage is a
directory of numbered item files; the app must not maintain a second task
database or lifecycle. The board is a viewer with workflow actions and never
writes an item's content.

Commands scaffold the session as they go, so nothing depends on an imperative
setup step, and the CLI never migrates an old one. One daemon serves every
tracked worktree's board.

A `Session-Done: <ID>` trailer on a commit closes that item: the daemon follows
each tracked worktree's reflog and files the item as done from any stage, with
the commit written into its archived record. It reads only unpushed commits and
derives every pass from the history and the files, holding no state of its own;
the commit in the record is what keeps a restored item from being filed again.
Trailers it cannot act on are reported, never dropped.

The daemon runs every effect on one Node runtime. Providing the services per call
builds the terminal service each time, which hooks stdin, so do not provide
`NodeServices.layer` anywhere on the server; pass the daemon's runner instead.

The board carries a read-only agents overlay beside the records: the Claude Code
sessions Claude Code's own listing reports, grouped to worktrees by working
directory, and each worktree's newest interactive Codex threads, with chips that
focus a terminal, open a recorded claude.ai link, open a thread in Codex, or
offer a resume command or an id to copy. One list of actions serves both
surfaces, the board's strip as buttons and the index's pills as menus, so
neither can offer what the other does not. The overlay is ordered by one
concept: live things have a process behind them and can need you now; resumable
things are handles, they are never drawn as urgent, and the index leaves them to
the board. Every fact traces to a listing run at render time, including the word
for a session: the `status` of a live one, the `state` something last knew a
resumable one in, never a word mapped into another. Nothing is inferred from a
timestamp, no Codex turn status is shown, no count is presented as all of a
user's agents, and a source that fails shows a named notice instead of an empty
list.

Every rendered thing says what it means from where it is: a word carries its
sentence in a tooltip or a `title`, a control says what it will do, and no
surface needs a document to read. A control that cannot act is not drawn
disabled with a reason; it is not drawn. The overlay adds no state and no verb:
the files remain the work, the CLI is unchanged, and the `### Agent` convention
in the records stays a convention the board does not interpret.

Keep stage names identical in files, CLI, and UI. Design collaboration and focused
explanations compose through `design-together` and `show-me`.
