# Session Tool

This repo develops the session management system for Claude Code agents.

## What This Is

A CLI + skill suite for managing agent work sessions: thread-based work containers with plans, tasks, reviews, debriefs, claims, and lifecycle commands. Installed as a Claude Code skill at `~/.claude/skills/session/`.

## Source Files

The skill files live at `~/.claude/skills/session/` (installed), not in this repo. This repo is for development — planning, testing, and iterating on the session system.

## Key Files (installed location)

| File | Role |
|------|------|
| `~/.claude/skills/session/scripts/session.sh` | CLI (~700 lines, argc) |
| `~/.claude/skills/session/SKILL.md` | Natural language router skill |
| `~/.claude/skills/session/reference.md` | Single source of truth for conventions |
| `~/.claude/skills/session_thread_land/SKILL.md` | Thread closeout audit skill |
| `~/.claude/skills/debrief/SKILL.md` | Reflective debrief skill |
