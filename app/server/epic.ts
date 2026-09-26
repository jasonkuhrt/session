import * as Effect from 'effect/Effect';
import { RepositoryError, type SessionRepository } from './repository.ts';
import type { WorktreeSession } from './worktree.ts';

/**
 * The one rule a worktree joins an epic by, for the CLI and the daemon alike:
 * a main worktree is never in one, and a change of epic takes a linked
 * worktree's rank away, but for a rename to a name no other epic has.
 */

/**
 * Why a main worktree cannot join an epic, naming the rule and the way round
 * it: Git keeps the repository in it and lists it first, so the index draws it
 * at the head of its repository's section instead.
 */
const mainWorktreeRefusal = (name: string) =>
  `Not joined: ${name} is its repository’s main worktree, and a main worktree is never in an epic; ` +
  'join from one of its linked worktrees instead.';

/**
 * Put a worktree in the epic of that name, or in none with null, through the
 * one rule both the CLI and the daemon join by: a main worktree is never in an
 * epic. Leaving is always allowed, so a hand-made file in a main worktree can
 * be taken out the same way. `from` is the epic the writer last read, which
 * the index sends and a command does not. Any other worktree's rank orders it
 * within its epic, so a change of epic takes its rank away: it joins the next
 * one unranked, and leaves with no place kept. `rename` says the write is the
 * worktree's part of renaming its whole epic to a name no other epic has, the
 * same epic under another name, so it keeps its rank; only the index knows
 * that, since a command joins one worktree at a time, and a leave is never
 * one. A main worktree's rank orders its project, which no epic touches.
 * Answers the epic its file named before.
 */
export const setWorktreeEpic = (input: {
  readonly session: WorktreeSession;
  readonly repository: SessionRepository;
  readonly epic: string | null;
  readonly from?: string | null | undefined;
  readonly rename?: boolean | undefined;
}) =>
  input.epic !== null && input.session.worktree.main
    ? Effect.fail(new RepositoryError({ kind: 'conflict', message: mainWorktreeRefusal(input.session.worktree.name) }))
    : input.repository.setEpic({
      epic: input.epic,
      from: input.from,
      dropsRank: !input.session.worktree.main && (input.rename !== true || input.epic === null),
    });
