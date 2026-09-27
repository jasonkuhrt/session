import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as React from 'react'

import type { FocusResult } from '../contract'
import { AgentsStrip } from './components/agents'
import { BoardSurface } from './components/board-surface'
import { SessionHeader } from './components/session-header'
import { TrailerProblems } from './components/trailer-problems'
import { useCapabilities } from './components/worktree-actions'
import { SessionApi } from './lib/api'
import { useBoardName, useBoardPath } from './lib/base'
import { useNow } from './lib/clock'
import { reads, reread, sinceMount } from './lib/reads'

const messageOf = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback)

/** Why a read failed, or nothing while it has not. */
const failureOf = (error: unknown, fallback: string) => (error === null ? null : messageOf(error, fallback))

/**
 * The board's reads, each on its own. The agents overlay, the trailers and the
 * links answer different questions than the files do and change on their own
 * schedule, and a source that cannot be reached must not take the board down
 * with it: a failed read keeps what it last had and says the latest one
 * failed. The trailers are the daemon's answer, derived from the branch and
 * the files, and a failed read of them says nothing: the session read beside
 * it reports an unreachable daemon. The session is drawn once this board has
 * read it, not as an epic's or a project's board it came from last drew it.
 */
function useBoardReads(board: string) {
  const session = useQuery(reads.session(board))
  const agents = useQuery(reads.agents(board))
  const trailers = useQuery(reads.trailers(board))
  const links = useQuery(reads.links(board))
  return {
    session: sinceMount(session) ?? null,
    loading: !session.isFetchedAfterMount,
    loadError: failureOf(session.error, 'Could not load the session'),
    agents: agents.data ?? null,
    agentsError: failureOf(agents.error, 'The agent listing could not be read'),
    trailers: trailers.data ?? [],
    links: links.data ?? null,
    linksError: failureOf(links.error, 'The pull request and issues could not be read'),
  }
}

/**
 * A worktree's board, at `/w/<key>/`: the filter of one worktree, whose lanes
 * stand whole. Beside them it draws what belongs to that worktree alone: the
 * branch checked out in it and its pull request, the Linear issues it names,
 * its session's pages, a terminal and Zed there, the agents at work in it and
 * the trailers its commits carry that could not be acted on. Its stream is the
 * worktree's own, and a drag or a write holds only `changed`.
 */
export function WorktreeBoard() {
  const board = useBoardPath()
  const name = useBoardName()
  const client = useQueryClient()
  const now = useNow()
  const capabilities = useCapabilities()

  const { session, loading, loadError, agents, agentsError, trailers, links, linksError } = useBoardReads(board)

  const focusAgent = React.useCallback(async (pid: number): Promise<FocusResult> => {
    try {
      return await SessionApi.focus(board, pid)
    } catch (error) {
      return { ok: false, reason: messageOf(error, 'The focus request failed') }
    }
  }, [board])

  return (
    <BoardSurface
      head={
        <>
          {/* One tab per board, so a row of them is readable. React hoists this into the head. */}
          <title>{session?.worktree ? `${session.worktree.name} · Session` : 'Session'}</title>
          <SessionHeader
            filter={{ kind: 'worktree', name }}
            worktree={session?.worktree}
            rules={session?.rules ?? false}
            links={links}
            linksError={linksError}
            terminal={capabilities.terminal}
            zed={capabilities.zed}
          />
          <AgentsStrip agents={agents} error={agentsError} now={now} onFocus={focusAgent} />
          <TrailerProblems problems={trailers} />
        </>
      }
      parts={[{ board, name, session }]}
      grouped={false}
      loading={loading}
      problems={loadError === null ? [] : [loadError]}
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
