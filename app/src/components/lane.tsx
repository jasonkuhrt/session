import { CollisionPriority } from '@dnd-kit/abstract'
import { pointerIntersection } from '@dnd-kit/collision'
import { useDroppable } from '@dnd-kit/react'
import type * as React from 'react'

import type { Item, Stage } from '../../contract'
import { isBatchedStage } from '../../contract'
import { landing } from '../lib/drag'
import type { Dragging, Lane as LaneLayout } from '../lib/lanes'
import { dragOf, laneItems, listId } from '../lib/lanes'
import { cn } from '../lib/utils'
import { groupMeta, stageHint } from '../lib/workflow'
import { Explained, Tip, useTip } from './tip'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import type { CardActions, Choosing } from './workflow-card'
import { WorkflowCard } from './workflow-card'

/** What a lane can do with its cards, besides what each card does itself. */
export type LaneActions = CardActions & {
  readonly onChoose: (choosing: Choosing) => void
  readonly onGroup: (stage: Stage, ids: readonly string[]) => void
  readonly onQueue: (ids: readonly string[], group: string | null) => void
  readonly onUngroup: (ids: readonly string[]) => void
  readonly onStart: () => void
}

/**
 * A part of a lane that takes a card into the lane itself, in no group. The
 * heading takes it to the lane's start and the space below the last entry to
 * its end; both rank with a group, so the pointer over them outweighs a card
 * the held card merely overlaps. The rest of the lane ranks below everything
 * and places a card by which half of the lane it is over.
 */
function useLaneDrop(stage: Stage, at: 'start' | 'end' | 'half', { accepts, pending }: Pick<LaneActions, 'accepts' | 'pending'>) {
  return useDroppable({
    id: `lane-${at}:${stage}`,
    type: 'lane',
    data: { stage, group: null, at },
    accept: source => accepts(source.id, { stage, group: null }),
    collisionPriority: at === 'half' ? CollisionPriority.Lowest : CollisionPriority.Normal,
    disabled: pending,
  })
}

export function Lane({ lane, count, dragging, executeOccupied, ...actions }: LaneActions & {
  lane: LaneLayout
  /** How many items the stage holds on disk; a drag under way does not change it. */
  count: number
  /** The card being dragged, and what dropping it now would do. */
  dragging: Dragging | null
  executeOccupied: boolean
}) {
  const { stage } = lane
  const held = dragging?.landing ?? null
  const { ref: wholeRef } = useLaneDrop(stage, 'half', actions)
  const { ref: startRef } = useLaneDrop(stage, 'start', actions)
  const { ref: endRef } = useLaneDrop(stage, 'end', actions)
  const chosen = laneItems(lane).flatMap(item => (actions.chosenIds.has(item.id) ? [item.id] : []))
  // A card in no group is sorted among the lane's other cards in no group, so
  // its place in that list is what dnd-kit is told.
  const looseIndex = new Map<string, number>()
  for (const entry of lane.entries) if (entry.kind === 'item') looseIndex.set(entry.item.id, looseIndex.size)
  return (
    <section ref={wholeRef} className="min-w-0 space-y-3">
      <div ref={startRef} className="space-y-3">
        <LaneHeading stage={stage} count={count}>
          {/* Choosing starts from the lane, named for what the chosen cards
              become, in the lanes where an item may be in no group. */}
          {!isBatchedStage(stage) && count > 0 && actions.choosing?.stage !== stage
            ? <ChooseEntries stage={stage} pending={actions.pending} onChoose={actions.onChoose} />
            : null}
        </LaneHeading>
        <LaneControls {...actions} stage={stage} chosen={chosen} count={count} executeOccupied={executeOccupied} />
      </div>
      <div className={cn('min-h-32 space-y-3 rounded-lg', held?.to === stage && held.group === null && landing)}>
        {lane.entries.map(entry => (entry.kind === 'item'
          ? <WorkflowCard key={entry.item.id} {...actions} {...dragOf({ dragging, id: entry.item.id })} item={entry.item} index={looseIndex.get(entry.item.id) ?? 0} stage={stage} />
          : <GroupBlock key={`group:${entry.name}`} {...actions} stage={stage} name={entry.name} items={entry.items} dragging={dragging} landing={held?.to === stage && held.group === entry.name} />))}
        {/* The space under the last entry is the lane's own: a card dropped
            there lands at the end of the lane, in no group. */}
        <div ref={endRef} className="h-24" />
      </div>
    </section>
  )
}

function LaneHeading({ stage, count, children }: { stage: Stage; count: number; children?: React.ReactNode }) {
  const tip = useTip()
  return (
    <div className="flex items-center gap-2">
      {/* What the stage is for is one hover away rather than a line under
          every lane; the heading is what carries it. */}
      <h2 className="font-medium">
        <Explained meaning={stageHint[stage]}>{stage}</Explained>
      </h2>
      <Badge
        variant={count === 0 ? 'outline' : 'secondary'}
        className={cn(count === 0 && 'text-muted-foreground')}
        title={tip('How many items are in this stage.')}
      >
        {count}
      </Badge>
      <div className="ml-auto flex items-center gap-1">{children}</div>
    </div>
  )
}

