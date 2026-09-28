import * as React from 'react'

import { cn } from '../lib/utils'
import { leafOf } from './path'
import type { Path, Seam } from './seam'

/**
 * The path line: the one header there is, the focus path from the root, each
 * step a way back to where it names. A step whose node the view does not draw
 * carries that node's marks, what can need you now about it, so a board keeps
 * its worktree's agents and pull request in view; a step whose node is marked
 * with Space carries the mark too.
 */
export function PathLine({ seam, focus, view, marks, onStep }: {
  readonly seam: Seam
  readonly focus: Path
  readonly view: string
  readonly marks: ReadonlySet<string>
  readonly onStep: (index: number) => void
}) {
  return (
    <nav
      aria-label="Focus path"
      className="sticky top-0 z-20 flex min-w-0 flex-wrap items-baseline gap-y-0.5 border-b bg-background/90 px-4 py-2.5 text-sm backdrop-blur"
    >
      {focus.map((id, index) => {
        const path = focus.slice(0, index + 1)
        const drawn = seam.viewOf(path) === view
        const crumb = seam.crumb(path, index, drawn)
        const here = index === focus.length - 1
        return (
          <React.Fragment key={path.join('\u001F')}>
            {index === 0 ? null : <span aria-hidden className="px-1 text-muted-foreground/50 select-none">›</span>}
            <button
              type="button"
              tabIndex={-1}
              title={seam.tip(crumb.meaning)}
              onClick={() => onStep(index)}
              className={cn(
                'inline-flex max-w-72 min-w-0 cursor-pointer items-baseline gap-2 rounded-sm px-1 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground',
                here && 'font-medium text-foreground',
                crumb.literal === true && 'font-mono text-xs',
              )}
            >
              <span className="truncate">{crumb.text}</span>
              {drawn ? null : crumb.marks}
              {!drawn && marks.has(leafOf(path)) && id !== ''
                ? <span aria-label="marked" className="size-1.5 shrink-0 self-center rounded-full bg-primary" />
                : null}
            </button>
          </React.Fragment>
        )
      })}
    </nav>
  )
}
