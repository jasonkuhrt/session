---
name: session:thread:land
description: >-
  Perform a real closeout audit for the thread-scoped task and, when requested,
  land it through commit, push, and CI. Use when the user says
  "/session:thread:land", "are you done", "can we close this", "is anything
  still open", "wrap this session up", or wants to end the thread without
  losing unfinished work, buried follow-ups, or useful loose ends.
---

# Session Thread Land
Close the thread honestly.
Use this skill when the user wants a real completion verdict or a closeout that preserves loose ends instead of losing them in chat.

## Core Contract
Answer: `Can this thread close without losing required work or useful value?`
Do two things:
- audit the thread-scoped work for real completion
- preserve loose ends worth carrying forward
If the user wants landing, continue through commit, push, and CI. A local commit is not a landed thread.

## Scope
Default to the task requested in this conversation.
Precedence:
1. the user's latest durable goal
2. explicit scope corrections
3. acceptance criteria added in-thread
4. broader `.session`, branch, or issue context
Do not let broader session state override a narrower thread ask.

## Subagent Standard
Treat subagents as part of the thread's closeout surface, not background noise.

Before `Done verdict: yes` or any landing claim:
- enumerate every subagent you created, resumed, or materially relied on for this thread
- determine whether each one is `running`, `idle/reachable`, `closed/archived`, or `unknown`
- treat `running` as a blocker to landing
- treat closing subagents as a landing requirement unless the user already archived/closed them

Use this systematic process:
1. Check status first. Do not infer from memory.
2. For each `idle/reachable` subagent, request a short land-ready report with a timeout.
3. Preserve any value returned by that report before closing the subagent.
4. Close the subagent after its state is accounted for.

Interpretation rules:
- A timeout on a land-ready request does **not** mean the subagent is done.
- If a subagent is clearly still running, that blocks landing.
- If a subagent is clearly closed or archived by the user, that does **not** block landing.
- If tooling cannot distinguish `running` from `closed`, treat the state as `unknown` and block landing until resolved.
- Never silently ignore a subagent just because it stopped replying.

## Workflow
1. Reconstruct the thread when it is long or changed direction.
   Capture the original ask, scope corrections, acceptance criteria, agent promises, findings that changed the bar, and side threads that became obligations.
2. Sweep current reality.
   Check touched files, actual verification, `git status`, `.session/SESSION.md`, and the relevant thread directory (`.session/thread.<slug>/`) — read `tasks.md`, `plan.md` or `done.plan.md`, and any active `review.*.md` files.
3. Classify the result.
   - `Done`: completed and real
   - `Open`: still required for thread closure — must trace back to the thread's scope: its plan/tasks (when they exist), conversation commitments, or explicit in-thread promises. If it wasn't in the thread's scope, it is not `Open`.
   - `Missed Value`: useful non-blocking follow-ons or insights that are still at risk of being lost unless preserved now. This includes issues discovered during thread work that were never thread obligations.
4. Preserve value before closing.
   Write surviving loose ends into the right durable place:
   - `.session/thread.<slug>/` files for thread-scoped work
   - `.session/SESSION.md` for session-level decisions
   - code comments only when truly code-local
   - the final response when no better artifact exists
Do not rely on the human remembering buried chat details later.

Classification rule:
- if value has already been preserved in a durable external artifact during this closeout (`.session`, code, issue tracker, etc.), it is **not** `Missed Value`
- preserved value belongs under `Done` or `Evidence`, depending on whether you are describing the preservation action or proving it happened
- `Missed Value` is only for value that has not yet been extracted and would otherwise disappear with the thread

## Thread Completion

## Thread Completion Sequence

After the done verdict passes and all work is landed, execute these steps in order:

1. **Debrief** — invoke `/session:debrief` to write a reflective `debrief.md` into the thread directory. This is best-effort: if it fails, log a warning and continue. Do not block landing on a debrief failure.

2. **Mark done** — use the CLI to close the thread:
   ```bash
   ~/.claude/skills/session/scripts/session.sh thread done <slug>
   ```
   This renames `thread.<slug>/` → `done.thread.<n>.<slug>/`, auto-assigning the next sequence number to preserve completion order. The debrief file moves with the directory.

