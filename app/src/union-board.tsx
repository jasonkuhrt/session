import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearch } from '@tanstack/react-router'
import * as React from 'react'

import type { WorktreeSummary } from '../contract'
import { BoardSurface } from './components/board-surface'
import type { Signals } from './components/marks'
import { NoPage } from './components/no-page'
import { IndexApi } from './lib/api'
import { useCapabilities } from './lib/capabilities'
import { useNow } from './lib/clock'
import type { UnionFilter } from './lib/filter'
import { boardOf, keyTaken, unionOf } from './lib/filter'
import { reads, reread, sinceMount } from './lib/reads'

const messageOf = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback)

/**
 * An epic's board, at `/e/<name>/`, or a project's, at `/p/<path>/`: the
 * union of the sessions of every worktree in it, which the rows the index
 * reads say by their epic and their repository. Each worktree stands in a row
 * across the lanes under its name, with its marks, its agents and its pull
 * request, as it has them wherever it is drawn, and every action goes to the
 * board of the item's own worktree. A worktree whose key reaches another's
 * board is not served, and says so above the lanes, as does a session that
 * could not be read. An address no tracked worktree is in draws the
 * not-found page once the rows have said so.
 *
 * It follows one stream, the root's, however many worktrees are in view:
 * `changed` there is every tracked session's, on which it reads every session
 * in view again, `worktrees` and `agents` say the rows changed, which is how
 * a worktree joins or leaves the view and how its agents' marks move, and
 * `pull-requests` that gh answered again. A drag or a write holds the rows'.
 */
export function UnionBoard({ filter }: { readonly filter: UnionFilter }) {
  const { focus: leaf } = useSearch({ strict: false })
  const client = useQueryClient()
  const now = useNow()
  const capabilities = useCapabilities()
  const rowsRead = useQuery(reads.worktrees())
  const pullRequests = useQuery(reads.pullRequests())
  const rows = sinceMount(rowsRead)
  const union = rows === undefined ? undefined : unionOf({ filter, rows, now })
  const listed = rows ?? []
  const served = union?.rows.filter((row) => !keyTaken({ row, rows: listed })) ?? []
  const sessions = useQueries({ queries: served.map((row) => reads.session(boardOf(row))) })
  const readRows = React.useCallback(() => reread({ client, queryKey: reads.worktrees().queryKey }), [client])
  const readPullRequests = React.useCallback(() => reread({ client, queryKey: reads.pullRequests().queryKey }), [client])

  if (union === null) return <NoPage />

  const parts = served.map((row, index) => ({ board: boardOf(row), key: row.key, name: row.name, session: sinceMount(sessions[index]) ?? null }))
  const problems = [
    ...(rowsRead.error === null ? [] : [messageOf(rowsRead.error, 'Could not load the worktrees')]),
    ...(union?.rows ?? []).flatMap((row) => (keyTaken({ row, rows: listed }) ? [`${row.name} is not served: ${row.conflict}`] : [])),
    ...served.flatMap((row, index) => {
      const error = sessions[index]?.error ?? null
      return error === null ? [] : [`${row.name}: ${messageOf(error, 'Could not load the session')}`]
    }),
  ]
  const failures = pullRequests.error === null ? [] : [`The pull requests could not be read: ${messageOf(pullRequests.error, 'the read failed')}`]
  const signalsOf = (row: WorktreeSummary): Signals => ({
    agents: row.agents,
    pullRequest: pullRequests.data?.[row.path] ?? null,
    issues: null,
    trailers: row.trailerProblems,
    failures,
    row,
  })
  return (
    <BoardSurface
      place={{ kind: 'union', filter }}
      leaf={leaf}
      title={union === undefined ? 'Session' : `${union.name} · Session`}
      parts={parts}
      rows={rows ?? null}
      grouped
      // The skeleton stands until a first session lands; a worktree that
      // joins the view later appears once its own read lands, and the board
      // meanwhile stays as it is.
      loading={!rowsRead.isFetchedAfterMount || (sessions.length > 0 && sessions.every((session) => !session.isFetchedAfterMount))}
      problems={problems}
      signalsOf={signalsOf}
      capabilities={capabilities}
      focusAgent={IndexApi.focus}
      rules={null}
      stream={{
        board: '',
        on: { worktrees: readRows, agents: readRows, 'pull-requests': readPullRequests },
        held: ['worktrees', 'agents'],
        release: readRows,
      }}
    />
  )
}
