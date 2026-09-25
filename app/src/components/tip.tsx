import type * as React from 'react'

import { useSettings } from '../lib/settings'
import { cn } from '../lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

/**
 * Tips: the sentence behind a word or a control, which says what it means from
 * where it is. Every surface draws its sentences through these, so the one
 * Tips setting is what shows them, whether a sentence is a tooltip or the
 * browser's own `title`. With Tips off the words and controls are the same,
 * and nothing comes up under the pointer.
 */

/** Whether tips are on. */
export const useTips = () => useSettings().settings.tips

/**
 * A `title` for a plain element, present only while Tips is on. A title that
 * reports what just happened, such as a copy the clipboard refused, is not a
 * tip and is passed as it is.
 */
export function useTip() {
  const tips = useTips()
  return (meaning: string) => (tips ? meaning : undefined)
}

/**
 * A control with the sentence that says what it does. The control is the same
 * with Tips off; only the sentence is gone.
 */
export function Tip({ meaning, ...trigger }: React.ComponentProps<typeof TooltipTrigger> & {
  meaning: React.ReactNode
}) {
  const tips = useTips()
  return (
    <Tooltip disabled={!tips}>
      <TooltipTrigger {...trigger} />
      <TooltipContent>{meaning}</TooltipContent>
    </Tooltip>
  )
}

/**
 * A word with what it means behind it, reachable by pointer and by keyboard
 * while Tips is on. With Tips off it is only the word: a trigger with nothing
 * behind it would be a stop for the keyboard that does nothing.
 */
export function Explained({ children, meaning, className }: {
  children: React.ReactNode
  /** A sentence, or several as blocks of their own. */
  meaning: React.ReactNode
  className?: string
}) {
  const tips = useTips()
  const layout = cn('flex items-center gap-1.5 text-left', className)
  if (!tips) return <span className={layout}>{children}</span>
  // Marked, so a drag reads it as the word it is and not as a control: with
  // Tips on it is drawn as a button, with Tips off as plain text, and turning
  // tips on must not change what can be dragged.
  return (
    <Tooltip>
      <TooltipTrigger
        data-explained=""
        className={cn(
          'cursor-default rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
          layout,
        )}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{meaning}</TooltipContent>
    </Tooltip>
  )
}
