import * as React from 'react'

import { useBoardPath } from '../lib/base'
import { cn } from '../lib/utils'
import { SettingsMenu } from './settings-menu'
import { useTip } from './tip'
import { Alert, AlertDescription } from './ui/alert'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from './ui/breadcrumb'
import { Skeleton } from './ui/skeleton'
import { TooltipProvider } from './ui/tooltip'

/**
 * The reading column: everything on a page under a board shares it, so the
 * title, the controls and the prose all start on one line down the middle of
 * the window.
 *
 * The measure is fixed rather than in `ch`, because `ch` here would be counted
 * against the page's font rather than the prose's, and the number that matters
 * is how many characters of the prose land on a line. At its 17px this is
 * about sixty-eight of them, which is the width a paragraph is read at rather
 * than scanned across.
 */
const readingColumn = 'mx-auto w-full max-w-[37rem]'

/** One step of a page's trail after its board: what it is called, what it is, and where it goes. */
export type Crumb = {
  readonly label: string
  /** The sentence behind the step, on hover. */
  readonly meaning: string
  /** Where the step goes; a step without one is only a name, and the last step is the page itself. */
  readonly href?: string
  /** Whether the step is a name the files use, such as an id or a path segment. */
  readonly literal?: boolean
}

/**
 * A page under a board: the trail that places it, what went wrong reading it,
 * and the reading column its content fills. The item page and the session's
 * listings and files share it, so every page under a board is entered and left
 * the same way. The page is the container its content measures the window
 * by, which is what lets a code block in the column run the window's width
 * without counting a scroll bar in it.
 */
export function BoardPageFrame({ title, worktree, boardMeaning, crumbs, problem, notice = null, children }: {
  /** What the page is, first in the tab's name. */
  title: string
  /** The worktree's name, once the session has been read. */
  worktree: string | null
  /** What the board step of the trail means from this page. */
  boardMeaning: string
  crumbs: readonly Crumb[]
  /** A read or a write that failed, shown until the next read lands. */
  problem: string | null
  /** A line from the page that is not a problem, such as having caught up after a conflict. */
  notice?: string | null
  children: React.ReactNode
}) {
  return (
    <TooltipProvider>
      <div className="@container min-h-dvh bg-background text-foreground">
        {/* One tab per page, so a row of them is readable. React hoists this into the head. */}
        <title>{worktree === null ? `${title} · Session` : `${title} · ${worktree} · Session`}</title>
        <PageTrail worktree={worktree} boardMeaning={boardMeaning} crumbs={crumbs} />
        {problem === null ? null : (
          <Alert variant="destructive" className={`${readingColumn} mt-6`}>
            <AlertDescription>{problem}</AlertDescription>
          </Alert>
        )}
        {notice === null ? null : <p className={`${readingColumn} mt-6 text-sm text-muted-foreground`}>{notice}</p>}
        <main className="px-6 pb-24 pt-10">
          <div className={readingColumn}>{children}</div>
        </main>
      </div>
    </TooltipProvider>
  )
}

/**
 * Where this page sits, and the way back out of it.
 *
 * A page is one level inside a worktree's board, which is one level inside
 * every worktree the daemon tracks, and the trail is that sentence: each step
 * names the place it goes to, and the last one names where you are. It is the
 * page's only navigation, so it sits where a window's navigation sits rather
 * than inside the reading column.
 */
function PageTrail({ worktree, boardMeaning, crumbs }: {
  worktree: string | null
  boardMeaning: string
  crumbs: readonly Crumb[]
}) {
  const tip = useTip()
  const boardPath = useBoardPath()
  const board = worktree ?? 'Board'
  // A step is known by the steps that lead to it, so two steps with one name,
  // such as a path's `a/a`, are still two.
  const steps = crumbs.map((crumb, position) => ({
    crumb,
    last: position === crumbs.length - 1,
    trail: crumbs.slice(0, position + 1).map((step) => step.label).join('/'),
  }))
  return (
    <header className="sticky top-0 z-10 flex items-center gap-4 border-b bg-background/85 px-6 py-3 backdrop-blur">
      <Breadcrumb className="min-w-0">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink
              render={
                <a
                  aria-label="All worktrees"
                  href="/"
                  title={tip('Every worktree the daemon is tracking.')}
                />
              }
            >
              All worktrees
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink render={<a aria-label={board} href={`${boardPath}/`} title={tip(boardMeaning)} />}>
              {board}
            </BreadcrumbLink>
          </BreadcrumbItem>
          {steps.map(({ crumb, last, trail }) => (
            <React.Fragment key={trail}>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                {last
                  ? (
                    <BreadcrumbPage className={cn(crumb.literal && 'font-mono')} title={tip(crumb.meaning)}>
                      {crumb.label}
                    </BreadcrumbPage>
                  )
                  : crumb.href === undefined
                  ? <span className={cn(crumb.literal && 'font-mono')} title={tip(crumb.meaning)}>{crumb.label}</span>
                  : (
                    <BreadcrumbLink
                      className={cn(crumb.literal && 'font-mono')}
                      render={<a aria-label={crumb.label} href={crumb.href} title={tip(crumb.meaning)} />}
                    >
                      {crumb.label}
                    </BreadcrumbLink>
                  )}
              </BreadcrumbItem>
            </React.Fragment>
          ))}
        </BreadcrumbList>
      </Breadcrumb>
      <SettingsMenu className="ml-auto" />
    </header>
  )
}

/** The shape a page's content will take, so the first paint is not a blank column. */
export function PageLoading() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-9 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-64" />
    </div>
  )
}

/**
 * The lines a listing adds about what it left out, such as a file that breaks
 * the ledger's rules or a link that leads outside the session. They are the
 * daemon's own sentences, each naming the file and why.
 */
export function ListingNotices({ notices }: { notices: readonly string[] }) {
  if (notices.length === 0) return null
  return (
    <ul className="mb-8 space-y-1 text-sm text-muted-foreground">
      {notices.map((notice) => <li key={notice} className="wrap-anywhere">{notice}</li>)}
    </ul>
  )
}

/** What a listing says when it holds nothing. */
export function ListingEmpty({ children }: { children: React.ReactNode }) {
  return <p className="py-20 text-center text-sm text-muted-foreground">{children}</p>
}
