import * as Effect from 'effect/Effect';
import { numberEntries } from './layout.ts';
import { quote } from './model.ts';
import { RepositoryError, type SessionRepository } from './repository.ts';
import type { WorktreeSession } from './worktree.ts';

/**
 * The index's hand-set order: a worktree's rank among its siblings, one line
 * in its `meta/rank`. A main worktree's siblings are the other main worktrees
 * the daemon tracks, and its rank orders its project among the projects; any
 * other worktree's siblings are the other worktrees of its epic, and its rank
 * orders it in the epic's card. Ranked siblings stand first, in rank order,
 * and the rest after them by what is happening in them, so a placement ranks
 * the one worktree it places and moves no sibling's rank but the renumbering
 * it needs, as a move renumbers item prefixes.
 */

/** A tracked worktree as a placement reads it: what Git says it is, and its session's files. */
export type Rankable = {
  readonly session: WorktreeSession;
  readonly repository: SessionRepository;
};

/** What a worktree is ranked among: the other main worktrees, for a main one, or the other worktrees of its epic. */
type Siblings =
  | { readonly kind: 'projects'; readonly members: ReadonlyArray<Rankable> }
  | { readonly kind: 'epic'; readonly epic: string; readonly members: ReadonlyArray<Rankable> };

/** Reading every sibling's files at once is a handful of stats and reads each; this many at a time. */
const readConcurrency = 4;

const pathOf = (worktree: Rankable) => worktree.session.worktree.path;

/** Paths in a sentence: `a`, `a and b`, `a, b and c`. */
const listed = (paths: ReadonlyArray<string>) =>
  paths.length < 2 ? paths.join('') : `${paths.slice(0, -1).join(', ')} and ${paths.at(-1) ?? ''}`;

/**
 * The siblings a worktree is ranked among, from every worktree the daemon
 * tracks. A main worktree is ranked among the other main worktrees, whatever
 * its `meta/epic` says, since it is never in an epic. Any other worktree is
 * ranked among the others whose files name its epic; one in no epic stands by
 * what happens in it and is ranked among nothing, so it is refused. A file of
 * its own the rules reject refuses the placement with the sentence `check`
 * gives, and a sibling's is read as naming no epic.
 */
const siblingsOf = (input: { readonly worktree: Rankable; readonly tracked: ReadonlyArray<Rankable> }) =>
  Effect.gen(function*() {
    const { worktree } = input.worktree.session;
    const others = input.tracked.filter((candidate) => pathOf(candidate) !== worktree.path);
    if (worktree.main) {
      return { kind: 'projects', members: others.filter((candidate) => candidate.session.worktree.main) } satisfies Siblings;
    }
    const epic = yield* input.worktree.repository.epic;
    if (epic === null) {
      return yield* new RepositoryError({
        kind: 'conflict',
        message: `Not ordered: ${worktree.name} is in no epic, and a worktree in no epic stands by what happens in it; ` +
          'join one with `session join "<epic>"` first.',
      });
    }
    const linked = others.filter((candidate) => !candidate.session.worktree.main);
    const epics = yield* Effect.forEach(
      linked,
      (candidate) => candidate.repository.epic.pipe(Effect.orElseSucceed(() => null)),
      { concurrency: readConcurrency },
    );
    return { kind: 'epic', epic, members: linked.filter((_, index) => epics[index] === epic) } satisfies Siblings;
  });

/** Why `before` names no sibling: what the worktree is ranked among, and which worktrees those are. */
const notSibling = (before: string, siblings: Siblings) => {
  const among = siblings.kind === 'projects'
    ? 'another main worktree the daemon tracks'
    : `another worktree of the epic ${quote(siblings.epic)}`;
  const paths = siblings.members.map(pathOf);
  const those = paths.length === 0
    ? 'there is no other'
    : `${siblings.kind === 'projects' ? 'those are' : 'its others are'} ${listed(paths)}`;
  return new RepositoryError({ kind: 'conflict', message: `Not ordered: ${before} is not ${among}; ${those}.` });
};

