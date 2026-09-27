import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import * as React from 'react'

import { BoardSurface } from './components/board-surface'
import { NoPage } from './components/no-page'
import { SessionHeader } from './components/session-header'
import { useNow } from './lib/clock'
import type { UnionFilter } from './lib/filter'
import { boardOf, keyTaken, unionOf } from './lib/filter'
import { reads, reread } from './lib/reads'

const messageOf = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback)

/**
 * An epic's board, at `/e/<name>/`, or a project's, at `/p/<path>/`: the
 * union of the sessions of every worktree in it, which the rows the index
 * reads say by their epic and their repository. Each lane holds every
 * worktree's part under its name, in the order the union gives, and every
 * action goes to the board of the item's own worktree. It draws nothing that
 * belongs to one worktree alone, its agents, pull request, issues, pages,
 * terminal or Zed: each worktree's name in the lanes opens its own board,
 * where they are. A worktree whose key reaches another's board is not served,
 * and says so above the lanes, as does a session that could not be read. An
 * address no tracked worktree is in draws the not-found page once the rows
 * have said so.
 *
 * It follows one stream, the root's, however many worktrees are in view, so
 * the page has one subscription and one hold: `changed` there is every
 * tracked session's, on which it reads every session in view again, and
 * `worktrees` says the rows changed, which is how a worktree joins or leaves
 * the view. A drag or a write holds both.
 */
export function UnionBoard({ filter }: { readonly filter: UnionFilter }) {
  const client = useQueryClient()
  const now = useNow()
  const rows = useQuery(reads.worktrees())
  const union = rows.data === undefined ? undefined : unionOf({ filter, rows: rows.data, now })
  const listed = rows.data ?? []
  const served = union?.rows.filter(row => !keyTaken({ row, rows: listed })) ?? []
  const sessions = useQueries({ queries: served.map(row => reads.session(boardOf(row))) })
  const readRows = React.useCallback(() => reread({ client, queryKey: reads.worktrees().queryKey }), [client])

  if (union === null) return <NoPage />

  const parts = served.map((row, index) => ({ board: boardOf(row), name: row.name, session: sessions[index]?.data ?? null }))
  const problems = [
    ...(rows.error === null ? [] : [messageOf(rows.error, 'Could not load the worktrees')]),
    ...(union?.rows ?? []).flatMap(row => (keyTaken({ row, rows: listed }) ? [`${row.name} is not served: ${row.conflict}`] : [])),
    ...served.flatMap((row, index) => {
      const error = sessions[index]?.error ?? null
      return error === null ? [] : [`${row.name}: ${messageOf(error, 'Could not load the session')}`]
    }),
  ]
  return (
    <div className="min-h-dvh bg-background text-foreground">
      {/* One tab per board, so a row of them is readable. React hoists this into the head. */}
      <title>{union === undefined ? 'Session' : `${union.name} · Session`}</title>
      <SessionHeader filter={filter} worktree={undefined} rules={false} links={null} linksError={null} terminal={false} zed={false} />
      <BoardSurface
        parts={parts}
        grouped
        // The skeleton stands until a first session lands; a worktree that
        // joins the view later appears once its own read lands, and the board
        // meanwhile stays as it is.
        loading={rows.isPending || (sessions.length > 0 && sessions.every(read => read.isPending))}
        problems={problems}
        stream={{ board: '', on: { worktrees: readRows }, held: ['worktrees'], release: readRows }}
      />
    </div>
  )
}
