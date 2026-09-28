import type { Path } from './seam'

/** What no id holds, which joins a path's ids into the one string it is known by. */
const separator = '\u001F'

/** The one string a path is known by, in maps and in comparisons: its ids, joined by a separator no id holds. */
export const pathKey = (path: Path) => path.join(separator)

/** The path a key was made from. */
export const pathOfKey = (key: string): Path => key.split(separator)

/** Whether one path's key is of a node inside another's. */
export const keyWithin = ({ inner, outer }: { readonly inner: string; readonly outer: string }) =>
  inner.startsWith(`${outer}${separator}`)

export const samePath = ({ left, right }: { readonly left: Path; readonly right: Path }) => pathKey(left) === pathKey(right)

/** The last id of a path: the node it is. */
export const leafOf = (path: Path) => path.at(-1) ?? ''

/**
 * Focus memory: under each parent, the children last focused there, newest
 * first. `i` goes back to the child last focused under a node, else its first;
 * nothing is kept beyond the document.
 */
export type Memory = Map<string, readonly string[]>

/** Remembers every step of a path as the child last focused under the step before it. */
export const remember = ({ memory, path }: { readonly memory: Memory; readonly path: Path }) => {
  for (let at = 1; at < path.length; at++) {
    const parent = pathKey(path.slice(0, at))
    const child = path[at]!
    memory.set(parent, [child, ...(memory.get(parent) ?? []).filter((known) => known !== child)].slice(0, 8))
  }
}

/** The child last focused under a parent that is still among its children, else the first; null when it has none. */
export const recall = ({ memory, parent, children }: {
  readonly memory: Memory
  readonly parent: Path
  readonly children: readonly string[]
}): string | null => {
  if (children.length === 0) return null
  const present = new Set(children)
  return (memory.get(pathKey(parent)) ?? []).find((child) => present.has(child)) ?? children[0] ?? null
}
