import { Link } from '@tanstack/react-router'
import { Pencil } from 'lucide-react'
import type * as React from 'react'

import { toEpic } from '../lib/base'
import type { EpicCardShape } from '../lib/dashboard'
import { epicBoardMeaning, epicMeaning, worktreeCountMeaning } from '../lib/index-meanings'
import { cn } from '../lib/utils'
import { Explained, Tip, useTip } from './tip'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { EpicMark } from './worktree-marks'

/** An epic's name as the link to its board, drawn as a worktree's name is. */
const epicLink = 'rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50'

/**
 * An epic's heading, which is what holds the card: its mark, which says what
 * an epic is, its name, which opens its board, how many worktrees are in it,
 * and, while `onRename` is given, a way to rename it. `movable` says whether
 * it can be held now.
 */
export function EpicHeading({ card, movable: canMove, onRename, ref }: {
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
      <Explained meaning={epicMeaning(card.name)} className="shrink-0"><EpicMark /></Explained>
      <h2 className="min-w-0 text-sm font-medium wrap-anywhere">
        <Link {...toEpic(card.name)} className={epicLink} title={tip(epicBoardMeaning(card.name))}>{card.name}</Link>
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
