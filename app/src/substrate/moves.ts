/** A direction the focus moves in among its peers. */
export type Direction = 'left' | 'down' | 'up' | 'right'

/** A drawn node's box, as the geometry reads it. */
type Box = Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>

/** How far past the nearest gap a node still counts as the next column over, in pixels. */
const columnSlack = 8

const middleY = (box: Box) => (box.top + box.bottom) / 2

/**
 * The nearest peer in a direction, in the geometry the view draws: up and
 * down, the nearest node whose middle is past this one's and whose columns
 * overlap it; left and right, among the nodes in the nearest column that
 * way, the one whose middle is nearest this one's. Peers are the nodes of
 * the focus's level wherever they are drawn, across containers, so a move
 * crosses from one container into the next.
 */
export function nearest<A>({ from, candidates, direction }: {
  readonly from: Box
  readonly candidates: ReadonlyArray<{ readonly value: A; readonly box: Box }>
  readonly direction: Direction
}): A | null {
  let best: { readonly value: A; readonly distance: number } | null = null
  if (direction === 'down' || direction === 'up') {
    const sign = direction === 'down' ? 1 : -1
    for (const { value, box } of candidates) {
      const overlaps = box.left < from.right - 1 && box.right > from.left + 1
      const distance = (middleY(box) - middleY(from)) * sign
      if (!overlaps || distance <= 1) continue
      if (best === null || distance < best.distance) best = { value, distance }
    }
    return best?.value ?? null
  }
  const sign = direction === 'right' ? 1 : -1
  const gapOf = (box: Box) => (sign > 0 ? box.left - from.right : from.left - box.right)
  const ahead = candidates.filter(({ box }) => gapOf(box) > -2)
  if (ahead.length === 0) return null
  const gap = Math.min(...ahead.map(({ box }) => gapOf(box)))
  for (const { value, box } of ahead) {
    if (gapOf(box) > gap + columnSlack) continue
    const distance = Math.abs(middleY(box) - middleY(from))
    if (best === null || distance < best.distance) best = { value, distance }
  }
  return best?.value ?? null
}

/** What the detail line says when a move has nowhere to go. */
export const nowhere: Record<Direction, string> = {
  left: 'Nothing to the left at this level',
  down: 'Nothing below at this level',
  up: 'Nothing above at this level',
  right: 'Nothing to the right at this level',
}
