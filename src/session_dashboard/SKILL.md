---
name: session-dashboard
description: >-
  Session dashboard showing thread timeline, agent roster, and commit counts.
  Use when the user says "/session-dashboard", "show dashboard", "session
  overview", "session summary", "what's happening in this session", or
  "agent activity".
argument-hint: ""
---

# /session-dashboard

Generate a comprehensive dashboard of the current session.

## Procedure

1. Run `~/.claude/skills/session/scripts/session.sh status` and `context` to get session state.
2. Run `~/.claude/skills/session/scripts/session.sh log-show --tail 100` to get recent events.
3. Run `git log --oneline -20` to get recent commits.

### Generate Dashboard

Output to stdout (do NOT create a file):

```
# Session Dashboard: <session_key>

Generated: <ISO timestamp>

## Thread Timeline

| Thread | Status | Created | Claimed By | Tasks (done/total) |
|--------|--------|---------|------------|-------------------|
| <slug> | active | <date>  | <agent>    | 3/7               |
| <slug> | done #1| <date>  | —          | 5/5               |

## Agent Roster

Agents that appear in the event log, with their activity:

| Agent | Claims | Events | Last Active |
|-------|--------|--------|-------------|
| <name>| 2      | 15     | <timestamp> |

## Recent Activity

Last 10 events from the session log, formatted as:
<timestamp>  <agent>  <event>  <detail>

## Commit Summary

Last 10 commits on the current branch:
<sha> <message>
```

## Data Sources

- Thread metadata: `tasks.md` frontmatter (`created`, `claimed_by`)
- Task counts: count `- [ ]` and `- [x]` lines in each `tasks.md`
- Agent roster: unique agents from the event log
- Commits: `git log --oneline`

## Empty Session

If no threads or events exist, show the empty dashboard with guidance on getting started.
