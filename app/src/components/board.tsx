import { isKeyboardEvent } from '@dnd-kit/dom/utilities'
import type { DragOverEvent } from '@dnd-kit/react'
import { DragDropProvider } from '@dnd-kit/react'
import * as React from 'react'

import type { Item, Stage, StageFile } from '../../contract'
import { isBatchedStage } from '../../contract'
import { dragSensors, pointerOf } from '../lib/drag'
import type { Dragging, Lane as LaneLayout, Placement } from '../lib/lanes'
import {
  isInList,
  laneOfLooseCard,
  lanesOf,
  moved,
  moveWords,
  newGroupWords,
  placementInto,
  placementOf,
  placementOver,
} from '../lib/lanes'
import { isStage, moveAvailability } from '../lib/workflow'
import type { LaneActions } from './lane'
import { Lane } from './lane'
import { TooltipProvider } from './ui/tooltip'
import type { DropTarget } from './workflow-card'

/** A card dropped on another in no group of its own lane: the two a group is to be made of, the one dropped on first. */
export type GroupDrop = { readonly stage: Stage; readonly onto: Item; readonly held: Item }

type BoardProps = Omit<LaneActions, 'accepts'> & {
  stages: StageFile[]
  /** The revision the stages were read at, which a drop made on them is written against. */
  revision: string
  /** Moves a card, against the revision it was drawn on; resolves once the move is written or refused. */
  onMove: (id: string, placement: Placement, revision: string) => Promise<boolean>
  /** Asks for the name of a group of two cards, one dropped on the other. */
  onGroupDrop: (drop: GroupDrop) => void
  onDraggingChange: (dragging: boolean) => void
}

/** The session as the board draws it: its stages, and the revision a drop made on them is written against. */
type Drawn = { readonly stages: readonly StageFile[]; readonly revision: string }

/**
 * A card being dragged: what the board drew when it was picked up, where the
 * card was then, where it would land if it were dropped now, and the card in
 * no group it would make a group with instead, if any.
 */
type Held = {
  readonly id: string
  /**
   * The session drawn at pickup, drawn for as long as the card is held and
   * its move is written, as the index draws its rows: a read that lands
   * meanwhile is drawn only after that.
   */
  readonly drawn: Drawn
  readonly origin: Placement
  readonly placement: Placement
  readonly onto: string | null
  /** Whether keys carry the card rather than the pointer. */
  readonly keyboard: boolean
}

/**
 * What the held card is over: a card it would make a group with, a place it
 * would go, or neither, which leaves it where it is drawn.
 */
type Aim = { readonly kind: 'onto'; readonly id: string } | { readonly kind: 'place'; readonly placement: Placement } | null

/** A place to go as the held card's aim, or none, which leaves it where it is drawn. */
const placeAt = (placement: Placement | null): Aim => (placement === null ? null : { kind: 'place', placement })

const samePlacement = (left: Placement, right: Placement) =>
  left.to === right.to && left.group === right.group && left.beforeId === right.beforeId &&
  left.beforeGroup === right.beforeGroup

const itemIn = (stages: readonly StageFile[], id: unknown) => {
  for (const stage of stages) {
    const item = stage.items.find(candidate => candidate.id === id)
    if (item) return { item, stage: stage.stage }
  }
  return null
}

/**
 * The share of a card, around its middle, that a held card's centre is onto
 * rather than before or after it: the middle half, so each edge still places
 * the held card beside it.
 */
const ontoShare = 0.5

/**
 * Whether the held card, over the card `overId`, is onto it: a card in no
 * group of the lane the held card is filed in, where the lane lets an item
 * be in no group, with the held card's centre over its middle half. There a
 * drop makes a group of the two, the way a card dropped on another on the
 * index makes an epic of them. Keys step a card from place to place,
 * landing on the middle of each card, so a card they carry is never onto one.
 */
function isOnto({ current, lanes, overId, centreY, top, height }: {
  readonly current: Held
  readonly lanes: readonly LaneLayout[]
  readonly overId: string
  readonly centreY: number
  readonly top: number
  readonly height: number
}) {
  const lane = laneOfLooseCard({ lanes, id: overId })
  if (current.keyboard || lane === null || lane !== current.origin.to || isBatchedStage(lane)) return false
  const edge = (height * (1 - ontoShare)) / 2
  return centreY > top + edge && centreY < top + height - edge
}

