import { useSortable } from '@dnd-kit/react/sortable'

import type { Item, Stage } from '../../contract'
import { landing } from '../lib/drag'
import { cardId, listId } from '../lib/lanes'
import { cn } from '../lib/utils'
import { Node } from '../substrate/node'
import type { Path } from '../substrate/seam'
import { HeldWords } from './held-words'
import { useTip } from './tip'

/**
 * Where a drop would put a card, as the board checks it against the rules for
 * moving an item: the board of the worktree whose lanes it is in, since a card
 * moves only among its own worktree's, a stage, and the group in it or none.
 */
export type DropTarget = { readonly board: string; readonly stage: Stage; readonly group: string | null }

/** What every card needs from its board, the same for every card in every lane. */
export type CardActions = {
  readonly pending: boolean
  readonly accepts: (id: unknown, target: DropTarget) => boolean
}

/**
 * A card: the item's title and its id, dim, and nothing else; what else is
 * known about it is in the detail line while it has the focus, and its page
 * is one Enter away. It is dragged by its whole self, for the mouse; every
 * drop has a key of its own.
 */
export function WorkflowCard({ path, board, item, index, stage, lands, words, pending, accepts }: CardActions & {
  /** Where the card is in the tree. */
  path: Path
  /** The board of the worktree the item is filed in, which every write to it goes through. */
  board: string
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
    id: cardId({ board, id: item.id }),
    index,
    group: listId({ board, stage, group: item.group }),
    type: 'item',
    accept: (source) => accepts(source.id, { board, stage, group: item.group }),
    disabled: pending || frozen,
  })
  const tip = useTip()
  return (
    <Node
      path={path}
      nodeRef={ref}
      className={cn('px-2.5 py-1.5 pr-6 leading-snug', !frozen && 'cursor-grab', isDragSource && 'opacity-50', lands && landing)}
    >
      {/* The held card is this element itself, carried by the pointer, so the words ride on it. */}
      <HeldWords words={isDragSource ? words : null} />
      <span className="text-sm text-foreground" title={tip(item.summary === '' ? item.title : item.summary)}>{item.title}</span>
      <span className="ml-1.5 font-mono text-xs whitespace-nowrap text-muted-foreground/60" title={tip(`The item’s id, the same in every stage.`)}>{item.id}</span>
    </Node>
  )
}
