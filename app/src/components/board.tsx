import type { DragOverEvent } from '@dnd-kit/react'
import { DragDropProvider } from '@dnd-kit/react'
import * as React from 'react'

import type { Item, Stage, StageFile } from '../../contract'
import { stageNames } from '../../contract'
import { dragSensors, pointerOf } from '../lib/drag'
import type { Lane as LaneLayout, Placement } from '../lib/lanes'
import { cardId, isInList, lanesOf, moved, placementInto, placementOf, placementOver } from '../lib/lanes'
import { isStage, moveAvailability } from '../lib/workflow'
import type { LaneActions, LanePart } from './lane'
import { Lane, LaneHeading, PartOfLane } from './lane'
import { TooltipProvider } from './ui/tooltip'
import type { DropTarget } from './workflow-card'

/** One worktree's part of a board: the board its session is served under, the worktree's name, and its stages as the files hold them. */
export type BoardPart = { readonly board: string; readonly name: string; readonly stages: readonly StageFile[] }

type BoardProps = Omit<LaneActions, 'accepts'> & {
  readonly parts: readonly BoardPart[]
  /**
   * Whether each lane draws every worktree's part under its name, as an epic's
   * board and a project's do; a worktree's board draws its one worktree's
   * lanes whole.
   */
  readonly grouped: boolean
  /** Moves a card within its own worktree's session; resolves once the move is written or refused. */
  readonly onMove: (board: string, id: string, placement: Placement) => Promise<boolean>
  readonly onDraggingChange: (dragging: boolean) => void
}

/**
 * A card being dragged: the board of the worktree it is filed in, where it was
 * when the drag began, and where it would land if it were dropped now.
 */
type Held = { readonly board: string; readonly id: string; readonly origin: Placement; readonly placement: Placement }

/** A card as the board finds it by the name the drag library knows it by: its worktree's board, the item, and its stage. */
type Card = { readonly board: string; readonly item: Item; readonly stage: Stage }

/** How many items a worktree's stage holds on disk, which a drag under way does not change. */
const countOf = (part: BoardPart, stage: Stage) => part.stages.find(file => file.stage === stage)?.items.length ?? 0

/** Whether a worktree's Execute holds a batch under way, which Queue's start waits for. */
const executeOccupied = (part: BoardPart) => part.stages.some(stage => stage.stage === 'Execute' && stage.items.length > 0)

const samePlacement = (left: Placement, right: Placement) =>
  left.to === right.to && left.group === right.group && left.beforeId === right.beforeId &&
  left.beforeGroup === right.beforeGroup

