---
name: session_retro
description: >-
  Read all session debriefs, synthesize patterns, and produce a retrospective.
  Use when the user says "/session:retro", "retrospective", "session retro",
  "what patterns do we see", "synthesize debriefs", or "review all debriefs".
argument-hint: "[focus area]"
---

# /session:retro

Read all debriefs in the current session and synthesize a retrospective.

## Procedure

1. Run `~/.claude/skills/session/scripts/session.sh status` to get the session directory.
2. Find all `debrief.md` files in both active (`thread.*/debrief.md`) and done (`done.thread.*/debrief.md`) thread directories.
3. Read each debrief fully.
4. Synthesize into a retrospective covering:

### Output Structure

Write to `.session/retro.md`:

```markdown
# Retrospective: <session_key>

Generated: <ISO timestamp>
Debriefs analyzed: <count>

## Patterns

Recurring themes, approaches, or decisions across threads.

## What Worked

Techniques, tools, or decisions that debriefs consistently praised.

## What Didn't Work

Friction points, mistakes, or blockers that appeared across threads.

## Recommendations

Concrete suggestions for future sessions based on the patterns above.
```

## Focus Area

If the user provides a focus area (e.g., "testing", "coordination"), weight the synthesis toward that topic while still covering the full picture.

## No Debriefs

If no debrief files exist, say so and suggest running `/debrief` on completed threads.
