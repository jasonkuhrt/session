import { CollisionPriority } from '@dnd-kit/abstract'
import { pointerIntersection } from '@dnd-kit/collision'
import { useDraggable, useDroppable } from '@dnd-kit/react'
import { Boxes, Pencil, Plus } from 'lucide-react'
import * as React from 'react'

import type { WorktreeSummary } from '../../contract'
import { landing } from '../lib/drag'
import type { IndexCard } from '../lib/epics'
import { draggedId, movable, targetId } from '../lib/epics'
import { cn } from '../lib/utils'
import { Explained, Tip, useTip } from './tip'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card } from './ui/card'
import type { RowContext } from './worktree-row'
import { cardClass, WorktreeRow } from './worktree-row'

/**
 * The index's cards below the strip: an epic with its worktrees in it, or one
 * worktree in no epic. A card is held by what it is, a worktree by its row and
 * an epic by its heading, and the pointer carries a plain copy of it, so the
 * card itself stays where it is, faint, until the drop.
 */

type EpicCardShape = Extract<IndexCard, { kind: 'epic' }>

/** What the draggable cards also need: every row, which a drop's outcome is read from, and what a drag is doing. */
export type DragContext = RowContext & {
  readonly rows: readonly WorktreeSummary[]
  /** While a drop is written, nothing is picked up. */
  readonly writing: boolean
  /** The target a held card would land in if it were dropped now, by its id; null when a drop would change nothing. */
  readonly landingOn: string | null
  readonly onRename: (card: EpicCardShape) => void
}

/** The order the cards stand in, said by every card that can say it, since the page has no heading to say it once. */
const orderMeaning = 'The cards with a live agent come first, then the newest activity.'

const epicMeaning = (name: string) =>
  `An epic: the worktrees whose sessions name “${name}”, the busiest first. ${orderMeaning} Drag this heading onto another epic to merge the two.`

/** What a worktree in no epic is, and where it can be dropped, said by the mark before its name. */
const looseMeaning =
  `A worktree in no epic, on this page while it has a session. ${orderMeaning} Drag it onto an epic to join it, onto another worktree in no epic to make an epic of the two, or onto the + that appears after the cards to start an epic of its own.`

/** The same for a worktree in an epic, which can also be dropped out of it. */
const epicRowMeaning = (epic: string) =>
  `A worktree in “${epic}”, on this page while it has a session. Drag it onto another epic to join that one, onto a worktree in no epic to make an epic of the two, onto the + that appears after the cards to start an epic of its own, or onto the space between the cards to leave “${epic}”.`

const worktreeCountMeaning = 'How many worktrees are in this epic.'

const quietCardMeaning = 'Nothing is live here and nothing has happened in five days, so this card is dim, and last.'

/**
 * One ref for an element that is two things to the drag library at once, a
 * card that is held and that takes others. It keeps its identity while both
 * of the library's refs do, as theirs do, so a render never detaches a card
 * mid-drag.
 */
function useBothRefs(first: (element: Element | null) => void, second: (element: Element | null) => void) {
  return React.useCallback((element: Element | null) => {
    first(element)
    second(element)
  }, [first, second])
}

/** What a card that others land in is to the library: the pointer alone decides it, and it outranks the space around it. */
const cardDrop = { collisionDetector: pointerIntersection, collisionPriority: CollisionPriority.Normal } as const

/**
 * A worktree in an epic's card, held by its row: dragged onto another epic it
 * joins it, onto a worktree in no epic the two make one, and onto the space
 * between the cards it leaves its epic and becomes a card of its own.
 */
