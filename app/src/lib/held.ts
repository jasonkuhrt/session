import type { DragOverEvent } from '@dnd-kit/react'

import type { Item, Session, Stage } from '../../contract'
import { isBatchedStage } from '../../contract'
import type { Lane as LaneLayout, Placement } from './lanes'
import { isDrawnAhead, isInList, laneOfLooseCard, placementInto, placementOver, placeOfCard } from './lanes'
import { isStage } from './workflow'

/**
 * A card held on the board: the sessions it was drawn on, where it would land,
 * and what it is over that would take it instead, read from the lanes of its
 * own worktree as they are drawn. Nothing here is kept: the board holds it for
 * as long as the card is held and its move is written.
 */

/** A session as the board draws it: its stages, and the revision a drop made on them is written against. */
export type Drawn = Pick<Session, 'stages' | 'revision'>

/**
 * What the held card is over that takes it where it is drawn, moving nothing
 * first: a card in no group of its lane, which a drop makes a group with, or
 * the heading of a group drawn after the card in its lane, which a drop puts
 * it last in, since drawing it there would lift the heading from under the
 * pointer.
 */
type Over =
  | { readonly kind: 'card'; readonly id: string }
  | { readonly kind: 'heading'; readonly placement: Placement }

/**
 * A card being dragged: the board of the worktree it is filed in, whose lanes
 * alone it moves among, what the board drew when it was picked up, where the
 * card was then, where it would land if it were dropped now, and what it is
 * over that would take it instead, if anything.
 */
export type Held = {
  /** The board the card's session is served under, which its move is written to. */
  readonly board: string
  readonly id: string
  /**
   * Every session drawn at pickup, by its board, drawn for as long as the
   * card is held and its move is written, as the index draws its rows: a read
   * that lands meanwhile is drawn only after that.
   */
  readonly drawn: ReadonlyMap<string, Drawn>
  readonly origin: Placement
  readonly placement: Placement
  readonly over: Over | null
  /** Whether keys carry the card rather than the pointer. */
  readonly keyboard: boolean
}

/** What the held card is aimed at now: something it is over, a place it would go, or neither, which leaves it where it is drawn. */
export type Aim = { readonly kind: 'over'; readonly over: Over } | { readonly kind: 'place'; readonly placement: Placement } | null

/** A place to go as the held card's aim, or none, which leaves it where it is drawn. */
export const placeAt = (placement: Placement | null): Aim => (placement === null ? null : { kind: 'place', placement })

/** Whether two placements put a card in the same place. */
export const samePlacement = ({ left, right }: { readonly left: Placement; readonly right: Placement }) =>
  left.to === right.to && left.group === right.group && left.beforeId === right.beforeId &&
  left.beforeGroup === right.beforeGroup

/** Whether the held card is over the same thing at two points of a drag. */
export const sameOver = ({ left, right }: { readonly left: Over | null; readonly right: Over | null }) => {
  if (left === null || right === null) return left === right
  if (left.kind === 'card') return right.kind === 'card' && left.id === right.id
  return right.kind === 'heading' && samePlacement({ left: left.placement, right: right.placement })
}

/** An item as the stages drawn hold it, with its stage; null for one they do not hold. */
export const itemIn = ({ stages, id }: { readonly stages: Drawn['stages']; readonly id: unknown }) => {
  for (const stage of stages) {
    const item = stage.items.find(candidate => candidate.id === id)
    if (item) return { item, stage: stage.stage }
  }
  return null
}

/**
 * The share of a card, around its middle, that a held card's centre is onto
 * rather than before or after it: the middle third, so each outer third still
 * places the held card beside it. The gesture's feel turns on this one
 * number, and operations.md names it so it can be tuned.
 */
const ontoShare = 1 / 3

/**
 * Whether the held card, over the card `overId`, is onto it: a card in no
 * group of the lane the held card is filed in, where the lane lets an item
 * be in no group, with the held card's centre over its middle third. There a
 * drop makes a group of the two, the way a card dropped on another on the
 * index makes an epic of them. Keys step a card from place to place,
 * landing on the middle of each card, so a card they carry is never onto one.
 */
export function isOnto({ current, lanes, overId, centreY, top, height }: {
  readonly current: Held
  readonly lanes: readonly LaneLayout[]
  readonly overId: string
  readonly centreY: number
  readonly top: number
  readonly height: number
}) {
  const lane = laneOfLooseCard({ lanes, id: overId })
  if (current.keyboard || lane === null || lane !== current.origin.to || isBatchedStage(lane)) return false
  const edge = (height * (1 - ontoShare)) / 2
  return centreY > top + edge && centreY < top + height - edge
}

