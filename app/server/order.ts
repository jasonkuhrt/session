import * as Effect from 'effect/Effect';
import * as Result from 'effect/Result';
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
 * and the rest after them by what is happening in them. A placement ranks the
 * worktree it places, and the unranked siblings it names as drawn above it,
 * and moves no other sibling's rank but the renumbering it needs, as a move
 * renumbers item prefixes.
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

/** Why a path names no sibling: what the worktree is ranked among, and which worktrees those are. */
const notSibling = (path: string, siblings: Siblings) => {
  const among = siblings.kind === 'projects'
    ? 'another main worktree the daemon tracks'
    : `another worktree of the epic ${quote(siblings.epic)}`;
  const paths = siblings.members.map(pathOf);
  const those = paths.length === 0
    ? 'there is no other'
    : `${siblings.kind === 'projects' ? 'those are' : 'its others are'} ${listed(paths)}`;
  return new RepositoryError({ kind: 'conflict', message: `Not ordered: ${path} is not ${among}; ${those}.` });
};

/** A placement made on ranks that are no longer the files' by the time it would write them. */
const changedOnDisk = new RepositoryError({
  kind: 'conflict',
  message: 'Not ordered: a rank among these worktrees changed on disk since it was read; try again.',
});

/** Every sibling's rank and the worktree's own, each under its session's lock; a file the rules reject reads as none. */
const readRanks = (members: ReadonlyArray<Rankable>, worktree: Rankable) =>
  Effect.forEach(
    [...members, worktree],
    (member) => member.repository.rank.pipe(Effect.orElseSucceed(() => null)),
    { concurrency: readConcurrency },
  );

/** A sibling in the order a placement gives: its rank before it, null for one it ranks now, and the rank it takes. */
type Placed = { readonly member: Rankable; readonly rank: number | null; readonly value: number };

/**
 * The order a placement gives and every rank in it, numbered as item prefixes
 * are: the ranked siblings, in rank order and by path where two share one,
 * keep their ranks while what it ranks fits between them, and all are
 * numbered again from 10, in steps of 10, when it does not, or when a count
 * would outgrow the numbers that are exact. `before` goes in front of a ranked
 * sibling; otherwise the unranked siblings in `after` follow the ranked ones,
 * in their order, and the worktree follows them.
 */
const planOrder = (input: {
  readonly worktree: Rankable;
  readonly members: ReadonlyArray<Rankable>;
  readonly ranks: ReadonlyArray<number | null>;
  readonly before: Rankable | null;
  readonly after: ReadonlyArray<Rankable>;
}) => {
  const ranked = input.members
    .flatMap((member, index) => {
      const rank = input.ranks[index] ?? null;
      return rank === null ? [] : [{ member, rank }];
    })
    .toSorted((left, right) => left.rank - right.rank || pathOf(left.member).localeCompare(pathOf(right.member)));
  const found = ranked.findIndex((entry) => entry.member === input.before);
  const at = found === -1 ? ranked.length : found;
  const order = [
    ...ranked.slice(0, at),
    ...input.after.map((member) => ({ member, rank: null })),
    { member: input.worktree, rank: input.ranks.at(-1) ?? null },
    ...ranked.slice(at),
  ];
  const index = at + input.after.length;
  // The worktree's own rank counts as none: it takes whatever fits where it goes.
  const existing = order.map((entry, position) => (position === index ? null : entry.rank));
  const numbered = numberEntries(existing);
  const values = numbered.every((value) => Number.isSafeInteger(value)) ? numbered : numberEntries(existing.map(() => null));
  return { order: order.map((entry, position): Placed => ({ member: entry.member, rank: entry.rank, value: values[position]! })), index };
};

/** A rank a placement wrote: whose it is, what the file held before, and what was written. */
type Written = { readonly member: Rankable; readonly from: number | null; readonly value: number };

/**
 * Take back what a refused placement wrote, the last write first, each only
 * while its file still holds what was written: a file written since is the
 * other writer's.
 */
const undo = (writes: ReadonlyArray<Written>) =>
  Effect.forEach(
    writes.toReversed(),
    (write) => write.member.repository.writeRank({ rank: write.from, from: write.value }).pipe(Effect.ignore),
    { discard: true },
  );

/**
 * Write a planned order: the ranked siblings it numbers again first, in an
 * order that keeps them in their order at every moment, lowered ranks from
 * the front and raised ones from the back; then the siblings it ranks now, in
 * their order; then the worktree, whose rank is not written when it lands on
 * the one it holds. Each is written against the rank read for it, so a file
 * changed in the meantime refuses the write, and what was written before it
 * is taken back. It answers what it wrote.
 */
