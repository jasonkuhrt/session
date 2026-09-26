import type { Marker } from '../lib/order'
import { cn } from '../lib/utils'

/**
 * The line where a held project or worktree would take its place, across the
 * top or the bottom of what it would go before or after, laid over the gap
 * so nothing moves under the pointer. `gap` is how far out the gap's middle
 * is, as a Tailwind inset.
 */
export function LandingLine({ side, gap }: { side: 'before' | 'after'; gap: 'row' | 'section' }) {
  return (
    <span
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-x-2 z-10 border-t-2 border-dashed border-primary',
        gap === 'row' ? (side === 'before' ? '-top-px' : '-bottom-px') : (side === 'before' ? '-top-5' : '-bottom-5'),
      )}
    />
  )
}

/** The side of an entry the line is drawn on, when the marker names it in this list. */
export const markedSide = ({ marker, list, id }: { marker: Marker | null; list: string; id: string }) =>
  marker !== null && marker.list === list && marker.id === id ? marker.side : null
