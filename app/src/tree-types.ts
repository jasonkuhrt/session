import type { Item, Session, WorktreeSummary } from '../contract'
import type { Signals } from './components/marks'
import type { UnionFilter } from './lib/filter'
import type { RecordPage } from './levels'
import type { Fact } from './substrate/seam'

/**
 * What session's tree is built from and speaks of: the address a view is at,
 * the entries a page draws, and what a view hands the tree.
 */

/** Which board an item's page sits under: its worktree's own, or the epic's or project's board it was opened from. */
type Via = 'epic' | 'project' | null

/** The address a view is at, as its route decodes it. */
export type Place =
  | { readonly kind: 'index' }
  | { readonly kind: 'board'; readonly key: string }
  | { readonly kind: 'union'; readonly filter: UnionFilter }
  | { readonly kind: 'item'; readonly key: string; readonly id: string; readonly via: Via }
  | { readonly kind: 'listing'; readonly key: string; readonly page: Exclude<RecordPage, 'file'> }
  | { readonly kind: 'file'; readonly key: string; readonly path: string }
  | { readonly kind: 'union-ledger'; readonly filter: UnionFilter }

/** One node of a page, as its view draws it: where it is among the page's nodes, what it reads as, and its facts. */
export type Entry = {
  readonly at: string
  readonly heading: string
  readonly facts: readonly Fact[]
}

/** What a view hands the tree: every row, the sessions it has read by worktree key, its page's entries, and each worktree's signals. */
export type TreeData = {
  readonly rows: readonly WorktreeSummary[]
  readonly now: number
  readonly sessions: ReadonlyMap<string, Session>
  /** An item the page reads that no stage holds, as an archived item's page does. */
  readonly archived: { readonly key: string; readonly item: Item } | null
  /** The entries of the page drawn, by the id of the node they are in. */
  readonly entries: ReadonlyMap<string, readonly Entry[]>
  readonly signalsOf: (row: WorktreeSummary) => Signals
}

/** The id a body with no section gives the one node its page draws. */
export const bodyAt = 'body'
