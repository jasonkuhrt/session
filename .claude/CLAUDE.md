# Session

Before editing this project, read and follow the durable
[Project contracts](../README.md#project-contracts). Preserve them unless Jason
explicitly changes them.

The workflow contract lives in `src/session/SKILL.md`. The five stage records —
TRIAGE, DESIGN, BATCH, QUEUE, EXECUTE — are the work record, and each stage is a
directory of numbered item files; the app must not maintain a second task
database or lifecycle. The board is a viewer with workflow actions and never
writes an item's content.

Keep stage names identical in files, CLI, and UI. Design collaboration and focused
explanations compose through `design-together` and `show-me`.
