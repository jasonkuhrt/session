import { isKeyboardEvent } from '@dnd-kit/dom/utilities'
import type { DragOverEvent } from '@dnd-kit/react'
import { DragDropProvider } from '@dnd-kit/react'
import * as React from 'react'

import type { Item, Stage } from '../../contract'
import { dragSensors, pointerOf } from '../lib/drag'
import type { Aim, Drawn, Held } from '../lib/held'
import { isOnto, itemIn, placeAt, sameOver, samePlacement } from '../lib/held'
import type { Dragging, Lane as LaneLayout, Placement } from '../lib/lanes'
import {
  isDrawnAhead,
  isInList,
  lanesOf,
  moved,
  moveWords,
  newGroupWords,
  placementInto,
  placementOf,
  placementOver,
  placeOfCard,
} from '../lib/lanes'
import { isStage, moveAvailability } from '../lib/workflow'
import type { LaneActions } from './lane'
import { Lane } from './lane'
import { TooltipProvider } from './ui/tooltip'
import type { DropTarget } from './workflow-card'

/** A card dropped on another in no group of its own lane: the two a group is to be made of, the one dropped on first. */
type GroupDrop = { readonly stage: Stage; readonly onto: Item; readonly held: Item }

type BoardProps = Omit<LaneActions, 'accepts'> & {
  session: Drawn
  /** Moves a card, against the revision it was drawn on; resolves once the move is written or refused. */
  onMove: (id: string, placement: Placement, revision: string) => Promise<boolean>
  /** Asks for the name of a group of two cards, one dropped on the other. */
  onGroupDrop: (drop: GroupDrop) => void
  onDraggingChange: (dragging: boolean) => void
}

