import * as React from 'react'


/** How long a copied confirmation stays up before the control says its name again. */
const copiedMilliseconds = 1_500

/** What a copy control has to report, if anything. */
type CopyState = 'idle' | 'copied' | 'failed'

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
