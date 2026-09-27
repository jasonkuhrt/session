import { CollisionPriority } from '@dnd-kit/abstract'
import { useDroppable } from '@dnd-kit/react'
import { Link } from '@tanstack/react-router'
import type * as React from 'react'

import type { Stage } from '../../contract'
import { isBatchedStage } from '../../contract'
import { toBoard } from '../lib/base'
import type { Dragging, Lane as LaneLayout } from '../lib/lanes'
import { listId } from '../lib/lanes'
import { cn } from '../lib/utils'
import { stageHint } from '../lib/workflow'
import { ChooseEntries, LaneControls } from './lane-controls'
import { chosenIn, LaneList } from './lane-list'
import { Explained, useTip } from './tip'
import { Badge } from './ui/badge'
import type { CardActions, Choosing } from './workflow-card'
import { WorktreeMark } from './worktree-marks'

/**
 * What a lane can do with its cards, besides what each card does itself, each
 * on the board of the worktree it acts in, since a group, a batch and a start
 * are each one session's.
 */
export type LaneActions = CardActions & {
  readonly onChoose: (choosing: Choosing) => void
  readonly onGroup: (board: string, stage: Stage, ids: readonly string[]) => void
  readonly onQueue: (board: string, ids: readonly string[], group: string | null) => void
  readonly onUngroup: (board: string, ids: readonly string[]) => void
  readonly onStart: (board: string) => void
}

/**
 * One worktree's part of a lane: the board its writes go to, the worktree's
 * name, which its pages are addressed by, its entries in the lane as they are
 * drawn, how many items the stage holds on disk, which a drag under way does
 * not change, and whether its Execute is occupied.
 */
export type LanePart = {
  readonly board: string
  readonly name: string
  readonly lane: LaneLayout
  readonly count: number
  readonly executeOccupied: boolean
}

/**
 * A part of a lane that takes a card into the lane itself, in no group, on
 * one worktree's board. The heading takes it to the lane's start and the
 * space below the last entry to its end; both rank with a group, so the
 * pointer over them outweighs a card the held card merely overlaps. The rest
 * of the part ranks below everything and places a card by which half of it
 * the card is over.
 */
function useLaneDrop({ board, stage, at, accepts, pending }: Pick<LaneActions, 'accepts' | 'pending'> & {
  board: string
  stage: Stage
  at: 'start' | 'end' | 'half'
}) {
  return useDroppable({
    id: `lane-${at}:${listId({ board, stage, group: null })}`,
    type: 'lane',
    data: { board, stage, group: null, at },
    accept: source => accepts(source.id, { board, stage, group: null }),
    collisionPriority: at === 'half' ? CollisionPriority.Lowest : CollisionPriority.Normal,
    disabled: pending,
  })
}

/** Whether one worktree's part of a lane offers to choose its cards: in a lane where an item may be in no group, while it holds any, unless it is the one choosing. */
const offersChoice = ({ board, stage, count, choosing }: {
  board: string
  stage: Stage
  count: number
  choosing: Choosing
}) => !isBatchedStage(stage) && count > 0 && !(choosing?.board === board && choosing.stage === stage)

/**
 * One stage's lane of a worktree's board, whole: its heading and controls,
 * which take a card to its start, then its entries.
 */
export function Lane({ part, stage, dragging, ...actions }: LaneActions & { part: LanePart; stage: Stage; dragging: Dragging | null }) {
  const { board, lane, count, executeOccupied } = part
  const { ref: wholeRef } = useLaneDrop({ ...actions, board, stage, at: 'half' })
  const { ref: startRef } = useLaneDrop({ ...actions, board, stage, at: 'start' })
  const { ref: endRef } = useLaneDrop({ ...actions, board, stage, at: 'end' })
  return (
    <section ref={wholeRef} className="min-w-0 space-y-3">
      <div ref={startRef} className="space-y-3">
        <LaneHeading stage={stage} count={count}>
          {/* Choosing starts from the lane, named for what the chosen cards
              become, in the lanes where an item may be in no group. */}
          {offersChoice({ board, stage, count, choosing: actions.choosing })
            ? <ChooseEntries board={board} stage={stage} pending={actions.pending} onChoose={actions.onChoose} />
            : null}
        </LaneHeading>
        <LaneControls {...actions} board={board} stage={stage} chosen={chosenIn({ lane, chosenIds: actions.chosenIds })} count={count} executeOccupied={executeOccupied} />
      </div>
      <LaneList {...actions} part={part} stage={stage} dragging={dragging} endRef={endRef} className="min-h-32" endClassName="h-24" />
    </section>
  )
}