function EpicRow({ row, context }: { row: WorktreeSummary; context: DragContext }) {
  const canMove = movable(row)
  const { ref, isDragSource } = useDraggable({
    id: draggedId({ kind: 'row', path: row.path }),
    type: 'row',
    disabled: !canMove || context.writing,
  })
  return (
    <div
      ref={ref}
      // A role of its own, so the drag library does not make it a button, whose
      // content would stop being controls: the row holds a link and buttons.
      // eslint-disable-next-line jsx-a11y/prefer-tag-over-role -- An element that is dragged and holds its own controls has no tag of its own; `fieldset` groups a form's fields.
      role="group"
      aria-roledescription="Draggable worktree"
      aria-label={`Drag ${row.name}`}
      className={cn('px-3 py-2.5 outline-none', canMove && 'cursor-grab', isDragSource && 'opacity-40')}
    >
      <WorktreeRow row={row} context={context} meaning={epicRowMeaning(row.epic ?? '')} />
    </div>
  )
}

/**
 * An epic's heading, which is what holds the card: its mark, its name, how
 * many worktrees are in it, and, while `onRename` is given, a way to rename
 * it. `movable` says whether it can be held now.
 */
function EpicHeading({ card, movable: canMove, onRename, ref }: {
  card: EpicCardShape
  movable: boolean
  onRename?: ((card: EpicCardShape) => void) | undefined
  ref?: React.Ref<HTMLDivElement>
}) {
  const tip = useTip()
  return (
    <div
      ref={ref}
      // A role of its own, so the drag library does not make the handle a
      // button, whose content would stop being controls: it holds the rename.
      // eslint-disable-next-line jsx-a11y/prefer-tag-over-role -- An element that is dragged and holds its own controls has no tag of its own; `fieldset` groups a form's fields.
      role="group"
      aria-roledescription="Draggable epic"
      aria-label={`Drag the epic ${card.name}`}
      className={cn('flex items-center gap-2 border-b px-3 py-2 outline-none', canMove && 'cursor-grab')}
    >
      <Boxes aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      <h2 className="min-w-0 text-sm font-medium wrap-anywhere">
        <Explained meaning={epicMeaning(card.name)}>{card.name}</Explained>
      </h2>
      <Badge variant="secondary" title={tip(worktreeCountMeaning)}>{card.rows.length}</Badge>
      {onRename === undefined ? null : (
        <Tip
          meaning="Rename this epic. A name another epic already has merges the two."
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              className="ml-auto"
              aria-label={`Rename the epic ${card.name}`}
              onClick={() => onRename(card)}
            />
          }
        >
          <Pencil />
        </Tip>
      )}
    </div>
  )
}

/**
 * An epic's card: its heading, then its worktrees, busiest first. It takes a
 * worktree dropped on it into the epic, and a whole epic dropped on it, whose
 * worktrees all join it. Held by its heading, it goes onto another epic the
 * same way.
 */
export function EpicCard({ card, context }: { card: EpicCardShape; context: DragContext }) {
  const into = targetId({ kind: 'epic', name: card.name })
  const { ref: holdRef, handleRef, isDragSource } = useDraggable({
    id: draggedId({ kind: 'epic', name: card.name }),
    type: 'epic',
    disabled: context.writing,
  })
  const { ref: dropRef } = useDroppable({ id: into, ...cardDrop, disabled: context.writing })
  const ref = useBothRefs(holdRef, dropRef)
  const tip = useTip()
  const actionable = !context.writing
  return (
    <Card
      ref={ref}
      size="sm"
      title={card.quiet ? tip(quietCardMeaning) : undefined}
      className={cardClass({ quiet: card.quiet, lands: context.landingOn === into, held: isDragSource })}
    >
      <EpicHeading ref={handleRef} card={card} movable={actionable} onRename={actionable ? context.onRename : undefined} />
      <div className="divide-y">
        {card.rows.map(row => <EpicRow key={row.path} row={row} context={context} />)}
      </div>
    </Card>
  )
}

/**
 * A worktree in no epic, as a card of its own. Held, it is its worktree: onto
 * an epic it joins it, and onto another card like it the two make an epic,
 * named in the dialog. It takes another worktree dropped on it the same way.
 */
