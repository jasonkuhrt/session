import { Check, Copy, ExternalLink, Globe, SquareTerminal } from 'lucide-react'
import type * as React from 'react'

import type { Action } from '../lib/agents'
import { cn } from '../lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

/**
 * The parts both agent surfaces draw, kept where each can only be drawn one
 * way: the dot beside a session's word, the icon on one of its actions, and
 * the way any word says what it means.
 */

/** A dot that carries one fact: whether something is live, and whether it needs you. */
export function Dot({ tone }: { tone: 'on' | 'attention' | 'off' | 'unknown' }) {
  // Attention is the one tone with a hue: it marks a live session waiting on a
  // person. `on` is live and working, `off` is a handle, `unknown` is unread.
  const fill = tone === 'attention'
    ? 'bg-amber-400'
    : tone === 'on'
    ? 'bg-primary'
    : tone === 'unknown'
    ? 'border border-muted-foreground/50'
    : 'bg-muted-foreground/40'
  return <span aria-hidden className={cn('size-2 shrink-0 rounded-full', fill)} />
}

/**
 * What an action looks like wherever it is rendered: a terminal to go to, a
 * page on the web, an app to hand off to, or a value for the clipboard that
 * reports itself once it is taken.
 */
export function ActionIcon({ action, copied }: { action: Action; copied: boolean }) {
  if (action.kind === 'focus') return <SquareTerminal />
  if (action.kind === 'link') return action.external ? <Globe /> : <ExternalLink />
  return copied ? <Check /> : <Copy />
}

/**
 * A word with what it means behind it, reachable by pointer and by keyboard.
 * Every word this app invents or passes on wears one of these, so nothing on
 * the surface needs a document to read.
 */
export function Explained({ children, meaning, className }: {
  children: React.ReactNode
  meaning: string
  className?: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        className={cn('flex cursor-default items-center gap-1.5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 rounded-sm', className)}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{meaning}</TooltipContent>
    </Tooltip>
  )
}