const writeOrder = (order: ReadonlyArray<Placed>, index: number) =>
  Effect.gen(function*() {
    const siblings = order.filter((_, position) => position !== index);
    const moved = siblings.filter((entry) => entry.rank !== null && entry.value !== entry.rank);
    const lowered = moved.filter((entry) => entry.value < (entry.rank ?? 0));
    const raised = moved.filter((entry) => entry.value > (entry.rank ?? 0)).toReversed();
    const ranking = siblings.filter((entry) => entry.rank === null);
    const placed = order[index]!;
    const pending = [...lowered, ...raised, ...ranking, ...(placed.value === placed.rank ? [] : [placed])];
    const writes: Written[] = [];
    for (const entry of pending) {
      const wrote = yield* entry.member.repository.writeRank({ rank: entry.value, from: entry.rank }).pipe(Effect.result);
      if (Result.isFailure(wrote)) {
        yield* undo(writes);
        return yield* wrote.failure;
      }
      writes.push({ member: entry.member, from: entry.rank, value: entry.value });
    }
    return writes;
  });

/**
 * Whether what a placement wrote still stands alone: each file holds what was
 * written, and no other worktree holds a rank it wrote. Another placement
 * made at the same moment, by a command in its own process, can pass every
 * read before either writes; one of the two always reads the other's rank
 * after writing its own, so one of them finds the clash, takes back what it
 * wrote and is refused, and no two siblings are left sharing a rank.
 */
const standsAlone = (input: {
  readonly writes: ReadonlyArray<Written>;
  readonly everyone: ReadonlyArray<Rankable>;
  readonly ranks: ReadonlyArray<number | null>;
}) => {
  const holds = (member: Rankable) => input.ranks[input.everyone.indexOf(member)] ?? null;
  return input.writes.every((write) =>
    holds(write.member) === write.value &&
    !input.everyone.some((other) => other !== write.member && holds(other) === write.value)
  );
};

/**
 * Place a worktree among its siblings: the one write of order, and the only
 * one that gives a rank. `before` names a ranked sibling it goes in front of.
 * `after` names the unranked siblings drawn above the place it was dropped,
 * in their drawn order: they are ranked first, at the end of the ranked ones,
 * and it right after them, so it stands where it was dropped. With neither, it
 * goes last among the ranked. A `before` that is not ranked stands after every
 * ranked one, so the worktree goes last among the ranked then too, which is
 * still before it; that is a command's reading, which has no drawn order to
 * follow. Every path must be a sibling's, as Git gives it, and one sibling in
 * `after` that is ranked by now means the drawing it came from is stale. A
 * worktree already where it would go, between the same two ranked siblings,
 * keeps its rank and nothing is written. Before anything is written every
 * rank is read again under its session's lock, and a placement whose ranks
 * changed since it was planned is refused, as a stale revision refuses a
 * move; after writing, every rank is read once more, and a placement another
 * made at the same moment clashed with takes back what it wrote and is
 * refused the same way. A sibling's rank the rules reject reads as none and
 * is left as it is. It answers the rank, whether anything was written, the
 * siblings, and its ranked neighbours.
 */
export const setRank = (input: {
  readonly worktree: Rankable;
  readonly tracked: ReadonlyArray<Rankable>;
  readonly before: string | null;
  readonly after?: ReadonlyArray<string> | undefined;
}) =>
  Effect.gen(function*() {
    const afterPaths = input.after ?? [];
    if (input.before !== null && afterPaths.length > 0) {
      return yield* new RepositoryError({ kind: 'validation', message: 'Not ordered: a worktree goes before one sibling or after others, not both.' });
    }
    if (new Set(afterPaths).size !== afterPaths.length) {
      return yield* new RepositoryError({ kind: 'validation', message: 'Not ordered: a sibling is named twice.' });
    }
    const siblings = yield* siblingsOf(input);
    const memberAt = (path: string) => siblings.members.find((member) => pathOf(member) === path);
    const before = input.before === null ? null : memberAt(input.before) ?? null;
    if (input.before !== null && before === null) return yield* notSibling(input.before, siblings);
    const after: Rankable[] = [];
    for (const path of afterPaths) {
      const member = memberAt(path);
      if (member === undefined) return yield* notSibling(path, siblings);
      after.push(member);
    }
    const ranks = yield* readRanks(siblings.members, input.worktree);
    if (after.some((member) => ranks[siblings.members.indexOf(member)] !== null)) return yield* changedOnDisk;
    const { order, index } = planOrder({ worktree: input.worktree, members: siblings.members, ranks, before, after });
    const placed = order[index]!;
    const neighbours = { after: order[index - 1]?.member ?? null, before: order[index + 1]?.member ?? null };
    // Already between the same two ranked siblings, it keeps the rank it has,
    // whatever the numbering would make of the others, and nothing is written.
    const lower = order[index - 1]?.rank ?? null;
    const upper = order[index + 1]?.rank ?? null;
    const fits = placed.rank !== null && after.length === 0 && (lower === null || lower < placed.rank) &&
      (upper === null || placed.rank < upper);
    if (fits) return { rank: placed.rank ?? placed.value, written: false, siblings, ...neighbours };
    const again = yield* readRanks(siblings.members, input.worktree);
    if (again.some((rank, position) => rank !== ranks[position])) return yield* changedOnDisk;
    const writes = yield* writeOrder(order, index);
    const everyone = [...siblings.members, input.worktree];
    if (!standsAlone({ writes, everyone, ranks: yield* readRanks(siblings.members, input.worktree) })) {
      yield* undo(writes);
      return yield* changedOnDisk;
    }
    return { rank: placed.value, written: true, siblings, ...neighbours };
  });
