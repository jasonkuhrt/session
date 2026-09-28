import type { DragOverEvent } from '@dnd-kit/react'
import { DragDropProvider } from '@dnd-kit/react'
import { Link } from '@tanstack/react-router'
import * as React from 'react'

import type { Item, Stage } from '../../contract'
import { stageNames } from '../../contract'
import { dragSensors, pointerOf } from '../lib/drag'
import type { Aim, Drawn, Held } from '../lib/held'
import { aimOf, itemIn, ownDrawn, sameOver, samePlacement } from '../lib/held'
import type { Dragging, Lane as LaneLayout, Placement } from '../lib/lanes'
import { cardId, lanesOf, moved, moveWords, newGroupWords, placementOf } from '../lib/lanes'
import { moveAvailability } from '../lib/workflow'
import { useLinkOf } from '../substrate/surface-context'
import type { LanePart, PathsOf } from './lane'
import { Lane, LaneHeading, PartOfLane } from './lane'
import { useTip } from './tip'
import type { DropTarget } from './workflow-card'

/** One worktree's part of a board: the board its session is served under, the key it goes by, its name, and its session as drawn. */
export type BoardPart = { readonly board: string; readonly key: string; readonly name: string; readonly session: Drawn; readonly marks: React.ReactNode }

/** A card dropped on another in no group of its own lane: the two a group is to be made of, the one dropped on first, on their worktree's board. */
export type GroupDrop = { readonly board: string; readonly stage: Stage; readonly onto: Item; readonly held: Item }

/** A card as the board finds it by the name the drag library knows it by: its worktree's board, the item, and its stage. */
type Card = { readonly board: string; readonly item: Item; readonly stage: Stage }

/**
 * Whether a card may be put at a place of its own worktree, by the rules for
 * moving an item. Execute is entered only by starting the next queued batch
 * and Queue only by composing one in Batch, so neither takes a card from
 * elsewhere. A queued card may still move inside its own batch.
 */
function allows(source: Card, target: DropTarget) {
  if (target.stage === 'Execute') return false
  if (target.stage === 'Queue') return source.stage === 'Queue' && target.group !== null && source.item.group === target.group
  if (source.stage === target.stage) return true
  return moveAvailability(source.item, source.stage, target.stage).enabled
}

/** Every card of every worktree drawn, by the name the drag library knows it by. */
function cardsOf(shown: ReadonlyMap<string, Drawn>): ReadonlyMap<string, Card> {
  const cards = new Map<string, Card>()
  for (const [board, session] of shown) {
    for (const stage of session.stages) {
      for (const item of stage.items) cards.set(cardId({ board, id: item.id }), { board, item, stage: stage.stage })
    }
  }
  return cards
}

/**
 * A worktree's lanes as the board draws them: as its files were at pickup
 * while a card is held, with the held card moved where it would land, if it is
 * this worktree's and has moved at all, so picking a card up never moves
 * anything under the pointer.
 */
function lanesDrawn({ shown, board, held }: {
  readonly shown: ReadonlyMap<string, Drawn>
  readonly board: string
  readonly held: Held | null
}): LaneLayout[] {
  const lanes = lanesOf(shown.get(board)?.stages ?? [])
  return held === null || held.board !== board || samePlacement({ left: held.placement, right: held.origin })
    ? lanes
    : moved({ lanes, id: held.id, placement: held.placement })
}

/** The held card as the lanes draw it: where a drop would land, or the card it would make a group with, and its words. */
function draggingOf(held: Held | null): Dragging | null {
  if (held === null) return null
  const { over } = held
  // Where a drop would land: over a heading, the group's end, not where the card is drawn.
  const landing = over?.kind === 'heading' ? over.placement : held.placement
  return {
    board: held.board,
    id: held.id,
    landing: over?.kind === 'card' ? null : landing,
    onto: over?.kind === 'card' ? over.id : null,
    words: over?.kind === 'card'
      ? newGroupWords(itemIn({ stages: ownDrawn(held)?.stages ?? [], id: over.id })?.item.title ?? over.id)
      : moveWords({ origin: held.origin, placement: landing }),
  }
}

