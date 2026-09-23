import type { Item, Stage, StageFile } from '../../contract'

/**
 * One entry of a lane in file order: an item filed directly in the stage, or a
 * group and the items it holds. A stage directory is exactly this sequence, a
 * file or a directory per entry, so a lane draws what its directory holds.
 */
export type LaneEntry =
  | { readonly kind: 'item'; readonly item: Item }
  | { readonly kind: 'group'; readonly name: string; readonly items: readonly Item[] }

/** A lane as the board draws it: its stage, and its entries in file order. */
export type Lane = { readonly stage: Stage; readonly entries: readonly LaneEntry[] }

/**
 * Where a card goes, in the terms `POST /api/move` takes: the stage, the group
 * in it or null for none, and the card it goes in front of. That card is in the
 * same group, or in none for a card in none; null is the end of the group, or
 * of the stage for a card in none.
 */
export type Placement = { readonly to: Stage; readonly group: string | null; readonly beforeId: string | null }

/** A stage's items as its entries. File order keeps a group's items together, so consecutive items of one group are that group. */
function laneEntries(items: readonly Item[]): LaneEntry[] {
  const entries: LaneEntry[] = []
  for (const item of items) {
    const last = entries.at(-1)
    if (item.group === null) entries.push({ kind: 'item', item })
    else if (last?.kind === 'group' && last.name === item.group) entries.splice(-1, 1, { ...last, items: [...last.items, item] })
    else entries.push({ kind: 'group', name: item.group, items: [item] })
  }
  return entries
}

/** The lanes the board draws for the stages as the files hold them. */
export const lanesOf = (stages: readonly StageFile[]): Lane[] =>
  stages.map((stage) => ({ stage: stage.stage, entries: laneEntries(stage.items) }))

/**
 * The name dnd-kit knows a list of cards by: a lane's cards in no group share
 * one, and each group's cards have another. A group's name holds no `/`, so no
 * group's list can be named like a lane's.
 */
export const listId = ({ stage, group }: { readonly stage: Stage; readonly group: string | null }) =>
  group === null ? stage : `${stage}/${group}`

/** A card and the list it is drawn in: its lane, its group or null, and the ids of that list in order. */
type Located = {
  readonly item: Item
  readonly stage: Stage
  readonly group: string | null
  readonly list: readonly string[]
  readonly index: number
}

function locate(lanes: readonly Lane[], id: string): Located | null {
  for (const lane of lanes) {
    const loose = lane.entries.flatMap((entry) => (entry.kind === 'item' ? [entry.item] : []))
    const index = loose.findIndex((item) => item.id === id)
    const item = loose[index]
    if (item !== undefined) return { item, stage: lane.stage, group: null, list: loose.map((entry) => entry.id), index }
    for (const entry of lane.entries) {
      if (entry.kind !== 'group') continue
      const position = entry.items.findIndex((candidate) => candidate.id === id)
      const grouped = entry.items[position]
      if (grouped !== undefined) {
        return { item: grouped, stage: lane.stage, group: entry.name, list: entry.items.map((candidate) => candidate.id), index: position }
      }
    }
  }
  return null
}

/** The card after this one in its list, leaving out `skip`: what a card placed right after it goes in front of. */
const nextAfter = (located: Located, skip: string): string | null =>
  located.list.slice(located.index + 1).find((id) => id !== skip) ?? null

/** Where a card is now, as the placement that would leave it there. */
export function placementOf({ lanes, id }: { readonly lanes: readonly Lane[]; readonly id: string }): Placement | null {
  const located = locate(lanes, id)
  return located === null ? null : { to: located.stage, group: located.group, beforeId: nextAfter(located, id) }
}

/** Whether a card is already in this list, in the lanes as they are drawn. */
export function isInList({ lanes, id, stage, group }: {
  readonly lanes: readonly Lane[]
  readonly id: string
  readonly stage: Stage
  readonly group: string | null
}) {
  const located = locate(lanes, id)
  return located !== null && located.stage === stage && located.group === group
}

