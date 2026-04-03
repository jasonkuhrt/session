---
name: session:thread:handoff
description: >-
  Structured context brief and claim transfer for thread handoff between agents.
  Use when the user says "/session:thread:handoff", "/thread:handoff", "hand off
  this thread", "transfer thread to", "pass this to another agent", "handoff",
  or "take over thread".
argument-hint: "<thread-slug> [to <agent-name>]"
---

# /session:thread:handoff

Create a structured handoff brief for a thread and transfer the claim to another agent.

## Procedure

1. Parse arguments: `<thread-slug>` is required, `to <agent-name>` is optional.
2. Run `~/.claude/skills/session/scripts/session.sh thread show <slug>` to get thread state.
3. Read the thread's `tasks.md` — note completed vs remaining items.
4. Read `plan.md` or `done.plan.*.md` if they exist — note the approach.
5. Check current claim: `thread claim check <slug>`.

### Generate Handoff Brief

Write a concise handoff to stdout (do NOT create a file):

```
## Thread Handoff: <slug>

**From:** <current claimer or "unclaimed">
**To:** <target agent or "next available">
**Generated:** <ISO timestamp>

### Status
<1-2 sentences on where things stand>

### Completed
<checked items from tasks.md>

### Remaining
<unchecked items from tasks.md>

### Key Context
<important decisions, constraints, or gotchas from plan/tasks/reviews>

### Files
<list of thread files with their status>
```

6. If `to <agent-name>` was specified:
   - Release current claim: `thread claim release <slug>`
   - Set new claim: `thread claim set <slug> --agent <agent-name>`
   - Announce the transfer.

7. If no target agent specified, just output the brief without transferring.

## No Thread Found

If the thread doesn't exist, say so and list available threads via `thread list`.
