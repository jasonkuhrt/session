import { substrateIds } from './commands'
import type { Direction } from './moves'
import { nearest, nowhere } from './moves'
import type { Memory } from './path'
import { keyWithin, pathKey, pathOfKey, recall } from './path'
import type { Path, Seam } from './seam'

/**
 * Where the focus goes on a move: among its peers in the drawn geometry, in
 * to the child last focused, out to its parent, and where a focus the view
 * does not draw settles. Each answers a path, or the reason there is nowhere
 * to go.
 */

/**
 * A node the view draws, as the moves and a click read it: its level, its
 * element, and whether other nodes are drawn inside it; its key says where it
 * is.
 */
export type Drawn = { readonly scope: string; readonly element: Element; readonly holds: boolean }

/** The nearest peer of the focus's level that way, across containers. */
export const peerOf = ({ drawn, focusKey, direction }: {
  readonly drawn: ReadonlyMap<string, Drawn>
  readonly focusKey: string
  readonly direction: Direction
}): Path | string => {
  const from = drawn.get(focusKey)
  if (from === undefined) return nowhere[direction]
  const reached = nearest({
    from: from.element.getBoundingClientRect(),
    candidates: [...drawn.entries()]
      .filter(([key, node]) => node.scope === from.scope && key !== focusKey)
      .map(([key, node]) => ({ value: pathOfKey(key), box: node.element.getBoundingClientRect() })),
    direction,
  })
  return reached ?? nowhere[direction]
}

/** `i`: the child last focused under the focus, else its first; a node with none that stands for another goes into that one's. */
export const into = ({ seam, memory, focus }: { readonly seam: Seam; readonly memory: Memory; readonly focus: Path }): Path | string => {
  let at = focus
  let kids = seam.kids(at)
  if (kids.length === 0) {
    const standing = seam.standsFor(focus).find((candidate) => seam.kids(candidate).length > 0)
    if (standing !== undefined) {
      at = standing
      kids = seam.kids(standing)
    }
  }
  const child = recall({ memory, parent: at, children: kids })
  return child === null ? seam.noInside(focus) : [...at, child]
}

/** `o`: the parent, landing on the node the focus came from; the root's children have nowhere further out. */
export const outOf = ({ seam, focus }: { readonly seam: Seam; readonly focus: Path }): Path | string =>
  focus.length <= 2 ? seam.noOut(focus) : focus.slice(0, -1)

/**
 * Where a focus the view does not draw settles, once the view has drawn what
 * it read: into the node when the view draws what is inside it, else out to
 * the nearest node it draws; null when it is drawn, or nothing is.
 */
export const settled = ({ seam, memory, drawn, focus }: {
  readonly seam: Seam
  readonly memory: Memory
  readonly drawn: ReadonlyMap<string, Drawn>
  readonly focus: Path
}): Path | null => {
  const focusKey = pathKey(focus)
  if (drawn.size === 0 || drawn.has(focusKey)) return null
  if ([...drawn.keys()].some((key) => keyWithin({ inner: key, outer: focusKey }))) {
    const child = recall({ memory, parent: focus, children: seam.kids(focus) })
    return child === null ? null : [...focus, child]
  }
  for (let at = focus.length - 1; at > 0; at--) {
    if (drawn.has(pathKey(focus.slice(0, at)))) return focus.slice(0, at)
  }
  return null
}

/** The moves among peers, by the command that makes each. */
const directions: Readonly<Record<string, Direction>> = {
  [substrateIds.left]: 'left',
  [substrateIds.down]: 'down',
  [substrateIds.up]: 'up',
  [substrateIds.right]: 'right',
}

const answerOf = (answer: Path | string): true | string => (typeof answer === 'string' ? answer : true)

/**
 * Whether one of the substrate's own commands can run with the focus where it
 * is, answered as an app's command answers: a move with nowhere to go, a level
 * with nothing inside or above, or a node the app says cannot be marked cannot
 * run, and says why. While a mode is open its own keys always can.
 */
export const ownWhen = ({ seam, memory, drawn, focus, moded }: {
  readonly seam: Seam
  readonly memory: Memory
  /** What the view draws, read when a command is asked about, never while it renders. */
  readonly drawn: { readonly current: ReadonlyMap<string, Drawn> }
  readonly focus: Path
  readonly moded: boolean
}) =>
(id: string): true | string => {
  if (moded) return true
  if (id === substrateIds.mark) return seam.markable(focus)
  if (id === substrateIds.in) return answerOf(into({ seam, memory, focus }))
  if (id === substrateIds.out) return answerOf(outOf({ seam, focus }))
  const direction = directions[id]
  return direction === undefined ? true : answerOf(peerOf({ drawn: drawn.current, focusKey: pathKey(focus), direction }))
}
