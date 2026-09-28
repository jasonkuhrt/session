import * as React from 'react'

import type { Memory } from './path'

/**
 * What the substrate keeps for the whole document, whichever view is drawn:
 * focus memory, the marks, and the line that says what just happened. A view
 * mounts its own surface and leaves it when it goes; these stay, so `i` goes
 * back where it was, a mark survives a trip to another view, and a reason
 * given as a view changes is still read on the next.
 */
type Root = {
  readonly memory: Memory
  readonly marks: ReadonlySet<string>
  readonly setMarks: (update: (marks: ReadonlySet<string>) => ReadonlySet<string>) => void
  readonly flashed: string | null
  readonly flash: (text: string | null) => void
  /** Whether the document has yet to hear a key, while the detail line says where the keys are. */
  readonly hinted: boolean
  readonly heard: () => void
}

const RootContext = React.createContext<Root | null>(null)

/** How long a flashed line stands in the detail line before the facts come back. */
const flashMilliseconds = 7000

export function SubstrateRoot({ children }: { readonly children: React.ReactNode }) {
  const [memory] = React.useState<Memory>(() => new Map())
  const [marks, setMarks] = React.useState<ReadonlySet<string>>(() => new Set())
  const [flashed, setFlashed] = React.useState<string | null>(null)
  const [hinted, setHinted] = React.useState(true)
  const heard = React.useCallback(() => setHinted(false), [])
  // No timer has id 0, so it is the one value that stands for "none pending".
  const timer = React.useRef(0)
  React.useEffect(() => () => window.clearTimeout(timer.current), [])
  const flash = React.useCallback((text: string | null) => {
    window.clearTimeout(timer.current)
    setFlashed(text)
    if (text !== null) timer.current = window.setTimeout(() => setFlashed(null), flashMilliseconds)
  }, [])
  const root = React.useMemo(() => ({ memory, marks, setMarks, flashed, flash, hinted, heard }), [memory, marks, flashed, flash, hinted, heard])
  return <RootContext value={root}>{children}</RootContext>
}

export function useRoot(): Root {
  const root = React.use(RootContext)
  if (root === null) throw new Error('A surface is drawn inside the substrate’s root.')
  return root
}
