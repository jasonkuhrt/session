import { CollisionPriority } from '@dnd-kit/abstract'
import { pointerIntersection } from '@dnd-kit/collision'
import { useDroppable } from '@dnd-kit/react'
import { Plus } from 'lucide-react'

import type { WorktreeSummary } from '../../contract'
import type { Dashboard } from '../lib/dashboard'
import { epicCardsOf } from '../lib/dashboard'
import { landing } from '../lib/drag'
import type { Dragged } from '../lib/epics'
import { targetId } from '../lib/epics'
import { cn } from '../lib/utils'
import { idOf, rootId } from '../levels'
import { Node } from '../substrate/node'
import { HeldWords } from './held-words'
import type { StageRange } from '../lib/dashboard'
import type { Marker } from '../lib/order'
import type { Signals } from './marks'
import { useTip } from './tip'

/** The index outline's rows that stand apart from a project's: the `+` a held worktree starts an epic on, a refused path, and the held copy. */

/** The columns a row lines up in: its name, the glyph, and the marks, the same in every row. */
export const rowGrid = 'grid grid-cols-[minmax(0,1fr)_1.75rem_minmax(3.5rem,auto)] items-center gap-x-3 px-2 py-1.5'

/** What every row needs besides itself: each worktree's signals, the clock, the glyphs' range, and what a drag is doing. */
export type OutlineContext = {
  readonly rows: readonly WorktreeSummary[]
  readonly signalsOf: (row: WorktreeSummary) => Signals
  readonly now: number
  readonly stageRange: StageRange
  readonly writing: boolean
  /** The target a held row would land in if it were dropped now, by its id. */
  readonly landingOn: string | null
  /** Where a held project or worktree would take its place if it were dropped now. */
  readonly marker: Marker | null
}

/** Where a held worktree starts an epic of its own, drawn after its project's rows only while one is held. */
export function NewEpicTarget({ name, context }: { name: string; context: OutlineContext }) {
  const onto = targetId({ kind: 'new' })
  const { ref } = useDroppable({ id: onto, accept: 'row', collisionDetector: pointerIntersection, collisionPriority: CollisionPriority.Normal, disabled: context.writing })
  const tip = useTip()
  return (
    <div
      ref={ref}
      title={tip(`New epic of ${name}`)}
      className={cn('ml-4 flex h-8 items-center justify-center rounded-md border border-dashed text-muted-foreground', context.landingOn === onto && landing)}
    >
      <Plus aria-hidden className="size-4" />
    </div>
  )
}

/** A path the daemon holds that Git did not answer for: a dim row at the end, in no project. */
export function RefusedRow({ row }: { row: WorktreeSummary }) {
  const tip = useTip()
  return (
    <Node path={[rootId, idOf({ kind: 'worktree', path: row.path })]} className={cn(rowGrid, 'opacity-50')}>
      <span className="min-w-0 truncate font-mono text-xs" title={tip(`Git did not answer for ${row.path}.`)}>{row.path}</span>
      <span />
      <span className="justify-self-end font-mono text-xs font-semibold text-muted-foreground" title={tip(row.conflict ?? 'Git gave no reason.')}>!</span>
    </Node>
  )
}

/** What the pointer carries: a plain copy of the row held, with the words of what dropping it there would do. */
export function HeldCopy({ dragged, dashboard, context, words }: {
  dragged: Dragged | null
  dashboard: Dashboard
  context: OutlineContext
  words: string | null
}) {
  if (dragged === null) return null
  const name = dragged.kind === 'epic'
    ? epicCardsOf(dashboard).find((card) => card.name === dragged.name)?.name
    : context.rows.find((row) => row.path === dragged.path)?.name
  if (name === undefined) return null
  return (
    <div className="relative max-w-md rounded-md border bg-card px-2 py-1.5 text-sm shadow-lg">
      <HeldWords words={words} />
      {name}
    </div>
  )
}
