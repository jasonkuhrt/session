import { useSortable } from '@dnd-kit/react/sortable'
import { Link, useNavigate } from '@tanstack/react-router'
import { Check } from 'lucide-react'

import type { Item, Stage } from '../../contract'
import { stageNames } from '../../contract'
import { toItem, useBoardName } from '../lib/base'
import { landing } from '../lib/drag'
import { listId } from '../lib/lanes'
import { selectedMark, selectionRing } from '../lib/selection'
import { cn } from '../lib/utils'
import { moveAvailability } from '../lib/workflow'
import { Copyable } from './copyable'
import { HeldWords } from './held-words'
import { type Binding, useBindings, useReveal } from './keys'
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
  /** The items chosen while a lane is choosing. */
  readonly chosenIds: ReadonlySet<string>
  /** The item the keys act on, ringed; null while none is. */
  readonly selectedId: string | null
  readonly accepts: (id: unknown, target: DropTarget) => boolean
  readonly onChosenChange: (id: string, chosen: boolean) => void
  readonly onComplete: (item: Item) => void
  /** Moves an item to another stage, as the item page's stage control does; resolves whether it moved. */
  readonly onStage: (item: Item, to: Stage) => Promise<boolean>
}

/** What Enter does on the selected card, and what its title does when it is clicked. */
const openSentence = 'Open this item’s page.'

/**
 * The stage a bracket moves an item to, one back or one forward in the flow,
 * when the rules let it go there; null when there is none or they do not.
 */
const stageBeside = ({ item, stage, by }: { readonly item: Item; readonly stage: Stage; readonly by: 1 | -1 }) => {
  const target = stageNames[stageNames.indexOf(stage) + by]
  return target !== undefined && moveAvailability(item, stage, target).enabled ? target : null
}

/**
 * The selected card's keys: Enter opens its page, as its title does, and the
 * brackets move it one stage back or forward, as the stage control on its
 * page does; a bracket is offered only while the rules let the item go there,
 * does nothing while another write is under way, and once its move has landed
 * brings the item into view in its new lane.
 */
function useCardKeys({ item, stage, selected, pending, onStage }: {
  readonly item: Item
  readonly stage: Stage
  readonly selected: boolean
  readonly pending: boolean
  readonly onStage: (item: Item, to: Stage) => Promise<boolean>
}) {
  const navigate = useNavigate()
  const name = useBoardName()
  const reveal = useReveal()
  // Only the selected card has keys, so only it reads its body for the rules;
  // every card draws again on each step of a drag.
  const back = selected ? stageBeside({ item, stage, by: -1 }) : null
  const forward = selected ? stageBeside({ item, stage, by: 1 }) : null
  const moveInView = async (to: Stage) => {
    if (await onStage(item, to)) reveal()
  }
  const move = (to: Stage) => () => {
    if (pending) return false
    void moveInView(to)
    return true
  }
  const bindings: Binding[] = [
    {
      name: 'open',
      sentence: openSentence,
      // With a control focused, Enter is that control's.
      act: (event) => {
        if (event.target !== document.body) return false
        void navigate(toItem({ name, id: item.id }))
        return true
      },
    },
    ...(back === null ? [] : [{ name: 'back', sentence: `Move this item back to ${back}.`, act: move(back) } as const]),
    ...(forward === null ? [] : [{ name: 'forward', sentence: `Move this item forward to ${forward}.`, act: move(forward) } as const]),
  ]
  useBindings(selected ? bindings : [])
}

export function WorkflowCard({ item, index, stage, lands, words, pending, choosing, chosenIds, selectedId, accepts, onChosenChange, onComplete, onStage }: CardActions & {
  item: Item
  /** Its place in its list: the lane's cards in no group, or its group's cards. */
  index: number
  stage: Stage
  /** Whether the card held over this one would make a group with it if it were dropped now. */
  lands: boolean
  /** What dropping this card where it is would do, while it is the one held; null when the lanes show all of it. */
  words: string | null
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
  const name = useBoardName()
  const selected = selectedId === item.id
  useCardKeys({ item, stage, selected, pending, onStage })
  return (
    // The card is the drag surface, so it is what the keyboard reaches and
    // what the sortable's keyboard sensor listens on. It carries the name a
    // grip would carry, and a role of its own, a group: the drag library
    // gives an activator without one the role of a button, and a button's
    // content is presentational, so the link and the checkbox it holds would
    // stop being controls of their own.
    <div
      ref={ref}
      // eslint-disable-next-line jsx-a11y/prefer-tag-over-role -- An element that is dragged and holds its own controls has no tag of its own; `fieldset` groups a form's fields.
      role="group"
      tabIndex={frozen ? undefined : 0}
      aria-roledescription={frozen ? undefined : 'Draggable card'}
      aria-label={frozen ? undefined : `Drag ${item.title}`}
      className={cn(
        'relative rounded-xl outline-none',
        frozen ? undefined : 'cursor-grab focus-visible:ring-3 focus-visible:ring-ring/50',
        !frozen && isDragSource && 'cursor-grabbing',
        lands && landing,
      )}
    >
      {/* The held card is this element itself, carried by the pointer, so the words ride on it. */}
      <HeldWords words={isDragSource ? words : null} />
      <Card
        size="sm"
        data-selected={selectedMark(selected)}
        className={cn(isDragSource && 'opacity-50', selectionRing)}
      >
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
                  checked={chosenIds.has(item.id)}
                  onCheckedChange={chosen => onChosenChange(item.id, chosen)}
                  title={tip(`Include this item in the ${purpose}.`)}
                />
              )}
            {/* A real link: the item has a page, so it opens in a tab like anything else. */}
            <Link
              {...toItem({ name, id: item.id })}
              title={tip(openSentence)}
              className="min-w-0 flex-1 rounded-sm text-left font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {item.title}
            </Link>
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
