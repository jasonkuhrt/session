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

The board carries a read-only agents overlay beside the records: the Claude Code
sessions Claude Code's own listing reports, grouped to worktrees by working
directory, and each worktree's newest interactive Codex threads, with chips that
focus a terminal, open a recorded claude.ai link, open a thread in Codex, or
offer a resume command to copy. Every fact traces to a listing run at render
time. Nothing is inferred from a timestamp, no Codex turn status is shown, no
count is presented as all of a user's agents, and a source that fails shows a
named notice instead of an empty list. The overlay adds no state and no verb:
the files remain the work, the CLI is unchanged, and the `### Agent` convention
in the records stays a convention the board does not interpret.

Keep stage names identical in files, CLI, and UI. Design collaboration and focused
explanations compose through `design-together` and `show-me`.