/**
 * Where a card goes while it is held over another card, as dnd-kit's own
 * sortable move reads it: over a card of its own list it takes that card's
 * place, and over a card of another list it goes in front of that card, or
 * after it when the held card's centre is below the other card's.
 */
export function placementOver({ lanes, heldId, overId, below }: {
  readonly lanes: readonly Lane[]
  /** The card being dragged. */
  readonly heldId: string
  /** The card it is over. */
  readonly overId: string
  /** Whether the held card's centre is below the centre of the card it is over. */
  readonly below: boolean
}): Placement | null {
  const held = locate(lanes, heldId)
  const over = locate(lanes, overId)
  if (held === null || over === null) return null
  const sameList = held.stage === over.stage && held.group === over.group
  const after = sameList ? held.index < over.index : below
  return { to: over.stage, group: over.group, beforeId: after ? nextAfter(over, heldId) : overId }
}

/**
 * Where a card goes while it is held over a list rather than one of its cards,
 * as dnd-kit's own sortable move reads a list: to the list's start over its
 * top half, to its end over its bottom half. A lane's cards in no group always
 * take it at the end, because that is where the lane's own space is.
 */
export function placementInto({ lanes, heldId, stage, group, atStart }: {
  readonly lanes: readonly Lane[]
  readonly heldId: string
  readonly stage: Stage
  readonly group: string | null
  /** Whether the held card's centre is above the centre of the list it is over. */
  readonly atStart: boolean
}): Placement {
  const lane = lanes.find((candidate) => candidate.stage === stage)
  const entry = group === null ? undefined : lane?.entries.find((candidate) => candidate.kind === 'group' && candidate.name === group)
  const first = entry?.kind === 'group' && atStart ? entry.items.find((item) => item.id !== heldId)?.id ?? null : null
  return { to: stage, group, beforeId: first }
}

const withoutCard = (entries: readonly LaneEntry[], id: string): LaneEntry[] =>
  entries.flatMap((entry): LaneEntry[] => {
    if (entry.kind === 'item') return entry.item.id === id ? [] : [entry]
    return [{ ...entry, items: entry.items.filter((item) => item.id !== id) }]
  })

function withCard(entries: readonly LaneEntry[], card: Item, placement: Placement): LaneEntry[] {
  const { group, beforeId } = placement
  if (group === null) {
    const at = entries.findIndex((entry) => entry.kind === 'item' && entry.item.id === beforeId)
    const entry: LaneEntry = { kind: 'item', item: card }
    return at === -1 ? [...entries, entry] : entries.toSpliced(at, 0, entry)
  }
  const at = entries.findIndex((entry) => entry.kind === 'group' && entry.name === group)
  const target = entries[at]
  if (target?.kind !== 'group') return [...entries, { kind: 'group', name: group, items: [card] }]
  const before = target.items.findIndex((item) => item.id === beforeId)
  const items = before === -1 ? [...target.items, card] : target.items.toSpliced(before, 0, card)
  return entries.toSpliced(at, 1, { ...target, items })
}

/**
 * The lanes with one card moved, as the engine will write the move: the card
 * leaves where it is and goes in front of `beforeId`, or to the end of its
 * group, or of the stage. A group the move empties keeps its place meanwhile,
 * so the card can still be dropped back into it; the engine removes the
 * group's directory when the move is written.
 */
export function moved({ lanes, id, placement }: {
  readonly lanes: readonly Lane[]
  readonly id: string
  readonly placement: Placement
}): Lane[] {
  const located = locate(lanes, id)
  if (located === null) return [...lanes]
  const card: Item = { ...located.item, group: placement.group }
  return lanes.map((lane) => {
    const entries = withoutCard(lane.entries, id)
    return { stage: lane.stage, entries: lane.stage === placement.to ? withCard(entries, card, placement) : entries }
  })
}
