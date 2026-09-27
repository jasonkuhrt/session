import { isKeyboardEvent } from '@dnd-kit/dom/utilities'
import type { DragOverEvent } from '@dnd-kit/react'
import { DragDropProvider } from '@dnd-kit/react'
import * as React from 'react'

import type { Item, Stage } from '../../contract'
import { stageNames } from '../../contract'
import { dragSensors, pointerOf } from '../lib/drag'
import type { Aim, Drawn, Held } from '../lib/held'
import { aimOf, itemIn, ownDrawn, sameOver, samePlacement } from '../lib/held'
import type { Dragging, Lane as LaneLayout, Placement } from '../lib/lanes'
import { cardId, lanesOf, moved, moveWords, newGroupWords, placementOf } from '../lib/lanes'
import { moveAvailability } from '../lib/workflow'
import type { LaneActions, LanePart } from './lane'
import { Lane, LaneHeading, PartOfLane } from './lane'
import { TooltipProvider } from './ui/tooltip'
import type { DropTarget } from './workflow-card'

/** One worktree's part of a board: the board its session is served under, the worktree's name, and its session as drawn. */
export type BoardPart = { readonly board: string; readonly name: string; readonly session: Drawn }

/** A card dropped on another in no group of its own lane: the two a group is to be made of, the one dropped on first, on their worktree's board. */
type GroupDrop = { readonly board: string; readonly stage: Stage; readonly onto: Item; readonly held: Item }

type BoardProps = Omit<LaneActions, 'accepts'> & {
  readonly parts: readonly BoardPart[]
  /**
   * Whether each lane draws every worktree's part under its name, as an epic's
   * board and a project's do; a worktree's board draws its one worktree's
   * lanes whole.
   */
  readonly grouped: boolean
  /** Moves a card within its own worktree's session, against the revision it was drawn on; resolves once the move is written or refused. */
  readonly onMove: (board: string, id: string, placement: Placement, revision: string) => Promise<boolean>
  /** Asks for the name of a group of two cards, one dropped on the other. */
  readonly onGroupDrop: (drop: GroupDrop) => void
  readonly onDraggingChange: (dragging: boolean) => void
}

/** A card as the board finds it by the name the drag library knows it by: its worktree's board, the item, and its stage. */
type Card = { readonly board: string; readonly item: Item; readonly stage: Stage }

/** How many items a worktree's stage holds as drawn, which a drag under way does not change. */
const countOf = (session: Drawn | undefined, stage: Stage) => session?.stages.find(file => file.stage === stage)?.items.length ?? 0

/** Whether a worktree's Execute holds a batch under way, which Queue's start waits for. */
const executeOccupied = (session: Drawn | undefined) => session?.stages.some(stage => stage.stage === 'Execute' && stage.items.length > 0) ?? false

/** Every card of every worktree drawn, by the name the drag library knows it by. */
function cardsOf(shown: ReadonlyMap<string, Drawn>): ReadonlyMap<string, Card> {
  const cards = new Map<string, Card>()
  for (const [board, session] of shown) {
    for (const stage of session.stages) {
      for (const item of stage.items) cards.set(cardId({ board, id: item.id }), { board, item, stage: stage.stage })
    }
  }
  return cards
}

/**
 * A worktree's lanes as the board draws them: as its files were at pickup
 * while a card is held, with the held card moved where it would land, if it is
 * this worktree's and has moved at all, so picking a card up never moves
 * anything under the pointer.
 */
function lanesDrawn({ shown, board, held }: {
  readonly shown: ReadonlyMap<string, Drawn>
  readonly board: string
  readonly held: Held | null
}): LaneLayout[] {
  const lanes = lanesOf(shown.get(board)?.stages ?? [])
  return held === null || held.board !== board || samePlacement({ left: held.placement, right: held.origin })
    ? lanes
    : moved({ lanes, id: held.id, placement: held.placement })
}

/** The held card as the lanes draw it: where a drop would land, or the card it would make a group with, and its words. */
function draggingOf(held: Held | null): Dragging | null {
  if (held === null) return null
  const { over } = held
  // Where a drop would land: over a heading, the group's end, not where the card is drawn.
  const landing = over?.kind === 'heading' ? over.placement : held.placement
  return {
    board: held.board,
    id: held.id,
    landing: over?.kind === 'card' ? null : landing,
    onto: over?.kind === 'card' ? over.id : null,
    words: over?.kind === 'card'
      ? newGroupWords(itemIn({ stages: ownDrawn(held)?.stages ?? [], id: over.id })?.item.title ?? over.id)
      : moveWords({ origin: held.origin, placement: landing }),
    keyboard: held.keyboard,
  }
}

