import type { Lane, Placement } from './lanes'
import { locate, neighbourFrom } from './lanes'

/**
 * Where a card goes when it is carried one step down its lane, `by` 1, or up
 * it, `by` -1, as the keys carry it: past the next card or the next whole
 * group of its lane in no group, past the next card of its group inside one,
 * and out of its group at the group's end, beside it. The reason it cannot
 * go, when it cannot: the end of its lane, or a queued batch, which a card
 * leaves only by leaving Queue.
 */
export function carried({ lanes, id, by }: {
  readonly lanes: readonly Lane[]
  readonly id: string
  readonly by: 1 | -1
}): Placement | string {
  const located = locate({ lanes, id })
  if (located === null) return `${id} is not on the board`
  const { lane, entry: at } = located
  const stage = lane.stage
  const entry = lane.entries[at]
  if (located.group !== null && entry?.kind === 'group') {
    const items = entry.items
    const next = items[located.position + by]
    if (next !== undefined) {
      return by === 1
        ? { to: stage, group: located.group, beforeId: items[located.position + 2]?.id ?? null, beforeGroup: null }
        : { to: stage, group: located.group, beforeId: next.id, beforeGroup: null }
    }
    if (stage === 'Queue') return `${id} leaves the batch “${located.group}” only by leaving Queue`
    return by === 1
      ? { to: stage, group: null, ...neighbourFrom({ entries: lane.entries, from: at, heldId: id }) }
      : { to: stage, group: null, beforeId: null, beforeGroup: located.group }
  }
  const neighbour = lane.entries[at + by]
  if (neighbour === undefined) return `${id} is already at the ${by === 1 ? 'bottom' : 'top'} of ${stage}`
  if (by === 1) return { to: stage, group: null, ...neighbourFrom({ entries: lane.entries, from: at + 1, heldId: id }) }
  return neighbour.kind === 'item'
    ? { to: stage, group: null, beforeId: neighbour.item.id, beforeGroup: null }
    : { to: stage, group: null, beforeId: null, beforeGroup: neighbour.name }
}
