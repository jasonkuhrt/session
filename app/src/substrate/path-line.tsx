import * as React from 'react'

import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '../components/ui/breadcrumb'
import { cn } from '../lib/utils'
import { leafOf } from './path'
import type { Address, Path, Seam } from './seam'
import { browserClick } from './surface-hooks'

/**
 * The path line: the one header there is, the focus path from the root as a
 * breadcrumb, each step before the focus a way back to where it names and
 * the app's link to that address, so a click with a modifier or the middle
 * button opens it in a new tab, and the focus itself the page the breadcrumb
 * ends on. A step whose node the view does not draw carries that node's
 * marks, what can need you now about it, so a view keeps in sight what it is
 * inside; a step whose node is marked with Space carries the mark too.
 */
export function PathLine({ seam, focus, view, marks, linkOf, onStep }: {
  readonly seam: Seam
  readonly focus: Path
  readonly view: string
  readonly marks: ReadonlySet<string>
  /** Where a step's link goes, which is where a click on it moves the focus. */
  readonly linkOf: (index: number) => Address | null
  readonly onStep: (index: number) => void
}) {
  return (
    <Breadcrumb aria-label="Focus path" className="sticky top-0 z-20 min-w-0 border-b bg-background/90 px-4 py-2.5 backdrop-blur">
      <BreadcrumbList className="min-w-0 gap-y-0.5">
        {focus.map((id, index) => {
          const path = focus.slice(0, index + 1)
          const drawn = seam.viewOf(path) === view
          const crumb = seam.crumb(path, index, drawn)
          const words = <span className="truncate">{crumb.text}</span>
          const step = cn('inline-flex max-w-72 min-w-0', crumb.literal === true && 'font-mono text-xs')
          return (
            <React.Fragment key={path.join('\u001F')}>
              {index === 0 ? null : <BreadcrumbSeparator />}
              <BreadcrumbItem className="min-w-0">
                {index === focus.length - 1
                  ? <BreadcrumbPage title={seam.tip(crumb.meaning)} className={step}>{words}</BreadcrumbPage>
                  : <StepLink seam={seam} address={linkOf(index)} title={seam.tip(crumb.meaning)} className={step} onStep={() => onStep(index)}>{words}</StepLink>}
                {drawn ? null : crumb.marks}
                {!drawn && marks.has(leafOf(path)) && id !== ''
                  ? <span aria-label="marked" className="size-1.5 shrink-0 rounded-full bg-primary" />
                  : null}
              </BreadcrumbItem>
            </React.Fragment>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}

/**
 * A step before the focus: the breadcrumb's link to where the step goes, or,
 * for a step with no address, a button that moves the focus there all the
 * same. A press leaves the browser's focus with the page, so the keys that
 * follow reach the registry; a plain click is the step's, and any other the
 * browser's, which opens the link.
 */
function StepLink({ seam, address, title, className, onStep, children }: {
  readonly seam: Seam
  readonly address: Address | null
  readonly title: string | undefined
  readonly className: string
  readonly onStep: () => void
  readonly children: React.ReactNode
}) {
  // The words go on the element the link is drawn as, which keeps them as its own.
  return (
    <BreadcrumbLink
      render={address === null ? <button type="button">{children}</button> : <seam.Link address={address}>{children}</seam.Link>}
      tabIndex={-1}
      title={title}
      className={cn('cursor-pointer', className)}
      onMouseDown={(event) => event.preventDefault()}
      onClick={(event) => {
        if (browserClick(event)) return
        event.preventDefault()
        onStep()
      }}
    />
  )
}