export function Board({ parts, grouped, onMove, onGroupDrop, onDraggingChange, ...actions }: BoardProps) {
  const [held, setHeld] = React.useState<Held | null>(null)
  // The hover that chose a placement can be newer than the last render, and
  // the drop must act on what the board was about to show.
  const latest = React.useRef<Held | null>(null)
  const hold = (next: Held | null) => {
    latest.current = next
    setHeld(next)
  }
  // While a card is held every worktree is drawn as it was at pickup.
  const shown: ReadonlyMap<string, Drawn> = held?.drawn ?? new Map(parts.map(part => [part.board, part.session]))
  const drawn = (board: string, current: Held | null) => lanesDrawn({ shown, board, held: current })
  const cards = cardsOf(shown)
  const cardOf = (id: unknown) => (typeof id === 'string' ? cards.get(id) ?? null : null)

  // A card moves only among its own worktree's lanes, since its session is the
  // one a move writes. Execute is entered only by starting the next queued
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

  /** What the held card is aimed at now, in its own worktree's lanes as drawn. */
  const aimFor = (current: Held, operation: DragOverEvent['operation'], pointer?: ReturnType<typeof pointerOf>): Aim =>
    aimOf({ current, operation, pointer, lanes: drawn(current.board, current), cardOf })

  /**
   * Takes what the held card is aimed at: what it is over, or a new
   * placement, each when the rules allow it. Anything but something to be
   * over leaves what it was over.
   */
  const take = (current: Held, aim: Aim) => {
    const allowed = (placement: Placement) =>
      accepts(cardId({ board: current.board, id: current.id }), { board: current.board, stage: placement.to, group: placement.group })
    const over = aim?.kind === 'over' && (aim.over.kind === 'card' || allowed(aim.over.placement)) ? aim.over : null
    const next = aim?.kind === 'place' && allowed(aim.placement) ? aim.placement : current.placement
    if (sameOver({ left: over, right: current.over }) && samePlacement({ left: next, right: current.placement })) return
    hold({ ...current, placement: next, over })
  }

  /** The drag is over: the files are drawn again as they are read, and reads go on. */
  const letGo = () => {
    setHeld(null)
    onDraggingChange(false)
  }

  const dragging = draggingOf(held)

  /** One worktree's part of a lane, as it is drawn now. */
  const partOf = (part: BoardPart, stage: Stage): LanePart => ({
    board: part.board,
    name: part.name,
    lane: drawn(part.board, held).find(lane => lane.stage === stage) ?? { stage, entries: [] },
    count: countOf(shown.get(part.board), stage),
    executeOccupied: executeOccupied(shown.get(part.board)),
  })

  return (
    <TooltipProvider>
      <DragDropProvider
        sensors={dragSensors}
        onDragStart={event => {
          const card = cardOf(event.operation.source?.id)
          const origin = card === null ? null : placementOf({ lanes: drawn(card.board, null), id: card.item.id })
          const keyboard = isKeyboardEvent(event.operation.activatorEvent)
          if (card !== null && origin !== null) {
            hold({ board: card.board, id: card.item.id, drawn: shown, origin, placement: origin, over: null, keyboard })
          }
          onDraggingChange(true)
        }}
        onDragOver={event => {
          // The board draws every card where the files would put it, so the
          // sortable's own plugin must not move cards in the DOM behind React:
          // a card it had moved to another list would be one React no longer
          // finds when it next draws that list.
          event.preventDefault()
          const current = latest.current
          if (current !== null) take(current, aimFor(current, event.operation))
        }}
        onDragMove={event => {
          // The held card is placed by where it is, not only by what it has
          // just reached, so moving it across one card still moves its slot.
          // The move itself is not prevented: that would stop the card.
          const current = latest.current
          if (current !== null) take(current, aimFor(current, event.operation, pointerOf(event)))
        }}
        onDragEnd={event => {
          const current = latest.current
          // Hovers stop counting at the drop; what is drawn stays until the
          // move is written, so the card does not jump back while it is.
          latest.current = null
          const own = current === null ? null : ownDrawn(current)
          if (event.canceled || current === null || own === null) {
            letGo()
            return
          }
          if (current.over?.kind === 'card') {
            // Dropped onto a card, it moves nothing: the two are named as a
            // group in the dialog, from the cards as they were drawn.
            const onto = itemIn({ stages: own.stages, id: current.over.id })
            const dropped = itemIn({ stages: own.stages, id: current.id })
            letGo()
            if (onto !== null && dropped !== null) onGroupDrop({ board: current.board, stage: onto.stage, onto: onto.item, held: dropped.item })
            return
          }
          // Dropped on a heading it stood above, it is drawn at the group's end from now on.
          const placement = current.over?.kind === 'heading' ? current.over.placement : current.placement
          if (samePlacement({ left: placement, right: current.origin })) {
            letGo()
            return
          }
          setHeld({ ...current, placement, over: null })
          void onMove(current.board, current.id, placement, own.revision).finally(letGo)
        }}
      >
        {grouped ? (
          // Every lane's heading, then a row per worktree: its part of each
          // lane, under its name, so its work reads across its stages.
          <div className="grid min-w-300 grid-cols-5 items-start gap-x-4 gap-y-6">
            {stageNames.map(stage => (
              <LaneHeading key={stage} stage={stage} count={parts.reduce((sum, part) => sum + countOf(shown.get(part.board), stage), 0)} />
            ))}
            {parts.flatMap(part => stageNames.map(stage => (
              <PartOfLane key={`${part.board} ${stage}`} {...actions} part={partOf(part, stage)} stage={stage} dragging={dragging} accepts={accepts} />
            )))}
          </div>
        ) : (
          // A worktree's board is its one worktree's lanes, each whole.
          <div className="grid min-w-300 grid-cols-5 items-start gap-4">
            {parts.slice(0, 1).flatMap(part => stageNames.map(stage => (
              <Lane key={stage} {...actions} part={partOf(part, stage)} stage={stage} dragging={dragging} accepts={accepts} />
            )))}
          </div>
        )}
      </DragDropProvider>
    </TooltipProvider>
  )
}
