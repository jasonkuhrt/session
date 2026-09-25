import { useSortable } from '@dnd-kit/react/sortable'
import { Check } from 'lucide-react'

import type { Item, Stage } from '../../contract'
import { itemHref } from '../lib/base'
import { listId } from '../lib/lanes'
import { cn } from '../lib/utils'
import { Copyable } from './copyable'
import { useTip } from './tip'
import { Button } from './ui/button'
import { Card, CardContent } from './ui/card'
import { Checkbox } from './ui/checkbox'

/** Where a drop would put a card, as the board checks it against the rules for moving an item: a stage, and the group in it or none. */
export type DropTarget = { readonly stage: Stage; readonly group: string | null }

/**
 * The lane whose cards are being chosen and what they will become, a group or
 * a batch; null while no lane is choosing. A card shows a way to choose it only
 * then, so nothing on a card asks for a choice nobody started.
 */
export type Choosing = { readonly stage: Stage; readonly purpose: 'group' | 'batch' } | null

/** What a card can do on the board, the same for every card in every lane. */
export type CardActions = {
  readonly pending: boolean
  readonly choosing: Choosing
  readonly selectedIds: ReadonlySet<string>
  readonly accepts: (id: unknown, target: DropTarget) => boolean
  readonly onSelect: (id: string, selected: boolean) => void
  readonly onComplete: (item: Item) => void
}

export function WorkflowCard({ item, index, stage, pending, choosing, selectedIds, accepts, onSelect, onComplete }: CardActions & {
  item: Item
  /** Its place in its list: the lane's cards in no group, or its group's cards. */
  index: number
  stage: Stage
}) {
  // Execute is frozen: its cards leave only by completing, never by dragging.
  const frozen = stage === 'Execute'
  const { ref, isDragSource } = useSortable({
    id: item.id,
    index,
    group: listId({ stage, group: item.group }),
    type: 'item',
    accept: source => accepts(source.id, { stage, group: item.group }),
    disabled: pending || frozen,
  })
  // Only the lane that is choosing offers its cards to be chosen.
  const purpose = choosing?.stage === stage ? choosing.purpose : null
  const tip = useTip()
  return (
    // The card is the drag surface, so it is what the keyboard reaches and
    // what the sortable's keyboard sensor listens on. It carries the name a
    // grip would carry, and no button role: it holds a link and a checkbox,
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
      <Card size="sm" className={cn(isDragSource && 'opacity-50')}>
        <CardContent className="space-y-3">
          <div className="flex items-start gap-2">
            {purpose === null
              ? null
              : (
                // A native button, which the sortable never starts a drag
                // from: on the checkbox's own span a press held a moment
                // lifted the card instead of ticking the box.
                <Checkbox
                  nativeButton
                  render={<button type="button" aria-label={`Choose ${item.title}`} />}
                  className="cursor-pointer"
                  checked={selectedIds.has(item.id)}
                  onCheckedChange={selected => onSelect(item.id, selected)}
                  title={tip(`Include this item in the ${purpose}.`)}
                />
              )}
            {/* A real link: the item has a page, so it opens in a tab like anything else. */}
            <a
              href={itemHref(item.id)}
              className="min-w-0 flex-1 rounded-sm text-left font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {item.title}
            </a>
          </div>
          {item.summary ? <p className="line-clamp-3 text-sm text-muted-foreground">{item.summary}</p> : null}
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {/* The id is for copying, not reading, so it stays very dim until pointed at. */}
            <Copyable value={item.id}>
              <span className="opacity-30 transition-opacity group-hover/copyable:opacity-100 group-focus-visible/copyable:opacity-100">
                {item.id}
              </span>
            </Copyable>
            {frozen ? <Button className="ml-auto" variant="ghost" size="icon-xs" onClick={() => onComplete(item)} title={tip(`Complete ${item.title}`)} aria-label={`Complete ${item.title}`}><Check /></Button> : null}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
