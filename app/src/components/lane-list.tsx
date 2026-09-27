import { CollisionPriority } from '@dnd-kit/abstract'
import { pointerIntersection } from '@dnd-kit/collision'
import { useDroppable } from '@dnd-kit/react'

import type { Item, Stage } from '../../contract'
import { isBatchedStage } from '../../contract'
import { landing } from '../lib/drag'
import type { Dragging, Lane as LaneLayout } from '../lib/lanes'
import { dragOf, landingIn, listId } from '../lib/lanes'
import { cn } from '../lib/utils'
import { groupMeta } from '../lib/workflow'
import type { LaneActions } from './lane'
import { Explained, Tip } from './tip'
import { Button } from './ui/button'
import { WorkflowCard } from './workflow-card'

/**
 * One worktree's entries in a lane, in file order: its cards in no group and
 * its groups, then the space under the last entry, which is its own: a card
 * dropped there lands at the end of its lane, in no group. The list is
 * outlined while a held card of this worktree would land in it in no group.
 */
export function LaneList({ board, stage, lane, dragging, endRef, className, endClassName, ...actions }: LaneActions & {
  board: string
  stage: Stage
  lane: LaneLayout
  /** The card being dragged, and what dropping it now would do; drawn only if it is this worktree's. */
  dragging: Dragging | null
  endRef: (element: Element | null) => void
  /** How tall the list is at least, and the space under its last entry. */
  className: string
  endClassName: string
}) {
  // A card in no group is sorted among the lane's other cards in no group, so
  // its place in that list is what dnd-kit is told.
  const looseIndex = new Map<string, number>()
  for (const entry of lane.entries) if (entry.kind === 'item') looseIndex.set(entry.item.id, looseIndex.size)
  const landsIn = landingIn({ dragging, board })
  const heldHere = landsIn !== null && landsIn.to === stage ? landsIn : null
  return (
    <div className={cn(className, 'space-y-3 rounded-lg', heldHere?.group === null && landing)}>
      {lane.entries.map(entry => (entry.kind === 'item'
        ? <WorkflowCard key={entry.item.id} {...actions} {...dragOf({ dragging, board, id: entry.item.id })} board={board} item={entry.item} index={looseIndex.get(entry.item.id) ?? 0} stage={stage} />
        : <GroupBlock key={`group:${entry.name}`} {...actions} board={board} stage={stage} name={entry.name} items={entry.items} dragging={dragging} landing={heldHere?.group === entry.name} />))}
      <div ref={endRef} className={endClassName} />
    </div>
  )
}

/**
 * One group of a lane: its name as a heading over its cards, in the lane's
 * file order. In Batch a group is a proposed batch and can be queued as one;
 * in the lanes where an item may be in no group it can be taken apart. Queue
 * and Execute hold only batches, which change only by starting and finishing.
 * A card dropped on its heading joins it last, and one dropped on its edges
 * joins it at its start or its end, by which half of it the card is over. A
 * group is one worktree's, and takes only that worktree's cards.
 */
function GroupBlock({ board, stage, name, items, dragging, landing: lands, ...actions }: LaneActions & {
  board: string
  stage: Stage
  name: string
  items: readonly Item[]
  dragging: Dragging | null
  /** Whether a card being dragged would be dropped into this group. */
  landing: boolean
}) {
  const accept = (source: { readonly id: unknown }) => actions.accepts(source.id, { board, stage, group: name })
  const { ref } = useDroppable({
    id: `group:${listId({ board, stage, group: name })}`,
    type: 'group',
    data: { board, stage, group: name },
    accept,
    // A card under the pointer is what a held card is over; otherwise the
    // group under the pointer is, ahead of any card the held card merely
    // overlaps and of the lane. Its pointer collision ranks with cards' overlap
    // collisions and above them, so its edges take a card even with cards
    // around them, and a group a drag has emptied still does.
    collisionPriority: CollisionPriority.Normal,
    disabled: actions.pending,
  })
  // The heading is a place of its own, the group's end, as the index's epic
  // card takes a worktree dropped on it: the pointer alone decides it, and it
  // outranks the group around it. It spans the group's top edge, so a card
  // brought from above meets the heading before any part of the group that
  // would place it first. Keys step a card among places by rank before
  // distance, so a heading that outranks them would take every step; it is
  // no place for a card they carry.
  const { ref: headingRef } = useDroppable({
    id: `heading:${listId({ board, stage, group: name })}`,
    type: 'group',
    data: { board, stage, group: name, at: 'end' },
    accept,
    collisionDetector: pointerIntersection,
    collisionPriority: CollisionPriority.High,
    disabled: actions.pending || dragging?.keyboard === true,
  })
  const ids = items.map(item => item.id)
  // A drag can empty a group before the move is written; there is nothing in
  // it to queue or to take out until then.
  const canQueue = stage === 'Batch' && ids.length > 0
  const canUngroup = !isBatchedStage(stage) && ids.length > 0
  return (
    <div ref={ref} className={cn('space-y-2 rounded-xl border p-2', lands && landing)}>
      {/* Out to the group's border on three sides, so the top edge is the heading's; it draws where it always has. */}
      <div ref={headingRef} className="-mx-2 -mt-2 flex items-start gap-1 px-2 pt-2">
        <h3 className="min-w-0 flex-1 py-1 text-xs font-medium tracking-wide break-words text-foreground">
          <Explained meaning={groupMeta[stage].heading} className="block">{name}</Explained>
        </h3>
        {canQueue ? (
          <Tip
            meaning="Name these items as a batch, starting from the name of this group, and append it to Queue."
            render={<Button variant="ghost" size="xs" disabled={actions.pending} onClick={() => actions.onQueue(board, ids, name)} />}
          >
            Queue batch
          </Tip>
        ) : null}
        {canUngroup ? (
          <Tip
            meaning={`Take these items out of the group, each to the end of ${stage}.`}
            render={<Button variant="ghost" size="xs" disabled={actions.pending} onClick={() => actions.onUngroup(board, ids)} />}
          >
            Ungroup
          </Tip>
        ) : null}
      </div>
      {items.map((item, index) => <WorkflowCard key={item.id} {...actions} {...dragOf({ dragging, board, id: item.id })} board={board} item={item} index={index} stage={stage} />)}
    </div>
  )
}

/** The lane's chosen items, in lane order: the ones of this part of it that are chosen. */
export const chosenIn = ({ lane, selectedIds }: { readonly lane: LaneLayout; readonly selectedIds: ReadonlySet<string> }) =>
  lane.entries
    .flatMap(entry => (entry.kind === 'item' ? [entry.item] : entry.items))
    .flatMap(item => (selectedIds.has(item.id) ? [item.id] : []))