export function LooseCard({ card, context }: { card: Extract<IndexCard, { kind: 'loose' }>; context: DragContext }) {
  const { row } = card
  const canMove = movable(row)
  const onto = targetId({ kind: 'loose', path: row.path })
  const { ref: holdRef, isDragSource } = useDraggable({
    id: draggedId({ kind: 'row', path: row.path }),
    type: 'row',
    disabled: !canMove || context.writing,
  })
  const { ref: dropRef } = useDroppable({ id: onto, ...cardDrop, disabled: context.writing })
  const ref = useBothRefs(holdRef, dropRef)
  const tip = useTip()
  return (
    <Card
      ref={ref}
      size="sm"
      // A role of its own, so the drag library does not make the card a button,
      // whose content would stop being controls: it holds a link and buttons.
      // eslint-disable-next-line jsx-a11y/prefer-tag-over-role -- An element that is dragged and holds its own controls has no tag of its own; `fieldset` groups a form's fields.
      role="group"
      aria-roledescription="Draggable worktree"
      aria-label={`Drag ${row.name}`}
      title={card.quiet ? tip(quietCardMeaning) : undefined}
      className={cn(
        cardClass({ quiet: card.quiet, lands: context.landingOn === onto, held: isDragSource }),
        'outline-none',
        canMove && 'cursor-grab',
      )}
    >
      <div className="px-3 py-2.5">
        <WorktreeRow row={row} context={context} meaning={looseMeaning} />
      </div>
    </Card>
  )
}

/**
 * Where a held worktree starts an epic of its own: a `+` after the cards,
 * drawn only while a worktree is held, since it cannot act otherwise. Dropped
 * here, the worktree is named into a new epic in the dialog, and a name an
 * epic already has puts it in that one.
 */
export function NewEpicTarget({ name, context }: { name: string; context: DragContext }) {
  const onto = targetId({ kind: 'new' })
  const { ref } = useDroppable({ id: onto, ...cardDrop, disabled: context.writing })
  const tip = useTip()
  return (
    <div
      ref={ref}
      title={tip(`New epic with ${name}`)}
      className={cn(
        'flex min-h-16 items-center justify-center rounded-xl border border-dashed text-muted-foreground',
        context.landingOn === onto && landing,
      )}
    >
      <Plus aria-hidden className="size-5" />
    </div>
  )
}

/**
 * The space between and below the cards: a worktree dropped here leaves its
 * epic and becomes a card of its own. It ranks below every card, so the
 * pointer over a card is over the card.
 */
export function CardSpace({ context, children }: { context: DragContext; children: React.ReactNode }) {
  const space = targetId({ kind: 'space' })
  const { ref } = useDroppable({
    id: space,
    collisionDetector: pointerIntersection,
    collisionPriority: CollisionPriority.Lowest,
    disabled: context.writing,
  })
  return <div ref={ref} className={cn('flex-1 rounded-xl pb-24', context.landingOn === space && landing)}>{children}</div>
}

/**
 * What the pointer carries while a card is held: the card as it is drawn,
 * with no drag of its own, and above it the few words of what dropping it
 * where it is would do, or none when it would do nothing.
 */
export function HeldPreview({ held, words, context }: {
  held: { readonly kind: 'row'; readonly row: WorktreeSummary } | { readonly kind: 'epic'; readonly card: EpicCardShape }
  words: string | null
  context: RowContext
}) {
  return (
    <div className="relative">
      {words === null ? null : <Badge className="absolute -top-3 left-3 z-10 shadow-sm">{words}</Badge>}
      <Card size="sm" className="gap-0 py-0 shadow-lg">
        {held.kind === 'row'
          ? (
            <div className="px-3 py-2.5">
              <WorktreeRow row={held.row} context={context} />
            </div>
          )
          : (
            <>
              <EpicHeading card={held.card} movable={false} />
              <div className="divide-y">
                {held.card.rows.map(row => (
                  <div key={row.path} className="px-3 py-2.5"><WorktreeRow row={row} context={context} /></div>
                ))}
              </div>
            </>
          )}
      </Card>
    </div>
  )
}
