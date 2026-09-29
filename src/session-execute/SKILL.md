---
name: session-execute
description: Use when you are the worker of one session item, pointed at an item ID in a worktree's .session/ and told to carry it out. What to read, what to do with a step that cannot be done as written, where the report goes, what the final message holds.
---

# Execute an item

You carry out one item of the session in the worktree you are given. The item
is the spec, the brief beside it is the order of work, and the report is where
your work is read. This skill says nothing about any repository: the
repository's own rules, `AGENTS.md` and the skills the brief names, govern how
you work in it.

## Read

1. `session -C <worktree> brief <ID>` prints the item whole, the session's
   `RULES.md`, the listing of `context/<ID>/`, and the newest ledger titles.
   Read every file it names, whole, `context/<ID>/brief.md` first when it exists.
2. The item's `### Outcome` is the whole change and `### Acceptance` is what
   proves it. Read both twice before an edit.
3. A ledger entry newer than the brief may bear on the item; read those whose
   titles do.

## Do

- Do the Outcome in the brief's order. Where the brief leaves a choice open,
  take the one the surrounding code already makes, and name it in the report.
- A step that cannot be done as written, or that would be wrong as written,
  stops there: do the rest, and put what you would do instead in the report.
  The lead decides design; the report is where a design change is proposed.
  Never widen the item.
- A problem outside the item goes in the report with `file:line`. Fix it only
  when it breaks the item.
- Write to the worktree you were given and no other. When your shell starts
  elsewhere, every command names it, `git -C <worktree>` and the like, and
  every file path is absolute under it.
- The ledger is the lead's. Write no entry.

## Report

- Write the report to `context/<ID>/report-<profile>.md`, where `<profile>` is
  the name you were spawned as, and write it as you go rather than at the end:
  what you did per step, each gate's command and its last lines, each open
  choice and what you took, each step not done as written and why, problems
  found, and wall-clock from your first tool call to your last commit.
- Add a `### Agent` line to the item naming the lead's harness and session id
  and your profile, `claude <session id> / session-worker`, and link the report
  from the item's `### Evidence`.
- Your final message is only the commit SHAs, one line per gate with its
  verdict, and the report's path. Everything else is in the file: the hand-back
  is truncated, the file is not.