export function Board({ parts, grouped, onMove, onDraggingChange, ...actions }: BoardProps) {
  const committed = new Map(parts.map(part => [part.board, lanesOf(part.stages)]))
  const [held, setHeld] = React.useState<Held | null>(null)
  // The hover that chose a placement can be newer than the last render, and
  // the drop must act on what the board was about to show.
  const latest = React.useRef<Held | null>(null)
  const hold = (next: Held | null) => {
    latest.current = next
    setHeld(next)
  }
  // A card still where it was picked up is drawn from the files as they are,
  // so picking it up never moves anything under the pointer, and a held card
  // moves only among its own worktree's lanes.
  const drawn = (board: string, current: Held | null): LaneLayout[] => {
    const lanes = committed.get(board) ?? []
    return current === null || current.board !== board || samePlacement(current.placement, current.origin)
      ? lanes
      : moved({ lanes, id: current.id, placement: current.placement })
  }

  const cards = new Map<string, Card>()
  for (const part of parts) {
    for (const stage of part.stages) {
      for (const item of stage.items) cards.set(cardId({ board: part.board, id: item.id }), { board: part.board, item, stage: stage.stage })
    }
  }
  const cardOf = (id: unknown) => (typeof id === 'string' ? cards.get(id) ?? null : null)

  // A card moves only among its own worktree's lanes, since its session is
  // the one a move writes. Execute is entered only by starting the next queued
  // batch and Queue only by composing one in Batch, so neither takes a card
  // from elsewhere. A queued card may still move inside its own batch.
  const accepts = (id: unknown, target: DropTarget) => {
    const source = cardOf(id)
    if (source === null || source.board !== target.board) return false
    if (target.stage === 'Execute') return false
    if (target.stage === 'Queue') return source.stage === 'Queue' && target.group !== null && source.item.group === target.group
    if (source.stage === target.stage) return true
    return moveAvailability(source.item, source.stage, target.stage).enabled
  }

  /**
   * Where the held card would land for what it is over now, with the pointer
   * at `pointer`, or null to leave it where it is. Over a card it goes in
   * front of that card while its own centre is above the card's centre, and
   * after it once below. Over a group's heading or edge it joins the group, at
   * its start or its end by which half of the group it is over. Over the
   * lane's heading it leaves any group for the lane's start, over the space
   * below the lane's last entry for its end, and elsewhere over the lane by
   * which half of the lane it is over. Anything of another worktree's is
   * nowhere it can land.
   * A group it is already in changes nothing, so the gaps between the group's
   * cards are not places of their own.
   */
  const placementFor = (current: Held, operation: DragOverEvent['operation'], pointer?: ReturnType<typeof pointerOf>): Placement | null => {
    const { source, target } = operation
    if (source === null || target === null || target.id === source.id || target.shape === undefined) return null
    const lanes = drawn(current.board, current)
    const now = operation.position.current
    const centre = operation.shape?.current.center ?? now
    // The held card keeps its offset from the pointer, so its centre moves as the pointer does.
    const centreY = centre.y + (pointer ?? now).y - now.y
    const below = Math.round(centreY) > Math.round(target.shape.center.y)
    if (target.type === 'item') {
      const over = cardOf(target.id)
      if (over === null || over.board !== current.board) return null
      return placementOver({ lanes, heldId: current.id, overId: over.item.id, below })
    }
    if (target.type !== 'group' && target.type !== 'lane') return null
    if (target.data['board'] !== current.board) return null
    const stage: unknown = target.data['stage']
    const group: unknown = target.data['group']
    if (!isStage(stage)) return null
    const into = typeof group === 'string' ? group : null
    if (target.type === 'group' && isInList({ lanes, id: current.id, stage, group: into })) return null
    // The lane's heading is its start and the space below its last entry its end.
    const at: unknown = target.data['at']
    const atStart = at === 'start' || (at !== 'end' && !below)
    return placementInto({ lanes, heldId: current.id, stage, group: into, atStart })
  }

  /** One worktree's part of a lane, as it is drawn now. */
  const partOf = (part: BoardPart, stage: Stage): LanePart => ({
    board: part.board,
    name: part.name,
    lane: drawn(part.board, held).find(lane => lane.stage === stage) ?? { stage, entries: [] },
    count: countOf(part, stage),
    executeOccupied: executeOccupied(part),
  })
  const heldPlacement = held === null ? null : { board: held.board, placement: held.placement }

  /** Takes a new placement for the held card, when it is one and the rules allow it. */
  const place = (current: Held, next: Placement | null) => {
    if (next === null || samePlacement(next, current.placement)) return
    if (!accepts(cardId({ board: current.board, id: current.id }), { board: current.board, stage: next.to, group: next.group })) return
    hold({ ...current, placement: next })
  }

  return (
    <TooltipProvider>
      <DragDropProvider
        sensors={dragSensors}
        onDragStart={event => {
          const card = cardOf(event.operation.source?.id)
          const origin = card === null ? null : placementOf({ lanes: committed.get(card.board) ?? [], id: card.item.id })
          if (card !== null && origin !== null) hold({ board: card.board, id: card.item.id, origin, placement: origin })
          onDraggingChange(true)
        }}
        onDragOver={event => {
          // The board draws every card where the files would put it, so the
          // sortable's own plugin must not move cards in the DOM behind React:
          // a card it had moved to another list would be one React no longer
          // finds when it next draws that list.
          event.preventDefault()
          const current = latest.current
          if (current !== null) place(current, placementFor(current, event.operation))
        }}
        onDragMove={event => {
          // The held card is placed by where it is, not only by what it has
          // just reached, so moving it across one card still moves its slot.
          // The move itself is not prevented: that would stop the card.
          const current = latest.current
          if (current !== null) place(current, placementFor(current, event.operation, pointerOf(event)))
        }}
        onDragEnd={event => {
          const current = latest.current
          // Hovers stop counting at the drop; what is drawn stays until the
          // move is written, so the card does not jump back while it is.
          latest.current = null
          if (event.canceled || current === null || samePlacement(current.placement, current.origin)) {
            setHeld(null)
            onDraggingChange(false)
            return
          }
          void onMove(current.board, current.id, current.placement).finally(() => {
            setHeld(null)
            onDraggingChange(false)
          })
        }}
      >
        {grouped ? (
          // Every lane's heading, then a row per worktree: its part of each
          // lane, under its name, so its work reads across its stages.
          <div className="grid min-w-300 grid-cols-5 items-start gap-x-4 gap-y-6">
            {stageNames.map(stage => (
              <LaneHeading key={stage} stage={stage} count={parts.reduce((sum, part) => sum + countOf(part, stage), 0)} />
            ))}
            {parts.flatMap(part => stageNames.map(stage => (
              <PartOfLane key={`${part.board} ${stage}`} {...actions} part={partOf(part, stage)} stage={stage} held={heldPlacement} accepts={accepts} />
            )))}
          </div>
        ) : (
          // A worktree's board is its one worktree's lanes, each whole.
          <div className="grid min-w-300 grid-cols-5 items-start gap-4">
            {parts.slice(0, 1).flatMap(part => stageNames.map(stage => (
              <Lane key={stage} {...actions} part={partOf(part, stage)} stage={stage} held={heldPlacement} accepts={accepts} />
            )))}
          </div>
        )}
      </DragDropProvider>
    </TooltipProvider>
  )
}
