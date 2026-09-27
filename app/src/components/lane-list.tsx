import { CollisionPriority } from '@dnd-kit/abstract'
import { useDroppable } from '@dnd-kit/react'

import type { Item, Stage } from '../../contract'
import { isBatchedStage } from '../../contract'
import { landing } from '../lib/drag'
import type { Lane as LaneLayout } from '../lib/lanes'
import { listId } from '../lib/lanes'
import { cn } from '../lib/utils'
import { groupMeta } from '../lib/workflow'
import type { HeldPlacement, LaneActions } from './lane'
import { Explained, Tip } from './tip'
import { Button } from './ui/button'
import { WorkflowCard } from './workflow-card'

/**
 * One worktree's entries in a lane, in file order: its cards in no group and
 * its groups, then the space under the last entry, which is its own: a card
 * dropped there lands at the end of its lane, in no group. The list is
 * outlined while a held card of this worktree would land in it in no group.
 */
export function LaneList({ board, stage, lane, held, endRef, className, endClassName, ...actions }: LaneActions & {
  board: string
  stage: Stage
  lane: LaneLayout
  held: HeldPlacement
  endRef: (element: Element | null) => void
  /** How tall the list is at least, and the space under its last entry. */
  className: string
  endClassName: string
}) {
  // A card in no group is sorted among the lane's other cards in no group, so
  // its place in that list is what dnd-kit is told.
  const looseIndex = new Map<string, number>()
  for (const entry of lane.entries) if (entry.kind === 'item') looseIndex.set(entry.item.id, looseIndex.size)
  const heldHere = held !== null && held.board === board && held.placement.to === stage ? held.placement : null
  return (
    <div className={cn(className, 'space-y-3 rounded-lg', heldHere?.group === null && landing)}>
      {lane.entries.map(entry => (entry.kind === 'item'
        ? <WorkflowCard key={entry.item.id} {...actions} board={board} item={entry.item} index={looseIndex.get(entry.item.id) ?? 0} stage={stage} />
        : <GroupBlock key={`group:${entry.name}`} {...actions} board={board} stage={stage} name={entry.name} items={entry.items} landing={heldHere?.group === entry.name} />))}
      <div ref={endRef} className={endClassName} />
    </div>
  )
}

/**
 * One group of a lane: its name as a heading over its cards, in the lane's
 * file order. In Batch a group is a proposed batch and can be queued as one;
 * in the lanes where an item may be in no group it can be taken apart. Queue
 * and Execute hold only batches, which change only by starting and finishing.
 * A group is one worktree's, and takes only that worktree's cards.
 */
function GroupBlock({ board, stage, name, items, landing: lands, ...actions }: LaneActions & {
  board: string
  stage: Stage
  name: string
  items: readonly Item[]
  /** Whether a card being dragged would be dropped into this group. */
  landing: boolean
}) {
  const { ref } = useDroppable({
    id: `group:${listId({ board, stage, group: name })}`,
    type: 'group',
    data: { board, stage, group: name },
    accept: source => actions.accepts(source.id, { board, stage, group: name }),
    // A card under the pointer is what a held card is over; otherwise the
    // group under the pointer is, ahead of any card the held card merely
    // overlaps and of the lane. Its pointer collision ranks with cards' overlap
    // collisions and above them, so its heading and its edges take a card
    // even with cards around them, and a group a drag has emptied still does.
    collisionPriority: CollisionPriority.Normal,
    disabled: actions.pending,
  })
  const ids = items.map(item => item.id)
  // A drag can empty a group before the move is written; there is nothing in
  // it to queue or to take out until then.
  const canQueue = stage === 'Batch' && ids.length > 0
  const canUngroup = !isBatchedStage(stage) && ids.length > 0
  return (
    <div ref={ref} className={cn('space-y-2 rounded-xl border p-2', lands && landing)}>
      <div className="flex items-start gap-1">
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
      {items.map((item, index) => <WorkflowCard key={item.id} {...actions} board={board} item={item} index={index} stage={stage} />)}
    </div>
  )
}

/** The lane's chosen items, in lane order: the ones of this part of it that are chosen. */
export const chosenIn = ({ lane, selectedIds }: { readonly lane: LaneLayout; readonly selectedIds: ReadonlySet<string> }) =>
  lane.entries
    .flatMap(entry => (entry.kind === 'item' ? [entry.item] : entry.items))
    .flatMap(item => (selectedIds.has(item.id) ? [item.id] : []))
