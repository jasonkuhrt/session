import { useQuery, useQueryClient } from '@tanstack/react-query'
import type * as React from 'react'

import type { Item, Session, WorktreeSummary } from '../../contract'
import { IndexApi } from '../lib/api'
import { useCapabilities } from '../lib/capabilities'
import { useNow } from '../lib/clock'
import { reads, reread } from '../lib/reads'
import type { SessionWrite } from '../lib/session-mutations'
import type { PageActions } from '../session-seam'
import { useSessionSeam } from '../session-seam'
import { nodeOf } from '../levels'
import type { Path } from '../substrate/seam'
import { Surface } from '../substrate/surface'
import { useFocus } from '../substrate/surface-context'
import type { Entry, Place } from '../tree-types'
import type { Signals } from './marks'
import { Skeleton } from './ui/skeleton'
import { TooltipProvider } from './ui/tooltip'

/**
 * The reading column: everything on a page under a board shares it, so the
 * title and the prose start on one line down the middle of the window. At
 * the prose's 17px this is about sixty-eight characters, the width a
 * paragraph is read at rather than scanned across.
 */
const readingColumn = 'mx-auto w-full max-w-[37rem]'

/** A worktree's signals on a page, as its row gives them: its agents and its trailers. */
const rowSignals = (row: WorktreeSummary): Signals => ({
  agents: row.agents,
  pullRequest: null,
  issues: null,
  trailers: row.trailerProblems,
  failures: [],
  row,
})

/**
 * A page under a board: its reading column under the path line, which places
 * it, and over the detail line, which says the facts of its focused section
 * or entry. The rows are read once, for where the page stands among the
 * projects and epics. The page is the container its content measures the
 * window by, which lets a code block run the window's width.
 */
export function PageSurface({ place, leaf, title, sessions, archived, entries, write, pending, rules, page, ready, problem, children }: {
  readonly place: Place
  readonly leaf: string | undefined
  /** What the tab names the page. */
  readonly title: string
  readonly sessions: ReadonlyMap<string, Session>
  readonly archived: { readonly key: string; readonly item: Item } | null
  /** The entries the page draws, by the node they are in. */
  readonly entries: ReadonlyMap<string, readonly Entry[]>
  readonly write: SessionWrite | null
  readonly pending: boolean
  readonly rules: boolean | null
  readonly page: PageActions | null
  /** Whether the page's first read has landed. */
  readonly ready: boolean
  /** A read or a write that failed, shown until the next read lands. */
  readonly problem: string | null
  readonly children: React.ReactNode
}) {
  const client = useQueryClient()
  const now = useNow()
  const capabilities = useCapabilities()
  const rowsRead = useQuery(reads.worktrees())
  const rows = rowsRead.data ?? null
  const { seam } = useSessionSeam({
    place,
    leaf,
    data: { rows: rows ?? [], now, sessions, archived, entries, signalsOf: rowSignals },
    ready: ready && rows !== null,
    held: false,
    capabilities,
    write,
    pending,
    readRows: () => reread({ client, queryKey: reads.worktrees().queryKey }),
    focusAgent: IndexApi.focus,
    page,
    rules,
  })
  return (
    <TooltipProvider>
      <Surface seam={seam}>
        {/* One tab per page, so a row of them is readable. React hoists this into the head. */}
        <title>{`${title} · Session`}</title>
        <div className="@container">
          {problem === null ? null : <p className={`${readingColumn} mb-6 text-sm text-destructive wrap-anywhere`}>{problem}</p>}
          <div className={`${readingColumn} pt-4 pb-16`}>{children}</div>
        </div>
      </Surface>
    </TooltipProvider>
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

/** The lines a listing adds about what it left out, in the daemon's own sentences. */
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

/**
 * Where a node of a kind is on the focus path, for a page to draw the nodes
 * that hang off it: its record's or its item's path, once the rows say where
 * the page stands; null until then.
 */
export function useFocusUpTo(kind: 'record' | 'item'): Path | null {
  const focus = useFocus()
  const at = focus.findLastIndex((id) => nodeOf(id)?.kind === kind)
  return at === -1 ? null : focus.slice(0, at + 1)
}
