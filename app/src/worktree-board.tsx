import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import * as React from 'react'

import type { FocusResult, WorktreeSummary } from '../contract'
import { encodeWorktreeKey } from '../contract'
import { BoardSurface } from './components/board-surface'
import type { Signals } from './components/marks'
import { SessionApi } from './lib/api'
import { useBoardName, useBoardPath } from './lib/base'
import { useCapabilities } from './lib/capabilities'
import { reads, reread } from './lib/reads'

const messageOf = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback)

/** Why a read failed, or nothing while it has not. */
const failureOf = (error: unknown, fallback: string) => (error === null ? null : messageOf(error, fallback))

const route = getRouteApi('/w/$key/')

/**
 * The board's reads, each on its own. The agents, the trailers and the links
 * answer different questions than the files do and change on their own
 * schedule, and a source that cannot be reached must not take the board down
 * with it: a failed read keeps what it last had and says the latest one
 * failed. The rows are read once, for where the worktree stands among the
 * projects and epics, which the path line says.
 */
function useBoardReads(board: string) {
  const session = useQuery(reads.session(board))
  const agents = useQuery(reads.agents(board))
  const trailers = useQuery(reads.trailers(board))
  const links = useQuery(reads.links(board))
  const rows = useQuery(reads.worktrees())
  return {
    session: session.data ?? null,
    loading: session.isPending,
    loadError: failureOf(session.error, 'Could not load the session'),
    agents: agents.data ?? null,
    agentsError: failureOf(agents.error, 'The agent listing could not be read'),
    trailers: trailers.data ?? [],
    links: links.data ?? null,
    linksError: failureOf(links.error, 'The pull request and issues could not be read'),
    rows: rows.data ?? null,
    rowsError: failureOf(rows.error, 'Could not load the worktrees'),
  }
}

/**
 * A worktree's board, at `/w/<key>/`: its one worktree's lanes, whole. What
 * belongs to that worktree alone, its branch and pull request, the Linear
 * issues it names, the agents at work in it and the trailers its commits
 * carry that could not be acted on, are its marks and facts, drawn in its
 * step of the path line and in the detail line while it is on the focus
 * path. Its stream is the worktree's own, and a drag or a write holds only
 * `changed`.
 */
export function WorktreeBoard() {
  const { focus: leaf } = route.useSearch()
  const board = useBoardPath()
  const name = useBoardName()
  const key = encodeWorktreeKey(name)
  const client = useQueryClient()
  const capabilities = useCapabilities()
  const { session, loading, loadError, agents, agentsError, trailers, links, linksError, rows, rowsError } = useBoardReads(board)

  const focusAgent = React.useCallback(async (pid: number): Promise<FocusResult> => {
    try {
      return await SessionApi.focus(board, pid)
    } catch (error) {
      return { ok: false, reason: messageOf(error, 'The focus request failed') }
    }
  }, [board])

  /** This worktree's signals are the board's own reads; any other's, as its row gives them. */
  const signalsOf = (row: WorktreeSummary): Signals =>
    row.key === key
      ? {
        agents,
        pullRequest: links?.pullRequest ?? null,
        issues: links?.issues ?? null,
        trailers,
        failures: [agentsError, linksError].filter((failure) => failure !== null),
        row,
      }
      : { agents: row.agents, pullRequest: null, issues: null, trailers: row.trailerProblems, failures: [], row }

  return (
    <BoardSurface
      place={{ kind: 'board', key }}
      leaf={leaf}
      title={session?.worktree ? `${session.worktree.name} · Session` : 'Session'}
      parts={[{ board, key, name, session }]}
      rows={rows}
      grouped={false}
      loading={loading}
      problems={[loadError, rowsError].filter((problem) => problem !== null)}
      signalsOf={signalsOf}
      capabilities={capabilities}
      focusAgent={focusAgent}
      rules={session?.rules ?? null}
      stream={{
        board,
        on: {
          agents: () => reread({ client, queryKey: reads.agents(board).queryKey }),
          trailers: () => reread({ client, queryKey: reads.trailers(board).queryKey }),
          links: () => reread({ client, queryKey: reads.links(board).queryKey }),
        },
        held: [],
      }}
    />
  )
}