/** The session the held card's own worktree was drawn with at pickup, whose revision its move is written against. */
export const ownDrawn = (held: Held) => held.drawn.get(held.board) ?? null

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
 * Another worktree's lanes are no place the card can be: over them it goes
 * back to where it was picked up, so a release there moves nothing, in
 * either worktree, as a drop on nothing cancels on the index.
 */
export function aimOf({ current, operation, pointer, lanes, cardOf }: {
  readonly current: Held
  readonly operation: DragOverEvent['operation']
  /** Where the pointer is going, when a move says so before the drag has moved there. */
  readonly pointer?: { readonly x: number; readonly y: number } | undefined
  /** The held card's own worktree's lanes, as they are drawn. */
  readonly lanes: readonly LaneLayout[]
  /** A card of any worktree in view, by the name the drag library knows it by, with its worktree's board. */
  readonly cardOf: (id: unknown) => { readonly board: string; readonly item: Item } | null
}): Aim {
  const { source, target } = operation
  if (source === null || target === null || target.id === source.id || target.shape === undefined) return null
  const { shape } = target
  const now = operation.position.current
  const centre = operation.shape?.current.center ?? now
  // The held card keeps its offset from the pointer, so its centre moves as the pointer does.
  const centreY = centre.y + (pointer ?? now).y - now.y
  // Whether drawing the card in this group would lift the group, heading and
  // all, while the pointer is not even inside what it is over. Keys land
  // inside each place they step to.
  const outside = !current.keyboard && !shape.containsPoint(pointer ?? now)
  const lifts = (stage: Stage, group: string | null) =>
    outside && group !== null && isDrawnAhead({ lanes, id: current.id, stage, group })
  const aiming: Aiming = { current, lanes, shape, centreY, lifts }
  // Another worktree's card or list is no place this card can be: with the
  // pointer over it, the card goes back to where it was picked up, and
  // merely overlapping it changes nothing.
  const elsewhere = shape.containsPoint(pointer ?? now) ? placeAt(current.origin) : null
  if (target.type === 'item') {
    const card = cardOf(target.id)
    if (card === null) return null
    return card.board === current.board ? aimOverCard({ ...aiming, overId: card.item.id }) : elsewhere
  }
  if (target.type !== 'group' && target.type !== 'lane') return null
  if (target.data['board'] !== current.board) return elsewhere
  return aimOverList({ ...aiming, group: target.type === 'group', data: target.data })
}

/** What the aim at one target of the held card's own worktree is read from: the card, its lanes, where its centre is, and whether a group would lift. */
type Aiming = {
  readonly current: Held
  readonly lanes: readonly LaneLayout[]
  readonly shape: NonNullable<NonNullable<DragOverEvent['operation']['target']>['shape']>
  readonly centreY: number
  readonly lifts: (stage: Stage, group: string | null) => boolean
}

/** Over a card of its own worktree: onto its middle, or in front of it or after it. */
function aimOverCard({ current, lanes, shape, centreY, lifts, overId }: Aiming & { readonly overId: string }): Aim {
  const { top, height } = shape.boundingRectangle
  if (isOnto({ current, lanes, overId, centreY, top, height })) return { kind: 'over', over: { kind: 'card', id: overId } }
  const place = placeOfCard({ lanes, id: overId })
  if (place !== null && lifts(place.stage, place.group)) return null
  const below = Math.round(centreY) > Math.round(shape.center.y)
  return placeAt(placementOver({ lanes, heldId: current.id, overId, below }))
}

/** Over a group or a lane of its own worktree: a group's heading, edges or top, or a lane's heading, end or halves. */
function aimOverList({ current, lanes, shape, centreY, lifts, group: isGroup, data }: Aiming & {
  /** Whether the list is a group rather than a lane's cards in no group. */
  readonly group: boolean
  readonly data: Readonly<Record<string, unknown>>
}): Aim {
  const stage: unknown = data['stage']
  const group: unknown = data['group']
  if (!isStage(stage)) return null
  const into = typeof group === 'string' ? group : null
  // A lane's heading is its start and the space below its last entry its
  // end; a group's heading is its end.
  const at: unknown = data['at']
  const below = Math.round(centreY) > Math.round(shape.center.y)
  if (isGroup && into !== null) {
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