export function Board({ stages, revision, onMove, onGroupDrop, onDraggingChange, ...actions }: BoardProps) {
  const [held, setHeld] = React.useState<Held | null>(null)
  // The hover that chose a placement can be newer than the last render, and
  // the drop must act on what the board was about to show.
  const latest = React.useRef<Held | null>(null)
  const hold = (next: Held | null) => {
    latest.current = next
    setHeld(next)
  }
  const shown: Drawn = held?.drawn ?? { stages, revision }
  const committed = lanesOf(shown.stages)
  // A card still where it was picked up is drawn from the files as they were
  // then, so picking it up never moves anything under the pointer.
  const drawn = (current: Held | null): LaneLayout[] => {
    if (current === null) return committed
    const lanes = lanesOf(current.drawn.stages)
    return samePlacement(current.placement, current.origin) ? lanes : moved({ lanes, id: current.id, placement: current.placement })
  }

  // Execute is entered only by starting the next queued batch and Queue only by
  // composing one in Batch, so neither takes a card from elsewhere. A queued
  // card may still move inside its own batch.
  const accepts = (id: unknown, target: DropTarget) => {
    const source = itemIn(shown.stages, id)
    if (source === null) return false
    if (target.stage === 'Execute') return false
    if (target.stage === 'Queue') return source.stage === 'Queue' && target.group !== null && source.item.group === target.group
    if (source.stage === target.stage) return true
    return moveAvailability(source.item, source.stage, target.stage).enabled
  }

  /**
   * What the held card is over now, with the pointer at `pointer`. Over the
   * middle of a card in no group of its own lane it is onto that card, and a
   * drop there makes a group of the two. Otherwise, over a card it goes in
   * front of that card while its own centre is above the card's centre, and
   * after it once below. Over a group's heading it joins the group at its
   * end, and over its edge at its start or its end by which half of the group
   * it is over. Over the lane's heading it leaves any group for the lane's
   * start, over the space below the lane's last entry for its end, and
   * elsewhere over the lane by which half of the lane it is over. A group it
   * is already drawn in changes nothing, so the gaps between the group's
   * cards are not places of their own; only the heading still takes a card
   * from outside the group to its end.
   */
  const aimFor = (current: Held, operation: DragOverEvent['operation'], pointer?: ReturnType<typeof pointerOf>): Aim => {
    const { source, target } = operation
    if (source === null || target === null || target.id === source.id || target.shape === undefined) return null
    const lanes = drawn(current)
    const now = operation.position.current
    const centre = operation.shape?.current.center ?? now
    // The held card keeps its offset from the pointer, so its centre moves as the pointer does.
    const centreY = centre.y + (pointer ?? now).y - now.y
    if (target.type === 'item') {
      const overId = String(target.id)
      const { top, height } = target.shape.boundingRectangle
      if (isOnto({ current, lanes, overId, centreY, top, height })) return { kind: 'onto', id: overId }
      const below = Math.round(centreY) > Math.round(target.shape.center.y)
      return placeAt(placementOver({ lanes, heldId: current.id, overId, below }))
    }
    if (target.type !== 'group' && target.type !== 'lane') return null
    const stage: unknown = target.data['stage']
    const group: unknown = target.data['group']
    if (!isStage(stage)) return null
    const into = typeof group === 'string' ? group : null
    // A lane's heading is its start and the space below its last entry its
    // end; a group's heading is its end.
    const at: unknown = target.data['at']
    if (target.type === 'group' && isInList({ lanes, id: current.id, stage, group: into })) {
      // Over its heading, a card joins the group last, wherever the drag has
      // drawn it on the way there: only one of the group's own, still drawn
      // in it, changes nothing.
      const own = current.origin.to === stage && current.origin.group === into
      if (at !== 'end' || own) return null
    }
    const below = Math.round(centreY) > Math.round(target.shape.center.y)
    const atStart = at === 'start' || (at !== 'end' && !below)
    return placeAt(placementInto({ lanes, heldId: current.id, stage, group: into, atStart }))
  }

  /**
   * Takes what the held card is over: the card it would make a group with,
   * or a new placement when the rules allow it. Anything but a card to group
   * with leaves the one it was onto.
   */
  const take = (current: Held, aim: Aim) => {
    const onto = aim?.kind === 'onto' ? aim.id : null
    const next = aim?.kind === 'place' && accepts(current.id, { stage: aim.placement.to, group: aim.placement.group })
      ? aim.placement
      : current.placement
    if (onto === current.onto && samePlacement(next, current.placement)) return
    hold({ ...current, placement: next, onto })
  }

  /** The drag is over: the files are drawn again as they are read, and reads go on. */
  const letGo = () => {
    setHeld(null)
    onDraggingChange(false)
  }

  const executeOccupied = shown.stages.some(stage => stage.stage === 'Execute' && stage.items.length > 0)
  const dragging: Dragging | null = held === null ? null : {
    id: held.id,
    landing: held.onto === null ? held.placement : null,
    onto: held.onto,
    words: held.onto === null
      ? moveWords({ origin: held.origin, placement: held.placement })
      : newGroupWords(itemIn(held.drawn.stages, held.onto)?.item.title ?? held.onto),
    keyboard: held.keyboard,
  }

  return (
    <TooltipProvider>
      <DragDropProvider
        sensors={dragSensors}
        onDragStart={event => {
          const id = event.operation.source?.id
          const origin = typeof id === 'string' ? placementOf({ lanes: committed, id }) : null
          const keyboard = isKeyboardEvent(event.operation.activatorEvent)
          if (typeof id === 'string' && origin !== null) hold({ id, drawn: shown, origin, placement: origin, onto: null, keyboard })
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
          if (event.canceled || current === null) {
            letGo()
            return
          }
          if (current.onto !== null) {
            // Dropped onto a card, it moves nothing: the two are named as a
            // group in the dialog, from the cards as they were drawn.
            const onto = itemIn(current.drawn.stages, current.onto)
            const dropped = itemIn(current.drawn.stages, current.id)
            letGo()
            if (onto !== null && dropped !== null) onGroupDrop({ stage: onto.stage, onto: onto.item, held: dropped.item })
            return
          }
          if (samePlacement(current.placement, current.origin)) {
            letGo()
            return
          }
          void onMove(current.id, current.placement, current.drawn.revision).finally(letGo)
        }}
      >
        <div className="grid min-w-300 grid-cols-5 items-start gap-4">
          {drawn(held).map(lane => (
            <Lane
              key={lane.stage}
              {...actions}
              lane={lane}
              count={shown.stages.find(stage => stage.stage === lane.stage)?.items.length ?? 0}
              dragging={dragging}
              accepts={accepts}
              executeOccupied={executeOccupied}
            />
          ))}
        </div>
      </DragDropProvider>
    </TooltipProvider>
  )
}
