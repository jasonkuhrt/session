import { CollisionPriority } from '@dnd-kit/abstract'
import { DragDropProvider, useDroppable } from '@dnd-kit/react'
import { isSortable, useSortable } from '@dnd-kit/react/sortable'
import { Check, GripVertical } from 'lucide-react'
import type { Item, Stage, StageFile } from '../../contract'
import { cn } from '../lib/utils'
import { isStage, moveAvailability, stageMeta } from '../lib/workflow'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card, CardContent } from './ui/card'
import { Checkbox } from './ui/checkbox'

/** Where a drag would land: a lane carries no batch, a card carries its own. */
type DropTarget = { stage: Stage; batch: string | null }

type BoardProps = {
  stages: StageFile[]
  pending: boolean
  selectedBatchIds: ReadonlySet<string>
  onOpen: (id: string) => void
  onSelect: (id: string, selected: boolean) => void
  onQueue: () => void
  onStart: () => void
  onComplete: (item: Item) => void
  onMove: (id: string, stage: Stage, beforeId: string | null) => Promise<boolean>
  onDraggingChange: (dragging: boolean) => void
}

/** Queued items arrive in file order, so consecutive items share a heading. */
function batchGroups(items: Item[]) {
  const groups: Array<{ batch: string | null; items: Item[] }> = []
  for (const item of items) {
    const last = groups.at(-1)
    if (last && last.batch === item.batch) last.items.push(item)
    else groups.push({ batch: item.batch, items: [item] })
  }
  return groups
}

function startReason(executeOccupied: boolean, queued: number) {
  if (executeOccupied) return 'Execution occupied'
  if (queued === 0) return 'No queued batches'
  return null
}

export function Board(props: BoardProps) {
  const findItem = (id: unknown) => {
    for (const stage of props.stages) {
      const item = stage.items.find(candidate => candidate.id === id)
      if (item) return { item, stage: stage.stage }
    }
    return null
  }
  // Execute is entered only by starting the next queued batch and Queue only by
  // composing one in Batch, so neither accepts a drop. A queued card may still
  // reorder against its own batch's cards.
  const accepts = (id: unknown, target: DropTarget) => {
    const source = findItem(id)
    if (source === null) return false
    if (target.stage === 'EXECUTE') return false
    if (target.stage === 'QUEUE') {
      return source.stage === 'QUEUE' && target.batch !== null && source.item.batch === target.batch
    }
    if (source.stage === target.stage) return true
    return moveAvailability(source.item, source.stage, target.stage).enabled
  }
  const executeOccupied = props.stages.some(stage => stage.stage === 'EXECUTE' && stage.items.length > 0)

  return (
    <DragDropProvider
      onDragStart={() => props.onDraggingChange(true)}
      onDragEnd={event => {
        const { source, target } = event.operation
        if (event.canceled || !isSortable(source) || !target) {
          props.onDraggingChange(false)
          return
        }
        const to = target.data['stage']
        const batch = typeof target.data['batch'] === 'string' ? target.data['batch'] : null
        const entry = findItem(source.id)
        if (!entry || !isStage(to) || !accepts(source.id, { stage: to, batch })) {
          props.onDraggingChange(false)
          return
        }
        // dnd-kit supplies the final optimistic index within the target group.
        // Persist a stable neighbor ID so the engine owns the actual move and
        // resulting order; a queued card's neighbours are its own batch.
        const destination = props.stages.find(stage => stage.stage === to)
        const peers = destination?.items.filter(item => item.id !== entry.item.id && item.batch === batch) ?? []
        const beforeId = target.type === 'lane' ? null : peers[source.index]?.id ?? null
        void props.onMove(entry.item.id, to, beforeId).finally(() => props.onDraggingChange(false))
      }}
    >
      <div className="grid min-w-300 grid-cols-5 items-start gap-4">
        {props.stages.map(stage => (
          <Lane key={stage.stage} {...props} stage={stage} accepts={accepts} executeOccupied={executeOccupied} />
        ))}
      </div>
    </DragDropProvider>
  )
}

type LaneProps = BoardProps & {
  stage: StageFile
  accepts: (id: unknown, target: DropTarget) => boolean
  executeOccupied: boolean
}

