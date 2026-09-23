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
 * in it or null for none, and the neighbour it goes in front of. A card in a
 * group goes in front of a card of that group, `beforeId`. A card in no group
 * goes in front of the lane's next entry, which is a card in no group,
 * `beforeId`, or a group, `beforeGroup`. With neither it goes to the end of
 * its group, or of the lane.
 */
export type Placement = {
  readonly to: Stage
  readonly group: string | null
  readonly beforeId: string | null
  readonly beforeGroup: string | null
}

type Neighbour = Pick<Placement, 'beforeId' | 'beforeGroup'>

const atTheEnd: Neighbour = { beforeId: null, beforeGroup: null }

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

/** A card where it is drawn: its lane, its group or null, its entry in the lane, and its place in its group. */
type Located = {
  readonly item: Item
  readonly lane: Lane
  readonly group: string | null
  /** The card's own entry for a card in no group, its group's entry otherwise. */
  readonly entry: number
  /** Its place among its group's cards; unused for a card in no group. */
  readonly position: number
}

function locate(lanes: readonly Lane[], id: string): Located | null {
  for (const lane of lanes) {
    for (const [entry, candidate] of lane.entries.entries()) {
      if (candidate.kind === 'item') {
        if (candidate.item.id === id) return { item: candidate.item, lane, group: null, entry, position: 0 }
        continue
      }
      const position = candidate.items.findIndex((item) => item.id === id)
      const item = candidate.items[position]
      if (item !== undefined) return { item, lane, group: candidate.name, entry, position }
    }
  }
  return null
}

/**
 * What a card in no group goes in front of when it is placed after entry
 * `from` of a lane: the next card in no group, or the next group. The held
 * card itself is passed over, and so is a group that holds nothing else,
 * because the move will empty it.
 */
function neighbourFrom(entries: readonly LaneEntry[], from: number, heldId: string): Neighbour {
  for (const entry of entries.slice(from + 1)) {
    if (entry.kind === 'item') {
      if (entry.item.id !== heldId) return { beforeId: entry.item.id, beforeGroup: null }
    } else if (entry.items.some((item) => item.id !== heldId)) {
      return { beforeId: null, beforeGroup: entry.name }
    }
  }
  return atTheEnd
}

/** What a card goes in front of when it is placed right after `located`, leaving out the held card. */
function neighbourAfter(located: Located, heldId: string): Neighbour {
  const entry = located.lane.entries[located.entry]
  if (located.group === null || entry?.kind !== 'group') return neighbourFrom(located.lane.entries, located.entry, heldId)
  const next = entry.items.slice(located.position + 1).find((item) => item.id !== heldId)
  return { beforeId: next?.id ?? null, beforeGroup: null }
}

/** Where a card is now, as the placement that would leave it there. */
export function placementOf({ lanes, id }: { readonly lanes: readonly Lane[]; readonly id: string }): Placement | null {
  const located = locate(lanes, id)
  return located === null ? null : { to: located.lane.stage, group: located.group, ...neighbourAfter(located, id) }
}

/** Whether a card is already in this list, in the lanes as they are drawn. */
export function isInList({ lanes, id, stage, group }: {
  readonly lanes: readonly Lane[]
  readonly id: string
  readonly stage: Stage
  readonly group: string | null
}) {
  const located = locate(lanes, id)
  return located !== null && located.lane.stage === stage && located.group === group
}

/**
 * Where a card goes while it is held over another card: in front of that card
 * while the held card's centre is above the other's centre, and right after
 * it once it is below, in the card's own list or another. Right after a card
 * in no group, a card goes in front of whatever entry follows, a group
 * included, so it lands where it is drawn.
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
  const over = locate(lanes, overId)
  if (over === null || locate(lanes, heldId) === null) return null
  const at = { to: over.lane.stage, group: over.group }
  return below ? { ...at, ...neighbourAfter(over, heldId) } : { ...at, beforeId: overId, beforeGroup: null }
}

/**
 * Where a card goes while it is held over a list rather than one of its cards,
 * as dnd-kit's own sortable move reads a list: to the list's start over its
 * top half, to its end over its bottom half. A group's start is in front of its
 * first card; a lane's start is in front of its first entry, a group included.
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
  if (lane === undefined || !atStart) return { to: stage, group, ...atTheEnd }
  if (group === null) return { to: stage, group, ...neighbourFrom(lane.entries, -1, heldId) }
  const entry = lane.entries.find((candidate) => candidate.kind === 'group' && candidate.name === group)
  const first = entry?.kind === 'group' ? entry.items.find((item) => item.id !== heldId)?.id ?? null : null
  return { to: stage, group, beforeId: first, beforeGroup: null }
}

const withoutCard = (entries: readonly LaneEntry[], id: string): LaneEntry[] =>
  entries.flatMap((entry): LaneEntry[] => {
    if (entry.kind === 'item') return entry.item.id === id ? [] : [entry]
    return [{ ...entry, items: entry.items.filter((item) => item.id !== id) }]
  })

function withCard(entries: readonly LaneEntry[], card: Item, placement: Placement): LaneEntry[] {
  const { group, beforeId, beforeGroup } = placement
  if (group === null) {
    const at = entries.findIndex((entry) =>
      beforeGroup === null ? entry.kind === 'item' && entry.item.id === beforeId : entry.kind === 'group' && entry.name === beforeGroup
    )
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
 * leaves where it is and goes in front of its neighbour, or to the end of its
 * group, or of the lane. A group the move empties keeps its place meanwhile,
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
