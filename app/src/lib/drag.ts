import type { Draggable } from '@dnd-kit/dom'
import { PointerActivationConstraints } from '@dnd-kit/dom'
import { getInteractiveElement, isElement } from '@dnd-kit/dom/utilities'
import { KeyboardSensor, PointerSensor } from '@dnd-kit/react'

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