/**
 * One worktree's part of a lane on an epic's or a project's board, where each
 * lane holds every worktree's part under its name, so a batch and a group stay
 * whole and a card is placed only among its own worktree's cards: its name,
 * which takes a card to the start of its part and opens its own board, its own
 * ways into choosing and its own start, then its entries. A worktree's parts
 * stand in one row across the lanes, so its work reads across its stages and a
 * card moves straight across to another stage.
 */
export function PartOfLane({ part, stage, dragging, ...actions }: LaneActions & { part: LanePart; stage: Stage; dragging: Dragging | null }) {
  const { board, name, lane, count, executeOccupied } = part
  const { ref: wholeRef } = useLaneDrop({ ...actions, board, stage, at: 'half' })
  const { ref: startRef } = useLaneDrop({ ...actions, board, stage, at: 'start' })
  const { ref: endRef } = useLaneDrop({ ...actions, board, stage, at: 'end' })
  return (
    <div ref={wholeRef} className="min-w-0 space-y-2 border-t pt-3">
      <div ref={startRef} className="space-y-2">
        <PartHeading name={name}>
          {offersChoice({ board, stage, count, choosing: actions.choosing })
            ? <ChooseEntries board={board} stage={stage} pending={actions.pending} onChoose={actions.onChoose} />
            : null}
        </PartHeading>
        <LaneControls {...actions} board={board} stage={stage} chosen={chosenIn({ lane, chosenIds: actions.chosenIds })} count={count} executeOccupied={executeOccupied} />
      </div>
      <LaneList {...actions} part={part} stage={stage} dragging={dragging} endRef={endRef} className="min-h-10" endClassName="h-10" />
    </div>
  )
}

/** A lane's name and how many items it holds, and on a worktree's board the ways into choosing its cards. */
export function LaneHeading({ stage, count, children }: { stage: Stage; count: number; children?: React.ReactNode }) {
  const tip = useTip()
  return (
    <div className="flex items-center gap-2">
      {/* What the stage is for is one hover away rather than a line under
          every lane; the heading is what carries it. */}
      <h2 className="font-medium">
        <Explained meaning={stageHint[stage]}>{stage}</Explained>
      </h2>
      <Badge
        variant={count === 0 ? 'outline' : 'secondary'}
        className={cn(count === 0 && 'text-muted-foreground')}
        title={tip('How many items are in this stage.')}
      >
        {count}
      </Badge>
      <div className="ml-auto flex items-center gap-1">{children}</div>
    </div>
  )
}

/**
 * The name a worktree's part of a lane stands under, marked as a worktree is
 * everywhere, and the way to its own board, where its agents, its pull request
 * and its pages are.
 */
function PartHeading({ name, children }: { name: string; children?: React.ReactNode }) {
  const tip = useTip()
  return (
    // As tall as the controls beside it can be, so a worktree's name stands at one height across its row.
    <div className="flex min-h-6 items-center gap-2">
      <h3 className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
        <WorktreeMark />
        <Link
          {...toBoard(name)}
          className="min-w-0 rounded-sm font-medium wrap-anywhere text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          title={tip(`Open the board of ${name} alone, with its agents, its pull request and its pages.`)}
        >
          {name}
        </Link>
      </h3>
      <div className="ml-auto flex items-center gap-1">{children}</div>
    </div>
  )
}
