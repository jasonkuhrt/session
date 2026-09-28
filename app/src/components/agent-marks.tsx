import { cn } from '../lib/utils'

/** A dot that carries one fact: whether something is live, and whether it needs you. */
export function Dot({ tone }: { tone: 'on' | 'attention' | 'off' | 'unknown' }) {
  // Attention is the one tone with a hue: it marks a live session waiting on a
  // person. `on` is live and working, `off` is a handle, `unknown` is unread.
  const fill = tone === 'attention'
    ? 'bg-attention'
    : tone === 'on'
    ? 'bg-primary'
    : tone === 'unknown'
    ? 'border border-muted-foreground/50'
    : 'bg-muted-foreground/40'
  return <span aria-hidden className={cn('size-2 shrink-0 rounded-full', fill)} />
}

