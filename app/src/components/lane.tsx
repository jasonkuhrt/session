import { CollisionPriority } from '@dnd-kit/abstract'
import { useDroppable } from '@dnd-kit/react'

import type { Stage } from '../../contract'
import type { Dragging, Lane as LaneLayout } from '../lib/lanes'
import { listId } from '../lib/lanes'
import { cn } from '../lib/utils'
import { stageHint } from '../lib/workflow'
import { Node } from '../substrate/node'
import type { Path } from '../substrate/seam'
import { LaneList } from './lane-list'
import { useTip } from './tip'
import { Separator } from './ui/separator'
import type { CardActions } from './workflow-card'

/**
 * One worktree's part of a lane: the board its writes go to, the key it is
 * served under, which its nodes go by, and its entries in the lane as they
 * are drawn.
 */
export type LanePart = {
  readonly board: string
  readonly key: string
  readonly name: string
  readonly lane: LaneLayout
}

/** Where each node of a board is in the tree, which the board's owner says. */
export type PathsOf = {
  readonly stage: (stage: Stage) => Path
  readonly part: (input: { readonly key: string; readonly stage: Stage }) => Path
  readonly group: (input: { readonly key: string; readonly stage: Stage; readonly name: string }) => Path
  readonly item: (input: { readonly key: string; readonly stage: Stage; readonly group: string | null; readonly id: string }) => Path
}

/**
 * A part of a lane that takes a card into the lane itself, in no group, on
 * one worktree's board. The heading takes it to the lane's start and the
 * space below the last entry to its end; both rank with a group, so the
 * pointer over them outweighs a card the held card merely overlaps. The rest
 * of the part ranks below everything and places a card by which half of it
 * the card is over.
 */
function useLaneDrop({ board, stage, at, accepts, pending }: Pick<CardActions, 'accepts' | 'pending'> & {
  board: string
  stage: Stage
  at: 'start' | 'end' | 'half'
}) {
  return useDroppable({
    id: `lane-${at}:${listId({ board, stage, group: null })}`,
    type: 'lane',
    data: { board, stage, group: null, at },
    accept: (source) => accepts(source.id, { board, stage, group: null }),
    collisionPriority: at === 'half' ? CollisionPriority.Lowest : CollisionPriority.Normal,
    disabled: pending,
  })
}

/**
 * One stage's lane of a worktree's board, whole: a column under its heading,
 * which takes a card to its start, then its entries.
 */
export function Lane({ part, stage, dragging, paths, ...actions }: CardActions & {
  part: LanePart
  stage: Stage
  dragging: Dragging | null
  paths: PathsOf
}) {
  const { ref: wholeRef } = useLaneDrop({ ...actions, board: part.board, stage, at: 'half' })
  const { ref: startRef } = useLaneDrop({ ...actions, board: part.board, stage, at: 'start' })
  const { ref: endRef } = useLaneDrop({ ...actions, board: part.board, stage, at: 'end' })
  return (
    <section ref={wholeRef} aria-label={stage} className="flex min-w-0 flex-col gap-2">
      <LaneHeading path={paths.stage(stage)} stage={stage} nodeRef={startRef} />
      <LaneList {...actions} part={part} stage={stage} dragging={dragging} paths={paths} endRef={endRef} className="min-h-24" endClassName="h-16" />
    </section>
  )
}

/**
 * One worktree's part of a lane on an epic's or a project's board, where each
 * worktree stands in a row across the lanes under its name: a node of its
 * own, the worktree at that stage, whose entries are its own worktree's alone,
 * so a card is placed only among its own worktree's cards. It holds its
 * cards, so a click on its own space only takes the focus, and the name at
 * the row's left edge is the link to the worktree's board. A rule stands
 * between one worktree's row and the next; the first stands under the lanes'
 * headings, which have one of their own.
 */
export function PartOfLane({ part, stage, dragging, paths, ruled, ...actions }: CardActions & {
  part: LanePart
  stage: Stage
  dragging: Dragging | null
  paths: PathsOf
  /** Whether a rule stands above the part, as it does above every worktree's row but the first. */
  ruled: boolean
}) {
  const { ref: wholeRef } = useLaneDrop({ ...actions, board: part.board, stage, at: 'half' })
  const { ref: endRef } = useLaneDrop({ ...actions, board: part.board, stage, at: 'end' })
  return (
    <Node path={paths.part({ key: part.key, stage })} holds nodeRef={wholeRef} className={cn('min-w-0 py-2', ruled && 'border-t')}>
      <LaneList {...actions} part={part} stage={stage} dragging={dragging} paths={paths} endRef={endRef} className="min-h-8" endClassName="h-4" />
    </Node>
  )
}

/**
 * A lane's heading: the stage's name as a muted label, a node the focus can be
 * on, with what the stage is for as its tip, over the rule the lane's column
 * stands under.
 */
export function LaneHeading({ path, stage, nodeRef }: { path: Path; stage: Stage; nodeRef?: ((element: Element | null) => void) | undefined }) {
  const tip = useTip()
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Node path={path} nodeRef={nodeRef} className="px-2.5 py-1 text-sm font-medium text-muted-foreground">
        <span title={tip(stageHint[stage])}>{stage}</span>
      </Node>
      <Separator />
    </div>
  )
}
