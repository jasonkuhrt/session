import { Check, Copy, ExternalLink, History, SquareTerminal, X } from 'lucide-react'

import type { Action } from '../lib/agents'
import { cn } from '../lib/utils'
import type { CopyState } from './copyable'

/**
 * The parts both agent surfaces draw, kept where each can only be drawn one
 * way: the dot beside a session's word, and the icon on one of its actions.
 */

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

/**
 * What an action looks like wherever it is rendered: a terminal to go to, an
 * app to hand off to, a command that resumes the session, or its id. A copy
 * reports what happened to it, a tick once it is taken and a cross when the
 * clipboard refused it, because on the board's strip the icon is all there is.
 */
export function ActionIcon({ action, copy = 'idle' }: { action: Action; copy?: CopyState }) {
  if (action.kind === 'focus') return <SquareTerminal />
  if (action.kind === 'link') return <ExternalLink />
  if (copy === 'copied') return <Check />
  if (copy === 'failed') return <X />
  return action.subject === 'resume' ? <History /> : <Copy />
}
