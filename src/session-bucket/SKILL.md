---
name: session-bucket
description: Use when the user asks to bucket, sort, rank or prioritize session items (Triage, Design or Batch in .session/) or any other set of items (findings, review comments, open work) by whether each is needed and how complex it is, including "bucket these", "nth vs needed", "simple vs complex", or /session-bucket.
---

# Session bucket

Sort a set of items on two axes into four buckets, and present the buckets in priority order.

## Axes

Place each item by facts about the design itself, and name the fact that placed it. How many consumers or call sites something has never places an item.

| Axis | Value | The item… |
| --- | --- | --- |
| Need | **Needed** | breaks a standing rule, is a defect, or leaves a wrong contract (wire, schema, public API) in place |
| Need | **NTH** | meets none of the above, so it can land later at the same cost |
| Complexity | **Simple** | has a settled shape and lands in one pass |
| Complexity | **Complex** | has an open design fork, or carries execution risk: type-level, concurrency, or coordination with another team's in-flight work |

## Order

1. Needed · Simple
2. NTH · Simple
3. Needed · Complex
4. NTH · Complex

Simple comes before complex; within each, needed comes before NTH. When the user names other axes or another order, use theirs.

## Output

1. One line with the count in each bucket.
2. Each bucket as a heading, such as `1 · Needed · Simple (2)`. Under it, one line per item: `ID — the change — the fact that placed it`, each part six words or fewer. An empty bucket shows `—`.
3. Mark `✓ sign-off` on an item whose change needs the user's approval before any edit (visible API, wire contract).

Add nothing else: no recommendation beyond the order, and no restated evidence.

## Session items

When the items are records in the worktree's `.session/` (Triage, Design or Batch), follow the `session` skill, and also:

- Before placing an item, re-read its evidence against the current code. Report an item whose premise no longer holds as such, instead of bucketing it.
- Reorder the stage's cards to match the bucket order. A move without `--before` lands at the end, so run `session mv <ID> <STAGE>` for each item in bucket order, then `session check`.
- Keep every item in its stage. Bucketing only ranks; accepting and batching items stays with the user.

## TypeSafe judgments

After removing stale premises, run `typesafe bucket` with `items` containing
stable `id`, item text, and `evidenceRefs`. Use its independent need and
complexity judgments as proposed bucket placements. Axis definitions, requested
order, sign-off markers, and any `.session` moves remain owned by this skill.
