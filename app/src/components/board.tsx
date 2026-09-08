import { CollisionPriority } from '@dnd-kit/abstract'
import { DragDropProvider, useDroppable } from '@dnd-kit/react'
import { isSortable, useSortable } from '@dnd-kit/react/sortable'
import { Check, ExternalLink, FilePenLine, GripVertical, MoreHorizontal, Plus } from 'lucide-react'
import type { Item, Stage, StageFile } from '../../contract'
import { cn } from '../lib/utils'
import { isStage, moveAvailability, stageMeta } from '../lib/workflow'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card, CardContent } from './ui/card'
import { Checkbox } from './ui/checkbox'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu'

type BoardProps = {
  stages: StageFile[]
  pending: boolean
  selectedBatchIds: ReadonlySet<string>
  onOpen: (id: string) => void
  onEdit: (stage: Stage) => void
  onAdd: () => void
  onSelect: (id: string, selected: boolean) => void
  onBatch: () => void
  onComplete: (item: Item) => void
  onMove: (id: string, stage: Stage, beforeId: string | null) => Promise<boolean>
  onDraggingChange: (dragging: boolean) => void
}

export function Board(props: BoardProps) {
  const findItem = (id: unknown) => {
    for (const stage of props.stages) {
      const item = stage.items.find(candidate => candidate.id === id)
      if (item) return { item, stage: stage.stage }
    }
    return null
  }
  const accepts = (id: unknown, to: Stage) => {
    const source = findItem(id)
    return source !== null && (source.stage === to || moveAvailability(source.item, source.stage, to).enabled)
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
        const to = target.type === 'lane' ? target.data['stage'] : source.group
        const entry = findItem(source.id)
        if (!entry || !isStage(to) || !accepts(source.id, to)) {
          props.onDraggingChange(false)
          return
        }
        // dnd-kit supplies the final optimistic index. Persist a stable neighbor
        // ID so the Markdown engine owns the actual move and resulting order.
        const destination = props.stages.find(stage => stage.stage === to)
        const peers = destination?.items.filter(item => item.id !== entry.item.id) ?? []
        const beforeId = target.type === 'lane' ? null : peers[source.index]?.id ?? null
        void props.onMove(entry.item.id, to, beforeId).finally(() => props.onDraggingChange(false))
      }}
    >
      <div className="grid min-w-240 grid-cols-4 items-start gap-4">
        {props.stages.map(stage => (
          <Lane key={stage.stage} {...props} stage={stage} accepts={accepts} executeOccupied={executeOccupied} />
        ))}
      </div>
    </DragDropProvider>
  )
}

type LaneProps = BoardProps & {
  stage: StageFile
  accepts: (id: unknown, to: Stage) => boolean
  executeOccupied: boolean
}

function Lane({ stage, accepts, executeOccupied, ...props }: LaneProps) {
  const { ref, isDropTarget } = useDroppable({
    id: `lane:${stage.stage}`,
    type: 'lane',
    data: { stage: stage.stage },
    accept: source => accepts(source.id, stage.stage),
    collisionPriority: CollisionPriority.Low,
    disabled: props.pending,
  })
  const meta = stageMeta[stage.stage]
  return (
    <section ref={ref} className="min-w-0 space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="font-medium">{meta.label}</h2>
        <Badge variant="secondary">{stage.items.length}</Badge>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" className="ml-auto" aria-label={`${meta.label} actions`} />}>
            <MoreHorizontal />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {stage.stage === 'TRIAGE' ? <DropdownMenuItem onClick={props.onAdd}><Plus /> Add candidate</DropdownMenuItem> : null}
            <DropdownMenuItem onClick={() => props.onEdit(stage.stage)}><FilePenLine /> Edit source file</DropdownMenuItem>
            <DropdownMenuItem render={<a aria-label={`Open ${stage.stage} Markdown`} href={`/files/${stage.stage}.md`} target="_blank" rel="noreferrer" />}><ExternalLink /> Open Markdown</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <p className="text-sm text-muted-foreground">{meta.hint}</p>
      {stage.stage === 'BATCH' ? (
        <Button variant="outline" className="w-full" disabled={props.pending || props.selectedBatchIds.size === 0 || executeOccupied} onClick={props.onBatch}>
          {executeOccupied ? 'Execution occupied' : `Start batch (${props.selectedBatchIds.size})`}
        </Button>
      ) : null}
      <div className={cn('min-h-32 space-y-3 rounded-lg', isDropTarget && 'outline-2 outline-primary outline-dashed')}>
        {stage.items.map((item, index) => (
          <WorkflowCard key={item.id} item={item} index={index} stage={stage.stage} accepts={accepts} {...props} />
        ))}
        {stage.items.length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">No items</p> : null}
      </div>
    </section>
  )
}

function WorkflowCard({ item, index, stage, accepts, ...props }: BoardProps & {
  item: Item
  index: number
  stage: Stage
  accepts: (id: unknown, to: Stage) => boolean
}) {
  const { ref, handleRef, isDropTarget, isDragSource } = useSortable({
    id: item.id,
    index,
    group: stage,
    type: 'item',
    accept: source => accepts(source.id, stage),
    disabled: props.pending,
  })
  return (
    <div ref={ref} className="relative">
      {isDropTarget ? <div className="pointer-events-none absolute inset-x-0 -top-2 h-1 rounded-full bg-primary" /> : null}
      <Card size="sm" className={cn(isDragSource && 'opacity-50')}>
        <CardContent className="space-y-3">
          <div className="flex items-start gap-2">
            {stage === 'BATCH' ? <Checkbox checked={props.selectedBatchIds.has(item.id)} onCheckedChange={selected => props.onSelect(item.id, selected)} aria-label={`Select ${item.title}`} /> : null}
            <button type="button" className="min-w-0 flex-1 text-left font-medium" onClick={() => props.onOpen(item.id)}>{item.title}</button>
            <Button ref={handleRef} variant="ghost" size="icon-xs" aria-label={`Drag ${item.title}`}><GripVertical /></Button>
          </div>
          {item.summary ? <p className="line-clamp-3 text-sm text-muted-foreground">{item.summary}</p> : null}
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{item.id}</span>
            {item.group ? <Badge variant="outline">{item.group}</Badge> : null}
            {stage === 'EXECUTE' ? <Button className="ml-auto" variant="ghost" size="icon-xs" onClick={() => props.onComplete(item)} aria-label={`Complete ${item.title}`}><Check /></Button> : null}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