## Done Standard
Allow `Done verdict: yes` only when:
- the thread's scope is implemented (as defined by its `plan.md`/`done.plan.*.md` and `tasks.md` when they exist, or by the conversation's stated goals and acceptance criteria when no plan exists)
- promises the agent made *in this thread* are resolved
- acceptance criteria added *in this thread's conversation* are met
- no meaningful thread obligation remains open
- session/thread state does not falsely imply unfinished work
- every thread-relevant subagent has been accounted for and none are still running
Otherwise the verdict is `no`.

### What is NOT a thread obligation
These do not block `Done verdict: yes`:
- pre-existing issues not in the thread's scope (type errors in other libraries, tech debt discovered during work)
- work discovered mid-thread that was never accepted as a thread deliverable (not in plan, tasks, or conversation commitments)
- external blockers on the PR/branch (CI blocked by unrelated reverts, merge conflicts from other work)
- PR mergeability — a thread can be done while its PR is not yet mergeable
- missing tests or validation not promised in the thread's scope

These belong in `Missed Value` (if worth preserving) or `Next` (if actionable), never in `Open`.

## Landing Standard
If the user wants landing, require:
- the audit passes
- your hunks are committed
- the branch is pushed
- CI is checked
- commit hook or CI rejections are handled or clearly surfaced
- every thread-relevant subagent has either:
  - returned a land-ready report and then been closed, or
  - been clearly archived/closed by the user
In a busy multi-agent worktree, stage only your work when practical, prefer file-level staging, use hunk staging only when needed, and disclose intentional over-commit plainly.

## Output Contract
Start with exactly one line: `Done verdict: yes` or `Done verdict: no`
Then use exactly:
- `Done`
- `Open`
- `Missed Value`
- `Evidence`
- `Next`
Rules:
- `Done` only completed facts
- `Open` every remaining blocker; write `- none` if empty
- `Missed Value` only non-blocking value that is not yet durably preserved; write `- none` if empty
- `Evidence` concrete checks, repo state, landing state, and at least one earlier-thread obligation that was considered
- `Next` one highest-priority next move, or say the thread can close

## Never Do This

- answer from the latest assistant message alone
- confuse "my code is done" with "the thread is done"
- confuse "the thread is done" with "the PR is mergeable"
- put discovered-but-unpromised work in `Open` — it belongs in `Missed Value` or `Next`
- block the done verdict on pre-existing issues, external CI failures, or work outside the thread's scope
- let recent activity erase earlier promises
- hide in-scope work under "optional follow-up"
- suppress useful loose ends because they were non-blocking
- claim a thread is landed when it only has a local commit
- treat a timed-out subagent as implicitly done
- close a thread while a thread-relevant subagent is still running
- forget to close reachable subagents before claiming landing
- label already-preserved value as `Missed Value`

## Examples

### Thread done, PR not yet mergeable
Done verdict: yes
Done
- all 8 plan tasks completed and checked off in `tasks.md`
- implementation committed and pushed
Open
- none
Missed Value
- trpc-effect type errors pre-date this thread; preserved in SESSION.md follow-ups
- renderContext validation discovered mid-thread but never added to plan; noted in handoff
Evidence
- `tasks.md` shows 8/8 checked
- `plan.md` scope matches delivered work
- CI blocked by external v4 revert — not a thread obligation
Next
- thread can close; PR merge depends on resolving the external revert separately

### Thread not done
Done verdict: no
Done
- schema refactor landed
Open
- `.session/thread.schema-design/tasks.md` still shows one unchecked closeout item (promised in plan task 4)
Missed Value
- extract the tree normalization helper for page-template reuse
Evidence
- `pnpm test tree-lib` passed
- the earlier promise to update the task file is still unmet
- thread would become `done.thread.3.schema-design/` (next sequence after existing done.thread.1.* and done.thread.2.*)
Next
- update the task file, then rerun the closeout audit
