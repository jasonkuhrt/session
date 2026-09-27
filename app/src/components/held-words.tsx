import { Badge } from './ui/badge'

/**
 * The few words a held card carries above it, the same on the board and on
 * the index: what dropping it where it is would do, or nothing at all when
 * that would do nothing the lanes and the cards do not already show. They are
 * cut short at the card's width rather than run past it, since an item's
 * title can be long.
 */
export function HeldWords({ words }: { words: string | null }) {
  if (words === null) return null
  return (
    <Badge className="absolute -top-3 left-3 z-10 max-w-[calc(100%-1.5rem)] shadow-sm">
      <span className="min-w-0 truncate">{words}</span>
    </Badge>
  )
}
