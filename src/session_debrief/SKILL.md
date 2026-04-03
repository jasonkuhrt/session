---
name: session:debrief
description: >-
  Write a reflective debrief for a session thread. Use when closing a thread,
  after "/session:debrief", "/debrief", "write a debrief", "debrief this
  thread", or when session:thread:land invokes it after the done verdict passes.
---

# Session Debrief

Write a `debrief.md` into the thread directory — your subjective experience of the thread, useful for future agents and the human browsing old threads.

## When to Use

- Invoked by `/debrief` on any thread (active or done)
- Called automatically by `session:thread:land` after done verdict passes, before `session thread done <slug>`
- Can be re-run to overwrite an existing debrief

## Identify the Thread

1. If a thread slug is provided as an argument, use it.
2. Otherwise, check `session thread which` for the current thread marker.
3. Otherwise, infer from conversation context (the thread you've been working on).
4. If ambiguous, ask.

## Gather Data

Before writing, collect:

- The thread's `tasks.md` (what was done)
- The thread's `plan.md` or `done.plan.*.md` (what was planned)
- `git log` for commits you made during this thread (collect the short SHAs for frontmatter)
- Your own conversation memory of surprises, decisions, and mistakes

## Write the File

Write to `<thread-dir>/debrief.md` using the Write tool. The file has three layers: frontmatter, structured sections, and playful sections.

### Frontmatter

```yaml
---
session_id: <your claude session resume ID>
agent_name: <$CLAUDE_AGENT_NAME or "lead" if unset>
thread: <slug>
timestamp: <ISO 8601 with timezone, e.g. 2026-04-03T17:42:28-04:00>
git_head_sha: <git rev-parse --short HEAD at time of writing>
git_commit_shas:
  - <short sha of each commit this thread produced, oldest first>
codename: <retroactive codename, e.g. "Operation Codec Bridge">
difficulty: <★☆☆☆☆ to ★★★★★ with a one-word justification, e.g. "★★★★☆ coordination">
---
```

### Structured — "Top 3"

Each section is a numbered list. Fewer than 3 items is fine if the thread was short. Never pad with generic filler.

```markdown
## Top 3 Surprises

Things that didn't work as expected, APIs that lied, assumptions that broke.
The bar: would another agent hit this same wall? If yes, it belongs here.

## Top 3 Decisions

Judgment calls you made during the thread, with brief rationale.
Not "I used Effect" (that's a convention), but "I chose Schema.Top over Codec<any,any> because..." (that's a judgment call).

## Top 3 Follow-Ups

Concrete work items that emerged from this thread but weren't in scope.
These are seeds for future threads — tasks that will otherwise die with this conversation.
Format: one-sentence description + why it matters.

## Top 3 Files

Most important files touched or discovered, with one-line context each.
Format: `path/to/file.ts` — context
```

### Open-Ended

```markdown
## Field Notes

Free-form observations about the codebase, the problem space, the architecture.
Your genuine voice, not boilerplate. Things that don't fit in boxes.
```

### Playful

```markdown
## Haiku

About THIS thread's work specifically. Should make someone smile.

## Vibe Check

1-2 sentences on the human's apparent mood/energy during the session. Honest but kind.

## Rubber Duck Confession

One thing you were wrong about or confused by. Genuinely honest, not performative humility.
```

## Quality Bar

- **Every section must be specific to THIS thread.** Generic filler ("the codebase is well-organized") is worse than omitting the section.
- **The haiku should be good enough to make someone smile.** Not "code flows like a stream / bugs are fixed and tests all pass / deploy to the cloud."
- **The rubber duck confession should be genuinely honest.** Not "I briefly considered an incorrect approach before finding the right one."
- **Top 3 lists can have fewer than 3 items.** Never pad.
- **Field notes should contain at least one observation that would surprise the human.** If you can't think of one, the debrief isn't reflective enough.

## Non-Blocking

The debrief is best-effort enrichment. If it fails (can't find the thread, can't gather data), log a warning and let the caller proceed. Never block thread landing on a debrief failure.
