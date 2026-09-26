import * as Effect from 'effect/Effect';
import { quote } from './model.ts';
import { RepositoryError, type SessionRepository } from './repository.ts';
import { epicNameProblem } from './root.ts';
import type { WorktreeSession } from './worktree.ts';

/**
 * The rules a worktree's epic changes by, for the CLI and the daemon alike: a
 * main worktree is never in one, and a change of epic takes a linked
 * worktree's rank away, but for a rename to a name no other epic has, which
 * the daemon tells from the worktrees it tracks.
 */

/** A tracked worktree as an epic write reads it: what Git says it is, and its session's files. */
type Member = { readonly session: WorktreeSession; readonly repository: SessionRepository };

/** Reading every tracked worktree's epic at once is a stat and a read each; this many at a time. */
const readConcurrency = 4;

/**
 * Why a main worktree cannot join an epic, naming the rule and the way round
 * it: its Git directory is the repository's own and Git will not move, lock
 * or remove it, so the index draws it at the head of its repository's section
 * instead.
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
 * same epic under another name, so it keeps its rank; `renameEpic` alone says
 * so, and a leave is never one. A main worktree's rank orders its project,
 * which no epic touches. Answers the epic its file named before.
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

/** The linked worktrees, of these, whose files name each epic; a file the rules reject names none. */
const epicsOf = (linked: ReadonlyArray<Member>) =>
  Effect.forEach(linked, (member) => member.repository.epic.pipe(Effect.orElseSucceed(() => null)), {
    concurrency: readConcurrency,
  });

/**
 * Rename an epic: every tracked worktree whose file names `from` takes the
 * name `to`. Which kind of rename it is comes from the files of the worktrees
 * the daemon tracks, read here. When no other worktree names `to`, it is the
 * same epic under another name, and every worktree keeps its rank. When one
 * does, the two merge, and the worktrees that arrive join `to` unranked,
 * after its ranked ones, whose ranks stay as they are. The worktrees naming
 * `to` are read again just before the first write, so one that joined it
 * meanwhile refuses the rename, and each worktree is written against `from`,
 * so one whose file changed since refuses its write, as the epic route's
 * `from` does. A main worktree is never in an epic, so its file is not read.
 * It answers the name the epic has now and whether it merged.
 */
export const renameEpic = (input: {
  readonly from: string;
  readonly to: string;
  readonly tracked: ReadonlyArray<Member>;
}) =>
  Effect.gen(function*() {
    const to = input.to.trim();
    const problem = epicNameProblem(to);
    if (problem !== null) return yield* new RepositoryError({ kind: 'validation', message: `Not renamed: ${problem}.` });
    if (to === input.from) return { epic: to, merged: false };
    const linked = input.tracked.filter((member) => !member.session.worktree.main);
    const epics = yield* epicsOf(linked);
    const members = linked.filter((_, index) => epics[index] === input.from);
    if (members.length === 0) {
      return yield* new RepositoryError({
        kind: 'conflict',
        message: `Not renamed: no worktree the daemon tracks is in ${quote(input.from)} now; reload the index.`,
      });
    }
    const target = linked.filter((_, index) => epics[index] === to);
    const again = yield* epicsOf(linked);
    if (linked.some((_, index) => (epics[index] === to) !== (again[index] === to))) {
      return yield* new RepositoryError({
        kind: 'conflict',
        message: `Not renamed: which worktrees are in ${quote(to)} changed on disk since it was read; try again.`,
      });
    }
    const merged = target.length > 0;
    for (const member of members) {
      yield* setWorktreeEpic({ session: member.session, repository: member.repository, epic: to, from: input.from, rename: !merged });
    }
    return { epic: to, merged };
  });
