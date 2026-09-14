import { CollisionPriority } from '@dnd-kit/abstract'
import { PointerActivationConstraints } from '@dnd-kit/dom'
import { DragDropProvider, KeyboardSensor, PointerSensor, useDroppable } from '@dnd-kit/react'
import { isSortable, useSortable } from '@dnd-kit/react/sortable'
import { Check, GripVertical } from 'lucide-react'
import type { Item, Stage, StageFile } from '../../contract'
import { isBatchedStage } from '../../contract'
import { itemHref } from '../lib/base'
import { cn } from '../lib/utils'
import { Copyable } from './copyable'
import { isStage, moveAvailability, stageMeta } from '../lib/workflow'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card, CardContent } from './ui/card'
import { Checkbox } from './ui/checkbox'

/**
 * A card is dragged by its whole self, so nobody has to hit a grip. Without a
 * handle the pointer sensor's own default is a 200ms press, which reads as the
 * card refusing to move; a short distance instead means the gesture is decided
 * by whether you moved, so a plain click on the title, the checkbox or the
 * complete button is still a click. The keyboard sensor is the stock one, kept
 * so cards still sort from the keyboard.
 */
const dragThresholdPixels = 5

const sensors = [
  PointerSensor.configure({
    activationConstraints: [new PointerActivationConstraints.Distance({ value: dragThresholdPixels })],
  }),
  KeyboardSensor,
]

/** Where a drag would land: a lane carries no batch, a card carries its own. */
type DropTarget = { stage: Stage; batch: string | null }

type BoardProps = {
  stages: StageFile[]
  pending: boolean
  selectedBatchIds: ReadonlySet<string>
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
  if (executeOccupied) return 'Execute already has a batch'
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
      sensors={sensors}
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
        <Badge
          variant={stage.items.length === 0 ? 'outline' : 'secondary'}
          className={cn(stage.items.length === 0 && 'text-muted-foreground')}
        >
          {stage.items.length}
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground">{meta.hint}</p>
      {stage.stage === 'BATCH' ? (
        <Button variant="outline" className="w-full" disabled={props.pending || props.selectedBatchIds.size === 0} onClick={props.onQueue}>
          {props.selectedBatchIds.size === 0 ? 'Select items to queue' : `Queue batch (${props.selectedBatchIds.size})`}
        </Button>
      ) : null}
      {stage.stage === 'QUEUE' ? (
        <Button variant="outline" className="w-full" disabled={props.pending || blocked !== null} onClick={props.onStart}>
          {blocked ?? 'Start next batch'}
        </Button>
      ) : null}
      <div className={cn('min-h-32 space-y-3 rounded-lg', isDropTarget && 'outline-2 outline-primary outline-dashed')}>
        {isBatchedStage(stage.stage)
          ? batchGroups(stage.items).map(group => (
            <div key={`${group.batch}`} className="space-y-3">
              <h3 className="text-xs font-medium tracking-wide text-foreground">{group.batch}</h3>
              {group.items.map((item, index) => (
                <WorkflowCard key={item.id} item={item} index={index} stage={stage.stage} group={`${stage.stage}:${group.batch}`} accepts={accepts} {...props} />
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
  const { ref, isDropTarget, isDragSource } = useSortable({
    id: item.id,
    index,
    group,
    type: 'item',
    data: { stage, batch: item.batch },
    accept: source => accepts(source.id, { stage, batch: item.batch }),
    disabled: props.pending || frozen,
  })
  return (
    // The card is the drag surface now, so it is what the keyboard reaches and
    // what the sortable's keyboard sensor listens on. It carries the name the
    // grip used to carry, and no button role: it holds a link and a checkbox,
    // and a button may not contain those.
    <div
      ref={ref}
      tabIndex={frozen ? undefined : 0}
      aria-roledescription={frozen ? undefined : 'Draggable card'}
      aria-label={frozen ? undefined : `Drag ${item.title}`}
      className={cn(
        'relative rounded-xl outline-none',
        frozen ? undefined : 'cursor-grab focus-visible:ring-3 focus-visible:ring-ring/50',
        !frozen && isDragSource && 'cursor-grabbing',
      )}
    >
      {isDropTarget ? <div className="pointer-events-none absolute inset-x-0 -top-2 h-1 rounded-full bg-primary" /> : null}
      <Card size="sm" className={cn(isDragSource && 'opacity-50')}>
        <CardContent className="space-y-3">
          <div className="flex items-start gap-2">
            {stage === 'BATCH' ? <Checkbox checked={props.selectedBatchIds.has(item.id)} onCheckedChange={selected => props.onSelect(item.id, selected)} aria-label={`Select ${item.title}`} /> : null}
            {/* A real link: the item has a page, so it opens in a tab like anything else. */}
            <a
              href={itemHref(item.id)}
              className="min-w-0 flex-1 rounded-sm text-left font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {item.title}
            </a>
            {/* The whole card drags, so this is a hint about the card and not a control of its own. */}
            {frozen ? null : <GripVertical aria-hidden className="mt-0.5 size-3 shrink-0 text-muted-foreground" />}
          </div>
          {item.summary ? <p className="line-clamp-3 text-sm text-muted-foreground">{item.summary}</p> : null}
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Copyable value={item.id}>{item.id}</Copyable>
            {frozen ? <Button className="ml-auto" variant="ghost" size="icon-xs" onClick={() => props.onComplete(item)} title={`Complete ${item.title}`} aria-label={`Complete ${item.title}`}><Check /></Button> : null}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