export function Board({ session, onMove, onGroupDrop, onDraggingChange, ...actions }: BoardProps) {
  const [held, setHeld] = React.useState<Held | null>(null)
  // The hover that chose a placement can be newer than the last render, and
  // the drop must act on what the board was about to show.
  const latest = React.useRef<Held | null>(null)
  const hold = (next: Held | null) => {
    latest.current = next
    setHeld(next)
  }
  const shown: Drawn = held?.drawn ?? session
  const committed = lanesOf(shown.stages)
  // A card still where it was picked up is drawn from the files as they were
  // then, so picking it up never moves anything under the pointer.
  const drawn = (current: Held | null): LaneLayout[] => {
    if (current === null) return committed
    const lanes = lanesOf(current.drawn.stages)
    return samePlacement({ left: current.placement, right: current.origin }) ? lanes : moved({ lanes, id: current.id, placement: current.placement })
  }

  // Execute is entered only by starting the next queued batch and Queue only by
  // composing one in Batch, so neither takes a card from elsewhere. A queued
  // card may still move inside its own batch.
  const accepts = (id: unknown, target: DropTarget) => {
    const source = itemIn({ stages: shown.stages, id })
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
   * after it once below. Over a group's heading, the group's top edge
   * included, it joins the group at its end: drawn there when that moves
   * nothing under the pointer, and otherwise left where it is drawn, with the
   * drop putting it there. A card drawn ahead of a group in its lane is drawn
   * into the group only where the pointer is inside one of its cards or its
   * bottom half, never where the held card merely overlaps it, since drawing
   * it there lifts the group by the card's height; over the rest of the
   * group's top it joins last as over the heading. Otherwise, over the
   * group's side and bottom edges it joins it at its start or its end by which
   * half of the group it is over. Over the
   * lane's heading it leaves any group for the lane's start, over the space
   * below the lane's last entry for its end, and elsewhere over the lane by
   * which half of the lane it is over. A group it is already drawn in changes
   * nothing, so the gaps between the group's cards are not places of their
   * own; only the heading still takes a card from outside the group to its end.
   */
  const aimFor = (current: Held, operation: DragOverEvent['operation'], pointer?: ReturnType<typeof pointerOf>): Aim => {
    const { source, target } = operation
    if (source === null || target === null || target.id === source.id || target.shape === undefined) return null
    const lanes = drawn(current)
    const now = operation.position.current
    const centre = operation.shape?.current.center ?? now
    // The held card keeps its offset from the pointer, so its centre moves as the pointer does.
    const centreY = centre.y + (pointer ?? now).y - now.y
    // Whether drawing the card in this group would lift the group, heading and
    // all, while the pointer is not even inside what it is over. Keys land
    // inside each place they step to.
    const outside = !current.keyboard && !target.shape.containsPoint(pointer ?? now)
    const lifts = (stage: Stage, group: string | null) =>
      outside && group !== null && isDrawnAhead({ lanes, id: current.id, stage, group })
    if (target.type === 'item') {
      const overId = String(target.id)
      const { top, height } = target.shape.boundingRectangle
      if (isOnto({ current, lanes, overId, centreY, top, height })) return { kind: 'over', over: { kind: 'card', id: overId } }
      const place = placeOfCard({ lanes, id: overId })
      if (place !== null && lifts(place.stage, place.group)) return null
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
    const below = Math.round(centreY) > Math.round(target.shape.center.y)
    if (target.type === 'group' && into !== null) {
      const drawnInIt = isInList({ lanes, id: current.id, stage, group: into })
      const last = placementInto({ lanes, heldId: current.id, stage, group: into, atStart: false })
      // A card drawn ahead of the group in its lane would lift the group,
      // heading and all, if it were drawn in it; over the group's top it
      // stays drawn where it is, with the drop putting it last.
      const ahead = !current.keyboard && isDrawnAhead({ lanes, id: current.id, stage, group: into })
      const heldAbove = { kind: 'over', over: { kind: 'heading', placement: last } } as const
      if (at === 'end') {
        // Over its heading, a card joins the group last, wherever the drag
        // has drawn it on the way there: only one of the group's own, still
        // drawn in it, changes nothing.
        if (drawnInIt && current.origin.to === stage && current.origin.group === into) return null
        return ahead ? heldAbove : placeAt(last)
      }
      // A group it is already drawn in changes nothing, and one it merely
      // overlaps from ahead of it takes nothing yet.
      if (drawnInIt || lifts(stage, into)) return null
      if (ahead && !below) return heldAbove
      return placeAt(below ? last : placementInto({ lanes, heldId: current.id, stage, group: into, atStart: true }))
    }
    const atStart = at === 'start' || (at !== 'end' && !below)
    return placeAt(placementInto({ lanes, heldId: current.id, stage, group: into, atStart }))
  }

  /**
   * Takes what the held card is aimed at: what it is over, or a new
   * placement, each when the rules allow it. Anything but something to be
   * over leaves what it was over.
   */
  const take = (current: Held, aim: Aim) => {
    const allowed = (placement: Placement) => accepts(current.id, { stage: placement.to, group: placement.group })
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

  const executeOccupied = shown.stages.some(stage => stage.stage === 'Execute' && stage.items.length > 0)
  const over = held?.over ?? null
  // Where a drop would land: over a heading, the group's end, not where the card is drawn.
  const landing = held === null ? null : over?.kind === 'heading' ? over.placement : held.placement
  const dragging: Dragging | null = held === null || landing === null ? null : {
    id: held.id,
    landing: over?.kind === 'card' ? null : landing,
    onto: over?.kind === 'card' ? over.id : null,
    words: over?.kind === 'card'
      ? newGroupWords(itemIn({ stages: held.drawn.stages, id: over.id })?.item.title ?? over.id)
      : moveWords({ origin: held.origin, placement: landing }),
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
          if (typeof id === 'string' && origin !== null) hold({ id, drawn: shown, origin, placement: origin, over: null, keyboard })
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
          if (current.over?.kind === 'card') {
            // Dropped onto a card, it moves nothing: the two are named as a
            // group in the dialog, from the cards as they were drawn.
            const onto = itemIn({ stages: current.drawn.stages, id: current.over.id })
            const dropped = itemIn({ stages: current.drawn.stages, id: current.id })
            letGo()
            if (onto !== null && dropped !== null) onGroupDrop({ stage: onto.stage, onto: onto.item, held: dropped.item })
            return
          }
          // Dropped on a heading it stood above, it is drawn at the group's end from now on.
          const placement = current.over?.kind === 'heading' ? current.over.placement : current.placement
          if (samePlacement({ left: placement, right: current.origin })) {
            letGo()
            return
          }
          setHeld({ ...current, placement, over: null })
          void onMove(current.id, placement, current.drawn.revision).finally(letGo)
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