/**
 * The lanes of every worktree in view, and their drag, for the mouse. A
 * worktree's board draws its one worktree's lanes whole; an epic's board and
 * a project's draw each worktree in a row across the lanes, its name once at
 * the row's left edge with its marks, so its work reads across its stages.
 * A card moves only among its own worktree's lanes.
 */
export function Board({ parts, grouped, pending, paths, onMove, onGroupDrop, onDraggingChange }: {
  readonly parts: readonly BoardPart[]
  readonly grouped: boolean
  readonly pending: boolean
  readonly paths: PathsOf
  /** Moves a card within its own worktree's session, against the revision it was drawn on; resolves once the move is written or refused. */
  readonly onMove: (board: string, id: string, placement: Placement, revision: string) => Promise<unknown>
  /** Asks for the name of a group of two cards, one dropped on the other. */
  readonly onGroupDrop: (drop: GroupDrop) => void
  readonly onDraggingChange: (dragging: boolean) => void
}) {
  const [held, setHeld] = React.useState<Held | null>(null)
  // The hover that chose a placement can be newer than the last render, and
  // the drop must act on what the board was about to show.
  const latest = React.useRef<Held | null>(null)
  const hold = (next: Held | null) => {
    latest.current = next
    setHeld(next)
  }
  // While a card is held every worktree is drawn as it was at pickup.
  const shown: ReadonlyMap<string, Drawn> = held?.drawn ?? new Map(parts.map((part) => [part.board, part.session]))
  const drawn = (board: string, current: Held | null) => lanesDrawn({ shown, board, held: current })
  const cards = cardsOf(shown)
  const cardOf = (id: unknown) => (typeof id === 'string' ? cards.get(id) ?? null : null)

  // What a drop target takes as something to aim at: a place of the card's own
  // worktree the rules allow, and anything of another worktree's, which is no
  // place the card can be, and which the card aims past, back to where it was
  // picked up.
  const accepts = (id: unknown, target: DropTarget) => {
    const source = cardOf(id)
    return source !== null && (source.board !== target.board || allows(source, target))
  }

  const aimFor = (current: Held, operation: DragOverEvent['operation'], pointer?: ReturnType<typeof pointerOf>): Aim =>
    aimOf({ current, operation, pointer, lanes: drawn(current.board, current), cardOf })

  const take = (current: Held, aim: Aim) => {
    const card = cardOf(cardId({ board: current.board, id: current.id }))
    const allowed = (placement: Placement) =>
      card !== null && allows(card, { board: current.board, stage: placement.to, group: placement.group })
    const over = aim?.kind === 'over' && (aim.over.kind === 'card' || allowed(aim.over.placement)) ? aim.over : null
    const next = aim?.kind === 'place' && allowed(aim.placement) ? aim.placement : current.placement
    if (sameOver({ left: over, right: current.over }) && samePlacement({ left: next, right: current.placement })) return
    hold({ ...current, placement: next, over })
  }

  const letGo = () => {
    setHeld(null)
    onDraggingChange(false)
  }

  const dragging = draggingOf(held)
  const actions = { pending, accepts }

  const partOf = (part: BoardPart, stage: Stage): LanePart => ({
    board: part.board,
    key: part.key,
    name: part.name,
    lane: drawn(part.board, held).find((lane) => lane.stage === stage) ?? { stage, entries: [] },
  })

  return (
    <DragDropProvider
      sensors={dragSensors}
      onDragStart={(event) => {
        const card = cardOf(event.operation.source?.id)
        const origin = card === null ? null : placementOf({ lanes: drawn(card.board, null), id: card.item.id })
        if (card !== null && origin !== null) {
          hold({ board: card.board, id: card.item.id, drawn: shown, origin, placement: origin, over: null })
        }
        onDraggingChange(true)
      }}
      onDragOver={(event) => {
        // The board draws every card where the files would put it, so the
        // sortable's own plugin must not move cards in the DOM behind React.
        event.preventDefault()
        const current = latest.current
        if (current !== null) take(current, aimFor(current, event.operation))
      }}
      onDragMove={(event) => {
        const current = latest.current
        if (current !== null) take(current, aimFor(current, event.operation, pointerOf(event)))
      }}
      onDragEnd={(event) => {
        const current = latest.current
        latest.current = null
        const own = current === null ? null : ownDrawn(current)
        if (event.canceled || current === null || own === null) {
          letGo()
          return
        }
        if (current.over?.kind === 'card') {
          const onto = itemIn({ stages: own.stages, id: current.over.id })
          const dropped = itemIn({ stages: own.stages, id: current.id })
          letGo()
          if (onto !== null && dropped !== null) onGroupDrop({ board: current.board, stage: onto.stage, onto: onto.item, held: dropped.item })
          return
        }
        const placement = current.over?.kind === 'heading' ? current.over.placement : current.placement
        if (samePlacement({ left: placement, right: current.origin })) {
          letGo()
          return
        }
        setHeld({ ...current, placement, over: null })
        void onMove(current.board, current.id, placement, own.revision).finally(letGo)
      }}
    >
      {/* The lanes scroll sideways in their own box, never the page. */}
      <div className="-mx-4 overflow-x-auto px-4 pb-2">
        {grouped ? (
          <div className="grid min-w-[72rem] grid-cols-[minmax(7rem,11rem)_repeat(5,minmax(12rem,1fr))] items-stretch gap-x-3">
            <div />
            {stageNames.map((stage) => <LaneHeading key={stage} path={paths.stage(stage)} stage={stage} />)}
            {parts.map((part) => (
              <React.Fragment key={part.board}>
                <WorktreeName part={part} paths={paths} />
                {stageNames.map((stage) => (
                  <PartOfLane key={stage} {...actions} part={partOf(part, stage)} stage={stage} dragging={dragging} paths={paths} />
                ))}
              </React.Fragment>
            ))}
          </div>
        ) : (
          <div className="grid min-w-[62rem] grid-cols-5 items-start gap-x-3">
            {parts.slice(0, 1).flatMap((part) => stageNames.map((stage) => (
              <Lane key={stage} {...actions} part={partOf(part, stage)} stage={stage} dragging={dragging} paths={paths} />
            )))}
          </div>
        )}
      </div>
    </DragDropProvider>
  )
}

