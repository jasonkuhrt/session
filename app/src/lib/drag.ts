import type { Draggable } from '@dnd-kit/dom'
import { PointerActivationConstraints } from '@dnd-kit/dom'
import { getInteractiveElement, isElement } from '@dnd-kit/dom/utilities'
import type { DragMoveEvent } from '@dnd-kit/react'
import { KeyboardSensor, PointerSensor } from '@dnd-kit/react'

import type { Holding } from './epics'
import { draggedId, draggedOf, targetId, targetOf } from './epics'

/**
 * What the board and the index drag with, so a card on either is picked up
 * and put down the same way.
 */

/**
 * A card is dragged by its whole self, so nobody has to hit a grip. Without a
 * handle the pointer sensor's own default is a 200ms press, which reads as the
 * card refusing to move; a short distance instead means the gesture is decided
 * by whether you moved, so a plain click on a link, a checkbox or a button is
 * still a click. The keyboard sensor is the stock one, kept so a board's
 * cards, which take the focus, still move from the keyboard.
 */
const dragThresholdPixels = 5

/**
 * A control a press belongs to, which a drag never starts from: the ones the
 * library knows, links, buttons and fields, and the ones drawn as something
 * else, such as a pill that opens a menu, which opens the moment it is pressed.
 * Anywhere inside a handle a drag starts, as the library has it, since a handle
 * is there to be pressed. A word with its tip behind it is not a control,
 * though Tips draws it as a button, so turning tips on never changes what can
 * be dragged.
 */
const pressBelongsToControl = (event: PointerEvent, source: Draggable) => {
  const { target } = event
  if (!isElement(target) || target === source.element || source.handle?.contains(target) === true) return false
  const control = getInteractiveElement(target) ?? target.closest('[aria-haspopup], [role="button"]')
  if (control === null || control === source.element) return false
  return !(control instanceof HTMLElement && Object.hasOwn(control.dataset, 'explained'))
}

export const dragSensors = [
  PointerSensor.configure({
    activationConstraints: [new PointerActivationConstraints.Distance({ value: dragThresholdPixels })],
    preventActivation: pressBelongsToControl,
  }),
  KeyboardSensor,
]

/** The outline of the place a held card would be dropped into. */
export const landing = 'outline-2 outline-primary outline-dashed outline-offset-2'

type Point = { readonly x: number; readonly y: number }

/**
 * Where the pointer is going, as a move tells it before the drag has moved
 * there: a pointer move names the point, a key move the step.
 */
export const pointerOf = (event: DragMoveEvent): Point => {
  const now = event.operation.position.current
  if (event.to !== undefined) return event.to
  return event.by === undefined ? now : { x: now.x + event.by.x, y: now.y + event.by.y }
}

/** The drag's state as a point of it describes it: the pointer, and the operation's source and target. */
type Operation = DragMoveEvent['operation']

/**
 * What is held and where, as the drag stands at a point: what the pointer is
 * over, and which half of it, above or below its middle, which is what places
 * a held project or worktree before or after what it is over.
 */
export function holdingOf({ operation, pointer = operation.position.current }: {
  readonly operation: Operation
  /** Where the pointer is going, when a move says so before the drag has moved there. */
  readonly pointer?: Point
}): Holding | null {
  const dragged = draggedOf(operation.source?.id)
  if (dragged === null) return null
  const middle = operation.target?.shape?.center.y
  return { dragged, target: targetOf(operation.target?.id), below: middle !== undefined && pointer.y > middle }
}

/** Whether two points of a drag hold the same thing over the same half of the same target, so nothing drawn changes. */
export const sameHolding = ({ left, right }: { readonly left: Holding | null; readonly right: Holding | null }) =>
  left === null || right === null
    ? left === right
    : draggedId(left.dragged) === draggedId(right.dragged) && left.below === right.below &&
      (left.target === null || right.target === null
        ? left.target === right.target
        : targetId(left.target) === targetId(right.target))
