import * as React from 'react'

import { Kbd } from '../components/ui/kbd'
import type { Fact } from './seam'

/**
 * The detail line: the facts of the focused node, one line at the bottom that
 * never changes the layout above it, cut short rather than wrapped; or, for a
 * moment, what just happened or why nothing did, or, until the first key,
 * where the keys are, each key it names a key cap. The mode shows at its end
 * only while it is not the normal one.
 */
export function DetailLine({ facts, flashed, hinted, modes, tip }: {
  readonly facts: readonly Fact[]
  readonly flashed: string | null
  /** Whether the document has yet to hear a key, while the line says where the keys are. */
  readonly hinted: boolean
  readonly modes: readonly string[]
  readonly tip: (meaning: string) => string | undefined
}) {
  const said = flashed ?? (hinted ? <>Press <Kbd>?</Kbd> for every key, <Kbd>;</Kbd> for the palette.</> : null)
  return (
    <footer
      aria-live="polite"
      className="sticky bottom-0 z-20 flex h-9 min-w-0 items-center gap-4 border-t bg-card px-4 font-mono text-xs text-muted-foreground"
    >
      <p className="min-w-0 flex-1 truncate">
        {said === null
          ? facts.map((fact, index) => (
            <React.Fragment key={fact.key}>
              {index === 0 ? null : <span aria-hidden className="text-muted-foreground/40"> · </span>}
              <span title={tip(fact.meaning)}>{fact.text}</span>
            </React.Fragment>
          ))
          : <span className="text-foreground"><span aria-hidden className="text-primary">› </span>{said}</span>}
      </p>
      {modes.length === 0 ? null : <p className="shrink-0 text-primary">-- {modes.join(' · ')} --</p>}
    </footer>
  )
}
