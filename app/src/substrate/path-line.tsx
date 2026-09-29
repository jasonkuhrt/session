import * as React from 'react'

import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '../components/ui/breadcrumb'
import { cn } from '../lib/utils'
import { BesideLink, LinkHolder } from './link-holder'
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
 * inside; a step whose node is marked with Space carries the mark too. A step
 * is a `LinkHolder`: its link is stretched across it, so its words, its
 * space and its marks are all the step's, a click or a ⌘-click on any of them,
 * while a mark that is a control of its own, drawn beside the link, keeps its
 * click for itself.
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
  /** A plain click on a step is the step's, which moves the focus there; any other is the browser's, which opens the link. */
  const stepClick = (index: number) => (event: React.MouseEvent) => {
    if (browserClick(event)) return
    event.preventDefault()
    onStep(index)
  }
  return (
    <Breadcrumb aria-label="Focus path" className="sticky top-0 z-20 min-w-0 border-b bg-background/90 px-4 py-2.5 backdrop-blur">
      <BreadcrumbList className="min-w-0 gap-y-0.5">
        {focus.map((id, index) => {
          const path = focus.slice(0, index + 1)
          const drawn = seam.viewOf(path) === view
          const crumb = seam.crumb(path, index, drawn)
          const words = <span className={cn('truncate', crumb.literal === true && 'font-mono text-xs')}>{crumb.text}</span>
          const step = 'inline-flex max-w-72 min-w-0 items-center gap-1.5'
          const address = linkOf(index)
          return (
            <React.Fragment key={path.join('\u001F')}>
              {index === 0 ? null : <BreadcrumbSeparator />}
              <BreadcrumbItem className="min-w-0">
                {index === focus.length - 1
                  ? <BreadcrumbPage title={seam.tip(crumb.meaning)} className={step}>{words}</BreadcrumbPage>
                  : (
                    <LinkHolder
                      as="span"
                      address={address}
                      onLinkClick={stepClick(index)}
                      className={step}
                      title={seam.tip(crumb.meaning)}
                      // The breadcrumb's link, drawn as the app's link, or as a button for a step with no address that moves the focus there all the same.
                      renderLink={(held) => (
                        <BreadcrumbLink
                          {...held}
                          render={address === null ? <button type="button" aria-label={crumb.text} /> : <seam.Link address={address} />}
                          className={cn('cursor-pointer', held.className)}
                        />
                      )}
                      beside={drawn
                        ? null
                        : (
                          <>
                            {crumb.marks}
                            {marks.has(leafOf(path)) && id !== ''
                              ? <BesideLink className="inline-flex items-center"><span aria-label="marked" className="size-1.5 shrink-0 rounded-full bg-primary" /></BesideLink>
                              : null}
                          </>
                        )}
                    >
                      {words}
                    </LinkHolder>
                  )}
              </BreadcrumbItem>
            </React.Fragment>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
