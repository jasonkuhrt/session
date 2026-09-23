import { PointerActivationConstraints } from '@dnd-kit/dom'
import type { DragOverEvent } from '@dnd-kit/react'
import { DragDropProvider, KeyboardSensor, PointerSensor } from '@dnd-kit/react'
import * as React from 'react'

import type { StageFile } from '../../contract'
import type { Lane as LaneLayout, Placement } from '../lib/lanes'
import { isInList, lanesOf, moved, placementInto, placementOf, placementOver } from '../lib/lanes'
import { isStage, moveAvailability } from '../lib/workflow'
import type { LaneActions } from './lane'
import { Lane } from './lane'
import { TooltipProvider } from './ui/tooltip'
import type { DropTarget } from './workflow-card'

/**
 * A card is dragged by its whole self, so nobody has to hit a grip. Without a
 * handle the pointer sensor's own default is a 200ms press, which reads as the
 * card refusing to move; a short distance instead means the gesture is decided
 * by whether you moved, so a plain click on the title, the checkbox or the
 * complete button is still a click. The keyboard sensor is the stock one, kept
 * so cards still sort from the keyboard.
 */
const dragThresholdPixels = 5

const sensors = [
  PointerSensor.configure({
    activationConstraints: [new PointerActivationConstraints.Distance({ value: dragThresholdPixels })],
  }),
  KeyboardSensor,
]

type BoardProps = Omit<LaneActions, 'accepts'> & {
  stages: StageFile[]
  /** Moves a card; resolves once the move is written or refused. */
  onMove: (id: string, placement: Placement) => Promise<boolean>
  onDraggingChange: (dragging: boolean) => void
}

/** A card being dragged: where it was when the drag began, and where it would land if it were dropped now. */
type Held = { readonly id: string; readonly origin: Placement; readonly placement: Placement }

const samePlacement = (left: Placement, right: Placement) =>
  left.to === right.to && left.group === right.group && left.beforeId === right.beforeId

export function Board({ stages, onMove, onDraggingChange, ...actions }: BoardProps) {
  const committed = lanesOf(stages)
  const [held, setHeld] = React.useState<Held | null>(null)
  // The hover that chose a placement can be newer than the last render, and
  // the drop must act on what the board was about to show.
  const latest = React.useRef<Held | null>(null)
  const hold = (next: Held | null) => {
    latest.current = next
    setHeld(next)
  }
  const drawn = (current: Held | null): LaneLayout[] =>
    current === null ? committed : moved({ lanes: committed, id: current.id, placement: current.placement })

  const findItem = (id: unknown) => {
    for (const stage of stages) {
      const item = stage.items.find(candidate => candidate.id === id)
      if (item) return { item, stage: stage.stage }
    }
    return null
  }
  // Execute is entered only by starting the next queued batch and Queue only by
  // composing one in Batch, so neither takes a card from elsewhere. A queued
  // card may still move inside its own batch.
  const accepts = (id: unknown, target: DropTarget) => {
    const source = findItem(id)
    if (source === null) return false
    if (target.stage === 'EXECUTE') return false
    if (target.stage === 'QUEUE') return source.stage === 'QUEUE' && target.group !== null && source.item.group === target.group
    if (source.stage === target.stage) return true
    return moveAvailability(source.item, source.stage, target.stage).enabled
  }

  /**
   * Where the held card would land for what it is over now, or null to leave
   * it where it is. Over a card it goes in front of that card or after it;
   * over a group's heading or edge it joins the group, at its start or its end
   * by which half of the group it is over, and over the lane's own space it
   * leaves any group for the end of the lane. Over what it is already in,
   * nothing changes.
   */
  const placementFor = (current: Held, operation: DragOverEvent['operation']): Placement | null => {
    const { source, target } = operation
    if (source === null || target === null || target.id === source.id) return null
    const lanes = drawn(current)
    const centre = operation.shape?.current.center ?? operation.position.current
    const below = target.shape !== undefined && Math.round(centre.y) > Math.round(target.shape.center.y)
    if (target.type === 'item') return placementOver({ lanes, heldId: current.id, overId: String(target.id), below })
    if (target.type !== 'group' && target.type !== 'lane') return null
    const stage: unknown = target.data['stage']
    const group: unknown = target.data['group']
    if (!isStage(stage)) return null
    const into = typeof group === 'string' ? group : null
    if (isInList({ lanes, id: current.id, stage, group: into })) return null
    return placementInto({ lanes, heldId: current.id, stage, group: into, atStart: !below })
  }

  const executeOccupied = stages.some(stage => stage.stage === 'EXECUTE' && stage.items.length > 0)

  return (
    <TooltipProvider>
      <DragDropProvider
        sensors={sensors}
        onDragStart={event => {
          const id = event.operation.source?.id
          const origin = typeof id === 'string' ? placementOf({ lanes: committed, id }) : null
          if (typeof id === 'string' && origin !== null) hold({ id, origin, placement: origin })
          onDraggingChange(true)
        }}
        onDragOver={event => {
          // The board draws every card where the files would put it, so the
          // sortable's own plugin must not move cards in the DOM behind React:
          // a card it had moved to another list would be one React no longer
          // finds when it next draws that list.
          event.preventDefault()
          const current = latest.current
          if (current === null) return
          const next = placementFor(current, event.operation)
          if (next === null || samePlacement(next, current.placement)) return
          if (!accepts(current.id, { stage: next.to, group: next.group })) return
          hold({ ...current, placement: next })
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
          void onMove(current.id, current.placement).finally(() => {
            setHeld(null)
            onDraggingChange(false)
          })
        }}
      >
        <div className="grid min-w-300 grid-cols-5 items-start gap-4">
          {drawn(held).map(lane => (
            <Lane
              key={lane.stage}
              {...actions}
              lane={lane}
              count={stages.find(stage => stage.stage === lane.stage)?.items.length ?? 0}
              held={held?.placement ?? null}
              accepts={accepts}
              executeOccupied={executeOccupied}
            />
          ))}
        </div>
      </DragDropProvider>
    </TooltipProvider>
  )
}