/**
 * A worktree's name at its row's left edge on an epic's or a project's board,
 * with its marks: a link to where Enter on any of its parts goes, that
 * worktree's own board at the stage last focused there, the address a part
 * would link to, so a click and Enter land alike. A press on it leaves the
 * browser's focus with the page, as a press on a node does, so a key after a
 * click with a modifier, which opens the board in a new tab, still reaches
 * the registry.
 */
function WorktreeName({ part, paths }: { part: BoardPart; paths: PathsOf }) {
  const tip = useTip()
  const address = useLinkOf()(paths.part({ key: part.key, stage: 'Triage' }))
  const className = 'sticky left-0 z-10 flex min-w-0 items-start gap-2 border-t bg-background py-2 pr-2 text-left text-sm text-muted-foreground'
  const name = <span className="min-w-0 truncate">{part.name}</span>
  // A worktree whose board cannot open from here is named, and links nowhere.
  if (address === null) {
    return (
      <span className={className}>
        {name}
        {part.marks}
      </span>
    )
  }
  return (
    <Link
      {...address}
      tabIndex={-1}
      onMouseDown={(event) => event.preventDefault()}
      className={`${className} hover:text-foreground`}
      title={tip(`Open ${part.name}’s own board.`)}
    >
      {name}
      {part.marks}
    </Link>
  )
}