function Lane({ stage, accepts, executeOccupied, ...props }: LaneProps) {
  const { ref, isDropTarget } = useDroppable({
    id: `lane:${stage.stage}`,
    type: 'lane',
    data: { stage: stage.stage, batch: null },
    accept: source => accepts(source.id, { stage: stage.stage, batch: null }),
    collisionPriority: CollisionPriority.Low,
    disabled: props.pending,
  })
  const meta = stageMeta[stage.stage]
  const blocked = startReason(executeOccupied, stage.items.length)
  return (
    <section ref={ref} className="min-w-0 space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="font-medium">{meta.label}</h2>
        <Badge variant="secondary">{stage.items.length}</Badge>
      </div>
      <p className="text-sm text-muted-foreground">{meta.hint}</p>
      {stage.stage === 'BATCH' ? (
        <Button variant="outline" className="w-full" disabled={props.pending || props.selectedBatchIds.size === 0} onClick={props.onQueue}>
          Queue batch ({props.selectedBatchIds.size})
        </Button>
      ) : null}
      {stage.stage === 'QUEUE' ? (
        <Button variant="outline" className="w-full" disabled={props.pending || blocked !== null} onClick={props.onStart}>
          {blocked ?? 'Start next batch'}
        </Button>
      ) : null}
      <div className={cn('min-h-32 space-y-3 rounded-lg', isDropTarget && 'outline-2 outline-primary outline-dashed')}>
        {stage.stage === 'QUEUE'
          ? batchGroups(stage.items).map(group => (
            <div key={`${group.batch}`} className="space-y-3">
              <h3 className="text-sm font-medium text-muted-foreground">{group.batch}</h3>
              {group.items.map((item, index) => (
                <WorkflowCard key={item.id} item={item} index={index} stage={stage.stage} group={`QUEUE:${group.batch}`} accepts={accepts} {...props} />
              ))}
            </div>
          ))
          : stage.items.map((item, index) => (
            <WorkflowCard key={item.id} item={item} index={index} stage={stage.stage} group={stage.stage} accepts={accepts} {...props} />
          ))}
        {stage.items.length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">No items</p> : null}
      </div>
    </section>
  )
}

function WorkflowCard({ item, index, stage, group, accepts, ...props }: BoardProps & {
  item: Item
  index: number
  stage: Stage
  group: string
  accepts: (id: unknown, target: DropTarget) => boolean
}) {
  // Execute is frozen: its cards leave only by completing, never by dragging.
  const frozen = stage === 'EXECUTE'
  const { ref, handleRef, isDropTarget, isDragSource } = useSortable({
    id: item.id,
    index,
    group,
    type: 'item',
    data: { stage, batch: item.batch },
    accept: source => accepts(source.id, { stage, batch: item.batch }),
    disabled: props.pending || frozen,
  })
  return (
    <div ref={ref} className="relative">
      {isDropTarget ? <div className="pointer-events-none absolute inset-x-0 -top-2 h-1 rounded-full bg-primary" /> : null}
      <Card size="sm" className={cn(isDragSource && 'opacity-50')}>
        <CardContent className="space-y-3">
          <div className="flex items-start gap-2">
            {stage === 'BATCH' ? <Checkbox checked={props.selectedBatchIds.has(item.id)} onCheckedChange={selected => props.onSelect(item.id, selected)} aria-label={`Select ${item.title}`} /> : null}
            <button type="button" className="min-w-0 flex-1 text-left font-medium" onClick={() => props.onOpen(item.id)}>{item.title}</button>
            {frozen ? null : <Button ref={handleRef} variant="ghost" size="icon-xs" aria-label={`Drag ${item.title}`}><GripVertical /></Button>}
          </div>
          {item.summary ? <p className="line-clamp-3 text-sm text-muted-foreground">{item.summary}</p> : null}
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{item.id}</span>
            {item.batch && stage !== 'QUEUE' ? <Badge variant="outline">{item.batch}</Badge> : null}
            {frozen ? <Button className="ml-auto" variant="ghost" size="icon-xs" onClick={() => props.onComplete(item)} aria-label={`Complete ${item.title}`}><Check /></Button> : null}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
