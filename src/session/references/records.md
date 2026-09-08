# Records

The root has four stage files. Supporting context lives in `context/` when
needed. `ignore/` contains inactive history; `.runtime/` is the app's recovery
machinery. Neither is ordinary agent context. Existing supporting files should
be migrated deliberately, preserving evidence and links rather than discarding
them because their names differ from the new convention.

Each item starts with `## ID — Short title`. IDs are unique across all four
files and survive moves. The body is ordinary Markdown: a short lead paragraph,
then the stage's meaningful section. Add only useful evidence and constraints.
There is no universal eight-field form.

## Triage

```markdown
## DEV-1 — Protect worktree backups

Parallel commits may share backup state. Current safety is unverified.

### Decision

Investigate backup ownership and verify concurrent recovery?
```

Triage asks whether to take on the action. Approval to investigate authorizes
that investigation, not an unexamined implementation. A small accepted action
with a settled outcome can move directly to Batch.

## Design

```markdown
## DEV-2 — Prepare new worktrees

New worktrees need dependencies, local configuration, and a clear cache result.

### Open questions

Should setup use one repository command or compose existing commands?

### Proposal

One idempotent entrypoint keeps the setup contract in the repository.
```

Keep the actual open questions here. Do not retain completed designs as checked
items, recaps, or a separate completed section. Once settled, replace open
questions with the agreed Outcome and Acceptance and move the whole item.

## Batch and Execute

```markdown
# Worktree setup

## DEV-2 — Prepare new worktrees

Make a fresh worktree ready through the ordinary setup command.

### Outcome

One repository-owned entrypoint installs dependencies, safely links the main
checkout's configuration, and reports the cache import outcome.

### Acceptance

- Running setup twice preserves worktree-local configuration.
- Missing source configuration produces an actionable error.
```

Batch may have several named groups using `# Group name`; ungrouped items are
also valid. Groups are organization, not new workflow stages. Select any coherent
set of ready items to form the next named execution batch.

Execute contains one selected batch. Starting a new batch requires Execute to
be empty. Content can be clarified without expanding the selected item set.
Completion moves the item out of Execute and into `ignore/COMPLETED.md`.

## Evidence and migration

Use normal Markdown links to relevant files under `context/`, or put long
technical context under `### Evidence`, which the board collapses by default. Keep completion
criteria visible when they determine whether the work is ready or done.

Migrate item by item using actual approval and design state. Preserve source
material before restructuring it, stable IDs, constraints, and intended batch
relationships. Merge duplicate concerns without losing provenance. References
to supporting context are not duplicate work items.

An old burndown can contain both Design and Batch items. An old design document
can contain undecided candidates and already settled work. Its filename does
not decide the destination. Do not create an execution batch merely as a side
effect of migration.