/** A ranked sibling and its rank, in the order the index draws them: by rank, and by path where two share one. */
type Ranked = { readonly member: Rankable; readonly rank: number };

const byRank = (left: Ranked, right: Ranked) => left.rank - right.rank || pathOf(left.member).localeCompare(pathOf(right.member));

/**
 * The ranks a placement gives, the placed worktree's at `at` and every ranked
 * sibling's around it, numbered as item prefixes are: the siblings keep theirs
 * while the worktree fits between its neighbours, and all of them are
 * numbered again from 10, in steps of 10, when it does not, or when a count
 * would outgrow the numbers that are exact.
 */
const rankedAround = (ranked: ReadonlyArray<Ranked>, at: number) => {
  const existing = [...ranked.slice(0, at).map((entry) => entry.rank), null, ...ranked.slice(at).map((entry) => entry.rank)];
  const numbered = numberEntries(existing);
  return numbered.every((value) => Number.isSafeInteger(value)) ? numbered : numberEntries(existing.map(() => null));
};

/**
 * Place a worktree before one of its siblings, or last among the ranked ones
 * with `before` null: the one write of order. A sibling that is not ranked
 * stands after every ranked one, so the worktree goes last among the ranked
 * when `before` names one of those, which is still before it. `before` must be
 * a sibling, by its path as Git gives it. A worktree already between the two
 * it would go between keeps its rank and nothing is written. Otherwise it
 * takes the rank between them, and when there is no room the siblings are
 * numbered again, and only the ranks that change are written, each through
 * the atomic write `meta/epic` has: the siblings first, in an order that keeps
 * them in their order at every moment, then the worktree placed. A sibling's
 * rank the rules reject reads as none and is left as it is. It answers the
 * rank, whether it was written, the siblings, and its ranked neighbours.
 */
export const setRank = (input: {
  readonly worktree: Rankable;
  readonly tracked: ReadonlyArray<Rankable>;
  readonly before: string | null;
}) =>
  Effect.gen(function*() {
    const siblings = yield* siblingsOf(input);
    const target = input.before === null ? null : siblings.members.find((member) => pathOf(member) === input.before);
    if (input.before !== null && target === undefined) return yield* notSibling(input.before, siblings);
    const ranks = yield* Effect.forEach(
      siblings.members,
      (member) => member.repository.rank.pipe(Effect.orElseSucceed(() => null)),
      { concurrency: readConcurrency },
    );
    const ranked = siblings.members
      .flatMap((member, index): Ranked[] => {
        const rank = ranks[index] ?? null;
        return rank === null ? [] : [{ member, rank }];
      })
      .toSorted(byRank);
    const found = ranked.findIndex((entry) => entry.member === target);
    const at = found === -1 ? ranked.length : found;
    const neighbours = { after: ranked[at - 1]?.member ?? null, before: ranked[at]?.member ?? null };
    const current = yield* input.worktree.repository.rank.pipe(Effect.orElseSucceed(() => null));
    const lower = ranked[at - 1]?.rank;
    const upper = ranked[at]?.rank;
    if (current !== null && (lower === undefined || lower < current) && (upper === undefined || current < upper)) {
      return { rank: current, written: false, siblings, ...neighbours };
    }
    const values = rankedAround(ranked, at);
    const moved = ranked.flatMap((entry, index) => {
      const value = values[index < at ? index : index + 1]!;
      return value === entry.rank ? [] : [{ ...entry, value }];
    });
    // Lowered ranks from the front and raised ones from the back never pass a
    // sibling that has not been written yet, so the siblings keep their order.
    const lowered = moved.filter((entry) => entry.value < entry.rank);
    const raised = moved.filter((entry) => entry.value > entry.rank).toReversed();
    for (const entry of [...lowered, ...raised]) yield* entry.member.repository.writeRank(entry.value);
    // Numbered again, it can land on the rank it holds, which is then not written.
    const rank = values[at]!;
    if (rank !== current) yield* input.worktree.repository.writeRank(rank);
    return { rank, written: true, siblings, ...neighbours };
  });
