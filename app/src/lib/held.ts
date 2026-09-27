import type { Session } from '../../contract'
import { isBatchedStage } from '../../contract'
import type { Lane as LaneLayout, Placement } from './lanes'
import { laneOfLooseCard } from './lanes'

/**
 * A card held on the board: the session it was drawn on, where it would land,
 * and what it is over that would take it instead, read from the lanes as they
 * are drawn. Nothing here is kept: the board holds it for as long as the card
 * is held and its move is written.
 */

/** The session as the board draws it: its stages, and the revision a drop made on them is written against. */
export type Drawn = Pick<Session, 'stages' | 'revision'>

/**
 * What the held card is over that takes it where it is drawn, moving nothing
 * first: a card in no group of its lane, which a drop makes a group with, or
 * the heading of a group drawn after the card in its lane, which a drop puts
 * it last in, since drawing it there would lift the heading from under the
 * pointer.
 */
export type Over =
  | { readonly kind: 'card'; readonly id: string }
  | { readonly kind: 'heading'; readonly placement: Placement }

/**
 * A card being dragged: what the board drew when it was picked up, where the
 * card was then, where it would land if it were dropped now, and what it is
 * over that would take it instead, if anything.
 */
export type Held = {
  readonly id: string
  /**
   * The session drawn at pickup, drawn for as long as the card is held and
   * its move is written, as the index draws its rows: a read that lands
   * meanwhile is drawn only after that.
   */
  readonly drawn: Drawn
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
