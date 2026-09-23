import { CollisionPriority } from '@dnd-kit/abstract'
import { useDroppable } from '@dnd-kit/react'

import type { Item, Stage } from '../../contract'
import { isBatchedStage } from '../../contract'
import type { Lane as LaneLayout, Placement } from '../lib/lanes'
import { listId } from '../lib/lanes'
import { cn } from '../lib/utils'
import { groupMeta, stageMeta } from '../lib/workflow'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
import type { CardActions } from './workflow-card'
import { WorkflowCard } from './workflow-card'

/** What a lane can do with its cards, besides what each card does itself. */
export type LaneActions = CardActions & {
  readonly onGroup: (stage: Stage, ids: readonly string[]) => void
  readonly onQueue: (ids: readonly string[], group: string | null) => void
  readonly onUngroup: (ids: readonly string[]) => void
  readonly onStart: () => void
}

/** The outline of the list a held card would be dropped into, the lane's own cards or one group's. */
const landing = 'outline-2 outline-primary outline-dashed outline-offset-2'

export function Lane({ lane, count, held, executeOccupied, ...actions }: LaneActions & {
  lane: LaneLayout
  /** How many items the stage holds on disk; a drag under way does not change it. */
  count: number
  /** Where the card being dragged would land if it were dropped now. */
  held: Placement | null
  executeOccupied: boolean
}) {
  const { stage } = lane
  const { ref } = useDroppable({
    id: `lane:${stage}`,
    type: 'lane',
    data: { stage, group: null },
    accept: source => actions.accepts(source.id, { stage, group: null }),
    // Below a group and below every card, so the lane itself takes a card only
    // where nothing else is under it.
    collisionPriority: CollisionPriority.Lowest,
    disabled: actions.pending,
  })
  const items = lane.entries.flatMap(entry => (entry.kind === 'item' ? [entry.item] : entry.items))
  const selected = items.flatMap(item => (actions.selectedIds.has(item.id) ? [item.id] : []))
  // A card in no group is sorted among the lane's other cards in no group, so
  // its place in that list is what dnd-kit is told.
  const looseIndex = new Map<string, number>()
  for (const entry of lane.entries) if (entry.kind === 'item') looseIndex.set(entry.item.id, looseIndex.size)
  return (
    <section ref={ref} className="min-w-0 space-y-3">
      <LaneHeading stage={stage} count={count} />
      <LaneControls {...actions} stage={stage} selected={selected} count={count} executeOccupied={executeOccupied} />
      {/* The space under the last entry is the lane's own: a card dropped
          there lands at the end of the lane, in no group. */}
      <div className={cn('min-h-32 space-y-3 rounded-lg pb-24', held?.to === stage && held.group === null && landing)}>
        {lane.entries.map(entry => (entry.kind === 'item'
          ? <WorkflowCard key={entry.item.id} {...actions} item={entry.item} index={looseIndex.get(entry.item.id) ?? 0} stage={stage} />
          : <GroupBlock key={`group:${entry.name}`} {...actions} stage={stage} name={entry.name} items={entry.items} landing={held?.to === stage && held.group === entry.name} />))}
      </div>
    </section>
  )
}

function LaneHeading({ stage, count }: { stage: Stage; count: number }) {
  const meta = stageMeta[stage]
  return (
    <div className="flex items-center gap-2">
      {/* What the stage is for is one hover away rather than a line under
          every lane; the heading is what carries it. */}
      <h2 className="font-medium">
        <Tooltip>
          <TooltipTrigger className="cursor-default rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            {meta.label}
          </TooltipTrigger>
          <TooltipContent>{meta.hint}</TooltipContent>
        </Tooltip>
      </h2>
      <Badge
        variant={count === 0 ? 'outline' : 'secondary'}
        className={cn(count === 0 && 'text-muted-foreground')}
        title="How many items are in this stage."
      >
        {count}
      </Badge>
    </div>
  )
}

/**
 * What the lane can do with its selection, and Queue's start. A control
 * appears when it can act. An empty selection and an occupied Execute are both
 * visible in the lanes themselves, so a disabled button carrying the reason
 * would say a second time what the board already shows.
 */
