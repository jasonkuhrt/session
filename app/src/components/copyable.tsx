import { Check, Copy } from 'lucide-react'
import * as React from 'react'

import { cn } from '../lib/utils'

/** How long a copied confirmation stays up before the control says its name again. */
const copiedMilliseconds = 1_500

/** What a copy control has to report, if anything. */
export type CopyState = 'idle' | 'copied' | 'failed'

/** What a copy control calls itself while it reports what happened. */
export function copyLabel({ label, state }: { label: string; state: CopyState }) {
  return state === 'idle' ? label : state === 'copied' ? 'Copied' : 'Copy failed'
}

/** Copy feedback that reverts, and that says so when the browser refused. */
export function useCopy() {
  const [state, setState] = React.useState<CopyState>('idle')
  // No timer has id 0, so it is the one value that stands for "none pending".
  const timer = React.useRef(0)
  React.useEffect(() => () => window.clearTimeout(timer.current), [])
  const copy = async (text: string) => {
    window.clearTimeout(timer.current)
    try {
      await navigator.clipboard.writeText(text)
      setState('copied')
    } catch {
      setState('failed')
    }
    timer.current = window.setTimeout(() => setState('idle'), copiedMilliseconds)
  }
  return [state, copy] as const
}

/**
 * A value someone is going to paste somewhere else: a path, a branch, an id.
 *
 * It reads as the plain text it wraps and only shows its icon under the pointer
 * or the focus ring, so a surface full of these still reads as a surface rather
 * than a row of buttons. What it copies is the value it was given, never the
 * elided text on screen. A link is not one of these: a link goes where it says,
 * and where both are wanted the copy sits beside it.
 */
export function Copyable({
  value,
  label,
  children,
}: {
  value: string
  label?: string
  children: React.ReactNode
}) {
  const [state, copy] = useCopy()
  const name = label ?? value
  return (
    <button
      type="button"
      title={state === 'failed' ? 'Copy failed' : `Copy ${name}`}
      aria-label={`Copy ${name}`}
      onClick={() => void copy(value)}
      className="group/copyable inline-flex max-w-full items-start gap-1 rounded-sm text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {children}
      {state === 'copied' ? <Check className={iconClass(state)} /> : <Copy className={iconClass(state)} />}
    </button>
  )
}

/**
 * Hidden until wanted, except once it has something to report: a copy that
 * landed and one the clipboard refused both have to survive the pointer
 * leaving.
 */
const iconClass = (state: CopyState) =>
  cn(
    'mt-0.5 size-3 shrink-0 text-muted-foreground transition-opacity',
    state === 'idle'
      ? 'opacity-0 group-hover/copyable:opacity-100 group-focus-visible/copyable:opacity-100'
      : 'opacity-100',
  )
