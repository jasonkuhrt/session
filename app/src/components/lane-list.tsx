import { CollisionPriority } from '@dnd-kit/abstract'
import { pointerIntersection } from '@dnd-kit/collision'
import { useDroppable } from '@dnd-kit/react'

import type { Item, Stage } from '../../contract'
import { landing } from '../lib/drag'
import type { Dragging } from '../lib/lanes'
import { dragOf, landingIn, listId } from '../lib/lanes'
import { cn } from '../lib/utils'
import { groupMeaning } from '../lib/workflow'
import { Node } from '../substrate/node'
import type { Path } from '../substrate/seam'
import type { LanePart, PathsOf } from './lane'
import { useTip } from './tip'
import type { CardActions } from './workflow-card'
import { WorkflowCard } from './workflow-card'

/**
 * One worktree's entries in a lane, in file order: its cards in no group and
 * its groups, then the space under the last entry, which is its own: a card
 * dropped there lands at the end of its lane, in no group. The list is
 * outlined while a held card of this worktree would land in it in no group.
 */
export function LaneList({ part, stage, dragging, endRef, paths, className, endClassName, ...actions }: CardActions & {
  part: LanePart
  stage: Stage
  /** The card being dragged, and what dropping it now would do; drawn only if it is this worktree's. */
  dragging: Dragging | null
  endRef: (element: Element | null) => void
  paths: PathsOf
  /** How tall the list is at least, and the space under its last entry. */
  className: string
  endClassName: string
}) {
  const { board, key, lane } = part
  // A card in no group is sorted among the lane's other cards in no group, so
  // its place in that list is what dnd-kit is told.
  const looseIndex = new Map<string, number>()
  for (const entry of lane.entries) if (entry.kind === 'item') looseIndex.set(entry.item.id, looseIndex.size)
  const landsIn = landingIn({ dragging, board })
  const heldHere = landsIn !== null && landsIn.to === stage ? landsIn : null
  return (
    <div className={cn(className, 'flex flex-col gap-2 rounded-md', heldHere?.group === null && landing)}>
      {lane.entries.map((entry) => (entry.kind === 'item'
        ? (
          <WorkflowCard
            key={entry.item.id}
            {...actions}
            {...dragOf({ dragging, board, id: entry.item.id })}
            path={paths.item({ key, stage, group: null, id: entry.item.id })}
            board={board}
            item={entry.item}
            index={looseIndex.get(entry.item.id) ?? 0}
            stage={stage}
          />
        )
        : (
          <GroupBlock
            key={`group:${entry.name}`}
            {...actions}
            path={paths.group({ key, stage, name: entry.name })}
            paths={paths}
            board={board}
            groupKey={key}
            stage={stage}
            name={entry.name}
            items={entry.items}
            dragging={dragging}
            landing={heldHere?.group === entry.name}
          />
        )))}
      <div ref={endRef} className={endClassName} />
    </div>
  )
}

/**
 * One group of a lane: its name as a heading over its cards, in the lane's
 * file order, the heading a node the focus can be on. A card dropped on its
 * heading joins it last, and one dropped on its edges joins it at its start
 * or its end, by which half of it the card is over. A group is one
 * worktree's, and takes only that worktree's cards.
 */
function GroupBlock({ path, paths, board, groupKey, stage, name, items, dragging, landing: lands, ...actions }: CardActions & {
  path: Path
  paths: PathsOf
  board: string
  /** The key of the worktree the group is filed in. */
  groupKey: string
  stage: Stage
  name: string
  items: readonly Item[]
  dragging: Dragging | null
  /** Whether a card being dragged would be dropped into this group. */
  landing: boolean
}) {
  const tip = useTip()
  const accept = (source: { readonly id: unknown }) => actions.accepts(source.id, { board, stage, group: name })
  const { ref } = useDroppable({
    id: `group:${listId({ board, stage, group: name })}`,
    type: 'group',
    data: { board, stage, group: name },
    accept,
    collisionPriority: CollisionPriority.Normal,
    disabled: actions.pending,
  })
  // The heading is a place of its own, the group's end: the pointer alone
  // decides it, and it outranks the group around it. It spans the group's top
  // edge, so a card brought from above meets the heading before any part of
  // the group that would place it first.
  const { ref: headingRef } = useDroppable({
    id: `heading:${listId({ board, stage, group: name })}`,
    type: 'group',
    data: { board, stage, group: name, at: 'end' },
    accept,
    collisionDetector: pointerIntersection,
    collisionPriority: CollisionPriority.High,
    disabled: actions.pending,
  })
  return (
    <div ref={ref} className={cn('flex flex-col gap-2 rounded-md', lands && landing)}>
      <Node path={path} nodeRef={headingRef} className="px-2.5 py-1 text-xs font-medium tracking-wide text-muted-foreground">
        <span title={tip(groupMeaning[stage])}>{name}</span>
      </Node>
      <div className="flex flex-col gap-2 pl-3">
        {items.map((item, index) => (
          <WorkflowCard
            key={item.id}
            {...actions}
            {...dragOf({ dragging, board, id: item.id })}
            path={paths.item({ key: groupKey, stage, group: name, id: item.id })}
            board={board}
            item={item}
            index={index}
            stage={stage}
          />
        ))}
      </div>
    </div>
  )
}