function LaneControls({ stage, selected, count, executeOccupied, pending, onGroup, onQueue, onStart }: LaneActions & {
  stage: Stage
  /** The lane's selected items, in lane order. */
  selected: readonly string[]
  count: number
  executeOccupied: boolean
}) {
  const canGroup = !isBatchedStage(stage) && selected.length > 0
  const canQueue = stage === 'BATCH' && selected.length > 0
  const canStart = stage === 'QUEUE' && count > 0 && !executeOccupied
  return (
    <>
      {canGroup || canQueue ? (
        <div className="flex gap-2">
          {canGroup ? (
            <Tooltip>
              <TooltipTrigger
                render={<Button variant="outline" className="flex-1" disabled={pending} onClick={() => onGroup(stage, selected)} />}
              >
                Group ({selected.length})
              </TooltipTrigger>
              <TooltipContent>Name the selected items as a group in {stageMeta[stage].label}.</TooltipContent>
            </Tooltip>
          ) : null}
          {canQueue ? (
            <Tooltip>
              <TooltipTrigger
                render={<Button variant="outline" className="flex-1" disabled={pending} onClick={() => onQueue(selected, null)} />}
              >
                Queue batch ({selected.length})
              </TooltipTrigger>
              <TooltipContent>Name the selected items as a batch and append it to Queue.</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      ) : null}
      {canStart ? (
        <Tooltip>
          <TooltipTrigger render={<Button variant="outline" className="w-full" disabled={pending} onClick={onStart} />}>
            Start next batch
          </TooltipTrigger>
          <TooltipContent>Move the first queued batch into Execute.</TooltipContent>
        </Tooltip>
      ) : null}
    </>
  )
}

/**
 * One group of a lane: its name as a heading over its cards, in the lane's
 * file order. In Batch a group is a proposed batch and can be queued as one;
 * in the lanes where an item may be in no group it can be taken apart. Queue
 * and Execute hold only batches, which change only by starting and finishing.
 */
function GroupBlock({ stage, name, items, landing: lands, ...actions }: LaneActions & {
  stage: Stage
  name: string
  items: readonly Item[]
  /** Whether a card being dragged would be dropped into this group. */
  landing: boolean
}) {
  const { ref } = useDroppable({
    id: `group:${listId({ stage, group: name })}`,
    type: 'group',
    data: { stage, group: name },
    accept: source => actions.accepts(source.id, { stage, group: name }),
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
  const canQueue = stage === 'BATCH' && ids.length > 0
  const canUngroup = !isBatchedStage(stage) && ids.length > 0
  return (
    <div ref={ref} className={cn('space-y-2 rounded-xl border p-2', lands && landing)}>
      <div className="flex items-start gap-1">
        <h3 className="min-w-0 flex-1 py-1 text-xs font-medium tracking-wide break-words text-foreground">
          <Tooltip>
            <TooltipTrigger className="cursor-default rounded-sm text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
              {name}
            </TooltipTrigger>
            <TooltipContent>{groupMeta[stage].heading}</TooltipContent>
          </Tooltip>
        </h3>
        {canQueue ? (
          <Tooltip>
            <TooltipTrigger
              render={<Button variant="ghost" size="xs" disabled={actions.pending} onClick={() => actions.onQueue(ids, name)} />}
            >
              Queue batch
            </TooltipTrigger>
            <TooltipContent>Name these items as a batch, starting from the name of this group, and append it to Queue.</TooltipContent>
          </Tooltip>
        ) : null}
        {canUngroup ? (
          <Tooltip>
            <TooltipTrigger
              render={<Button variant="ghost" size="xs" disabled={actions.pending} onClick={() => actions.onUngroup(ids)} />}
            >
              Ungroup
            </TooltipTrigger>
            <TooltipContent>Take these items out of the group, each to the end of {stageMeta[stage].label}.</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
      {items.map((item, index) => <WorkflowCard key={item.id} {...actions} item={item} index={index} stage={stage} />)}
    </div>
  )
}
