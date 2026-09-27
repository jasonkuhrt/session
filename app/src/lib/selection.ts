import * as React from 'react'

import type { Session } from '../../contract'
import type { Dashboard } from './dashboard'
import { laneItems, lanesOf } from './lanes'

/**
 * The selection: the one card the keys act on, which the page rings. A page's
 * cards stand in columns, a board's lanes or the index's sections, each read
 * the way the page draws it, top to bottom. `j` and `k` step within a column,
 * and `h` and `l` to the nearest column either side that holds a card, at the
 * same place in it or at its last card. With nothing selected, or with a
 * selection the page no longer draws, any step selects the first card of the
 * first column that holds one. The selection is kept by its card's id, so it
 * follows a card that moves, and a card that has gone takes it with it.
 */

/** A step of the selection, named for the keys that take it. */
export type Step = 'next' | 'previous' | 'left' | 'right'

type Columns = ReadonlyArray<ReadonlyArray<string>>

/**
 * A board's columns: each lane's items, by id, in the order the lane draws
 * them, a group's items in its place; none until the session has been read.
 */
export const boardColumns = (session: Session | null): string[][] =>
  session === null ? [] : lanesOf(session.stages).map((lane) => laneItems(lane).map((item) => item.id))

/**
 * The index's columns: each section's worktrees, by path, in the order it
 * draws them, its head first while a main worktree with a session heads it,
 * then each card's worktrees; none until the rows have been read.
 */
export const indexColumns = (dashboard: Dashboard | null): string[][] =>
  (dashboard?.sections ?? []).map((section) =>
    (section.kind === 'project' && section.head.kind === 'tracked' ? [section.head.row.path] : []).concat(
      section.cards.flatMap((card) => (card.kind === 'epic' ? card.rows.map((row) => row.path) : [card.row.path])),
    )
  )

/** Where a card stands: its column and its place in it; null when no column holds it. */
const placeOf = ({ columns, id }: { readonly columns: Columns; readonly id: string | null }) => {
  if (id === null) return null
  for (const [column, cards] of columns.entries()) {
    const row = cards.indexOf(id)
    if (row !== -1) return { column, row }
  }
  return null
}

/**
 * A page's selection over its columns: the card the keys act on, by id, for
 * as long as the page draws it, and the way to select another.
 */
export function useSelection(columns: Columns) {
  const [id, select] = React.useState<string | null>(null)
  return { selected: placeOf({ columns, id }) === null ? null : id, select }
}

/** The nearest column from `from` in the direction `by` that holds a card, or null past the last. */
const nearestHolding = ({ columns, from, by }: { readonly columns: Columns; readonly from: number; readonly by: 1 | -1 }) => {
  for (let column = from + by; column >= 0 && column < columns.length; column += by) {
    if ((columns[column]?.length ?? 0) > 0) return column
  }
  return null
}

/** The card a step selects: the card it reaches, or the one selected when there is nowhere further to go. */
export function stepped({ columns, selected, step }: {
  readonly columns: Columns
  readonly selected: string | null
  readonly step: Step
}): string | null {
  const place = placeOf({ columns, id: selected })
  if (place === null) return columns.find((cards) => cards.length > 0)?.[0] ?? null
  const cards = columns[place.column] ?? []
  if (step === 'next') return cards[place.row + 1] ?? selected
  if (step === 'previous') return cards[place.row - 1] ?? selected
  const column = nearestHolding({ columns, from: place.column, by: step === 'left' ? -1 : 1 })
  if (column === null) return selected
  const reached = columns[column] ?? []
  return reached[Math.min(place.row, reached.length - 1)] ?? selected
}

/** Whether a page has anywhere for a step to go: a card to select, and for a step across, two columns holding cards. */
export const canStep = ({ columns, step }: { readonly columns: Columns; readonly step: Step }) => {
  const holding = columns.filter((cards) => cards.length > 0).length
  return step === 'next' || step === 'previous' ? holding > 0 : holding > 1
}

/**
 * The ring the selection is drawn with, in the theme's ring token, on the
 * element a page marks `data-selected="true"`, which is what the preset's
 * `data-selected` variant reads: around a card, or inside a row that sits in
 * a card, whose edge would clip a ring drawn outside it.
 */
export const selectionRing = 'data-selected:ring-2 data-selected:ring-ring'
export const selectionRingInside = `${selectionRing} data-selected:ring-inset`
