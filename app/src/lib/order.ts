import type { WorktreeSummary } from '../../contract'

/**
 * The index's hand-set order, as the rows carry it: a worktree's rank among
 * its siblings, from its `meta/rank`. A main worktree is ranked among the other
 * main worktrees, which orders the projects' sections; any other worktree
 * among the other worktrees of its epic, which orders the epic's card. Ranked
 * siblings stand first, by rank, a path settling a tie as the engine settles
 * it, and the rest follow by what is happening in them. Nothing here is kept:
 * every order is read from the rows each time the page draws them.
 */

/** Something the index orders by rank: its rank, or null, and the path that settles a tie. */
type Rankable = { readonly rank: number | null; readonly path: string }

/**
 * An order with the ranked entries first: ranked before unranked, then by
 * rank, a path settling a tie, and two unranked entries by `otherwise`, the
 * caller's own order, what is happening in each.
 */
export function rankedFirst<A>({ rankOf, otherwise }: {
  readonly rankOf: (entry: A) => Rankable
  readonly otherwise: (left: A, right: A) => number
}): (left: A, right: A) => number {
  return (leftEntry, rightEntry) => {
    const left = rankOf(leftEntry)
    const right = rankOf(rightEntry)
    if (left.rank === null && right.rank === null) return otherwise(leftEntry, rightEntry)
    if (left.rank === null) return 1
    if (right.rank === null) return -1
    return left.rank - right.rank || left.path.localeCompare(right.path)
  }
}

/** A row as the rank order reads it. */
const asRanked = (row: WorktreeSummary): Rankable => row

/**
 * The worktrees a worktree is ranked among, as the engine reads them: the
 * other main worktrees for a main one, and the other worktrees of its epic for
 * any other; none for a worktree in no epic, which stands by what happens in it.
 */
function siblingsOf(rows: readonly WorktreeSummary[], row: WorktreeSummary): WorktreeSummary[] {
  if (row.main) return rows.filter((candidate) => candidate.main && candidate.path !== row.path)
  if (row.epic === null) return []
  return rows.filter((candidate) => !candidate.main && candidate.epic === row.epic && candidate.path !== row.path)
}

/**
 * A placement a drop writes: the worktree, the ranked sibling it goes before
 * or null, and the unranked siblings drawn above where it was dropped, which
 * are ranked first so it lands there. With neither it goes last among the
 * ranked.
 */
export type Placement = { readonly path: string; readonly before: string | null; readonly after: readonly string[] }

/**
 * The rows with a placement drawn, while it is written, as the epics a drop
 * writes are drawn until the daemon's answer replaces them: the worktree and
 * its ranked siblings take ranks in the order the placement gives them, which
 * only that order means, so nothing jumps back before the answer lands.
 */
export function withPlacement({ rows, placement }: {
  readonly rows: readonly WorktreeSummary[]
  readonly placement: Placement | null
}): readonly WorktreeSummary[] {
  const row = placement === null ? undefined : rows.find((candidate) => candidate.path === placement.path)
  if (placement === null || row === undefined) return rows
  const ranked = siblingsOf(rows, row)
    .filter((sibling) => sibling.rank !== null)
    .toSorted(rankedFirst({ rankOf: asRanked, otherwise: () => 0 }))
  const found = ranked.findIndex((sibling) => sibling.path === placement.before)
  const at = found === -1 ? ranked.length : found
  const above = placement.after.flatMap((path) => rows.filter((candidate) => candidate.path === path))
  const order = [...ranked.slice(0, at), ...above, row, ...ranked.slice(at)]
  const drawn = new Map(order.map((entry, index) => [entry.path, index]))
  return rows.map((candidate) => {
    const rank = drawn.get(candidate.path)
    return rank === undefined ? candidate : { ...candidate, rank }
  })
}

/** Where the line a landing draws sits: before or after one of the list's drawn entries, by the entry's id. */
export type Marker = { readonly list: string; readonly id: string; readonly side: 'before' | 'after' }

/** The list a line is drawn in: the stack of sections, or one epic's card. */
export const sectionsList = 'sections'
export const epicList = (epic: string) => `epic:${epic}`

/** Whether two drawn orders are the same entries in the same order. */
const sameOrder = <A>(left: readonly A[], right: readonly A[]) =>
  left.length === right.length && left.every((entry, index) => entry === right[index])

/** What a drop writes and draws: the placement's `before` and `after`, where its line goes, and the words over the held copy. */
export type Landing = {
  readonly before: string | null
  readonly after: readonly string[]
  readonly marker: Marker
  readonly words: string
}

/**
 * What letting a held sibling go at a slot does, so that it lands where it
 * was dropped. The slot is where it would be drawn, counted in the list
 * without it. Over the ranked siblings, which are drawn first, it goes in
 * front of the one at the slot. Among the unranked ones, the siblings drawn
 * above the slot are ranked first, in their drawn order, and it right after
 * them. An entry that cannot be ranked, a section no main worktree with a
 * session heads, stands after every ranked one, so it can only be passed
 * over, and the held one lands right after the last one ranked before it: the
 * line is drawn where it lands and the words say beside what. Null when the
 * drop would draw nothing new, which writes nothing either.
 */
export function landingAt<A>({ list, entries, held, slot, idOf, pathOf, rankOf, nameOf }: {
  readonly list: string
  /** The drawn list, in its order, the held entry included. */
  readonly entries: readonly A[]
  readonly held: A
  readonly slot: number
  readonly idOf: (entry: A) => string
  /** The worktree an entry is ranked as, which a placement names; null for one that cannot be ranked. */
  readonly pathOf: (entry: A) => string | null
  readonly rankOf: (entry: A) => number | null
  readonly nameOf: (entry: A) => string
}): Landing | null {
  const others = entries.filter((entry) => entry !== held)
  const rankedCount = others.filter((entry) => rankOf(entry) !== null).length
  if (slot < rankedCount) {
    const target = others[slot]!
    if (sameOrder([...others.slice(0, slot), held, ...others.slice(slot)], entries)) return null
    return {
      before: pathOf(target),
      after: [],
      marker: { list, id: idOf(target), side: 'before' },
      words: `Before ${nameOf(target)}`,
    }
  }
  const above = others.slice(rankedCount, slot).filter((entry) => pathOf(entry) !== null)
  const ranking = new Set(above)
  const rest = others.slice(rankedCount).filter((entry) => !ranking.has(entry))
  const landing = [...others.slice(0, rankedCount), ...above, held, ...rest]
  if (sameOrder(landing, entries)) return null
  const previous = landing[landing.indexOf(held) - 1]
  const [first] = entries
  if (previous === undefined) {
    return first === undefined ? null : { before: null, after: [], marker: { list, id: idOf(first), side: 'before' }, words: 'First' }
  }
  return {
    before: null,
    after: above.flatMap((entry) => pathOf(entry) ?? []),
    marker: { list, id: idOf(previous), side: 'after' },
    words: `After ${nameOf(previous)}`,
  }
}