/**
 * The ways into choosing a lane's cards, each named for what the chosen cards
 * become: a group in any lane where an item may be in no group, and a batch
 * for Queue from Batch.
 */
function ChooseEntries({ stage, pending, onChoose }: {
  stage: Stage
  pending: boolean
  onChoose: (choosing: Choosing) => void
}) {
  return (
    <>
      <Tip
        meaning={`Choose items of ${stage} to name as a group.`}
        render={<Button variant="ghost" size="xs" disabled={pending} onClick={() => onChoose({ stage, purpose: 'group' })} />}
      >
        Group…
      </Tip>
      {stage === 'Batch' ? (
        <Tip
          meaning="Choose items of Batch to name as a batch and append to Queue."
          render={<Button variant="ghost" size="xs" disabled={pending} onClick={() => onChoose({ stage, purpose: 'batch' })} />}
        >
          Queue batch…
        </Tip>
      ) : null}
    </>
  )
}

/**
 * While the lane is choosing: what the chosen cards become, once there is one,
 * and the way out. Until a card is chosen the lane says what to do instead.
 */
function ChoosingControls({ stage, purpose, chosen, pending, onGroup, onQueue, onChoose }: Pick<
  LaneActions,
  'pending' | 'onGroup' | 'onQueue' | 'onChoose'
> & {
  stage: Stage
  purpose: 'group' | 'batch'
  /** The lane's chosen items, in lane order. */
  chosen: readonly string[]
}) {
  return (
    <div className="flex items-center gap-2">
      {chosen.length === 0
        ? <p className="flex-1 text-sm text-muted-foreground">Choose the items for the {purpose}.</p>
        : purpose === 'group'
        ? (
          <Tip
            meaning={`Name the chosen items as a group in ${stage}.`}
            render={<Button variant="outline" className="flex-1" disabled={pending} onClick={() => onGroup(stage, chosen)} />}
          >
            Group ({chosen.length})
          </Tip>
        )
        : (
          <Tip
            meaning="Name the chosen items as a batch and append it to Queue."
            render={<Button variant="outline" className="flex-1" disabled={pending} onClick={() => onQueue(chosen, null)} />}
          >
            Queue batch ({chosen.length})
          </Tip>
        )}
      <Tip meaning="Stop choosing. Nothing changes." render={<Button variant="ghost" onClick={() => onChoose(null)} />}>
        Cancel
      </Tip>
    </div>
  )
}

/**
 * What the lane can do while it is choosing, and Queue's start. A control
 * appears when it can act. An empty choice and an occupied Execute are both
 * visible in the lanes themselves, so a disabled button carrying the reason
 * would say a second time what the board already shows.
 */
function LaneControls({ stage, choosing, chosen, count, executeOccupied, pending, onGroup, onQueue, onChoose, onStart }: LaneActions & {
  stage: Stage
  /** The lane's chosen items, in lane order. */
  chosen: readonly string[]
  count: number
  executeOccupied: boolean
}) {
  const canStart = stage === 'Queue' && count > 0 && !executeOccupied
  return (
    <>
      {choosing?.stage === stage ? (
        <ChoosingControls
          stage={stage}
          purpose={choosing.purpose}
          chosen={chosen}
          pending={pending}
          onGroup={onGroup}
          onQueue={onQueue}
          onChoose={onChoose}
        />
      ) : null}
      {canStart ? (
        <Tip
          meaning="Move the first queued batch into Execute."
          render={<Button variant="outline" className="w-full" disabled={pending} onClick={onStart} />}
        >
          Start next batch
        </Tip>
      ) : null}
    </>
  )
}

/**
 * One group of a lane: its name as a heading over its cards, in the lane's
 * file order. In Batch a group is a proposed batch and can be queued as one;
 * in the lanes where an item may be in no group it can be taken apart. Queue
 * and Execute hold only batches, which change only by starting and finishing.
 * A card dropped on its heading joins it last, and one dropped on its edges
 * joins it at its start or its end, by which half of it the card is over.
 */
function GroupBlock({ stage, name, items, dragging, landing: lands, ...actions }: LaneActions & {
  stage: Stage
  name: string
  items: readonly Item[]
  dragging: Dragging | null
  /** Whether a card being dragged would be dropped into this group. */
  landing: boolean
}) {
  const accept = (source: { readonly id: unknown }) => actions.accepts(source.id, { stage, group: name })
  const { ref } = useDroppable({
    id: `group:${listId({ stage, group: name })}`,
    type: 'group',
    data: { stage, group: name },
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
    id: `heading:${listId({ stage, group: name })}`,
    type: 'group',
    data: { stage, group: name, at: 'end' },
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
            render={<Button variant="ghost" size="xs" disabled={actions.pending} onClick={() => actions.onQueue(ids, name)} />}
          >
            Queue batch
          </Tip>
        ) : null}
        {canUngroup ? (
          <Tip
            meaning={`Take these items out of the group, each to the end of ${stage}.`}
            render={<Button variant="ghost" size="xs" disabled={actions.pending} onClick={() => actions.onUngroup(ids)} />}
          >
            Ungroup
          </Tip>
        ) : null}
      </div>
      {items.map((item, index) => <WorkflowCard key={item.id} {...actions} {...dragOf({ dragging, id: item.id })} item={item} index={index} stage={stage} />)}
    </div>
  )
}
