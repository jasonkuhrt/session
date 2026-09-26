import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as React from 'react'

import { reads, reread } from './reads'
import { useStream } from './stream'

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : null)

const rowsProblem = (error: unknown) => reasonOf(error) ?? 'Could not load the worktrees'

const pullRequestsProblem = (error: unknown) =>
  `The pull requests could not be read: ${reasonOf(error) ?? 'the read failed'}`

/** The events the index listens for, which are the ones a drag holds. */
const events = ['agents', 'worktrees', 'pull-requests'] as const

/**
 * What the index shows, as the daemon last reported it: a row for every
 * tracked worktree, and the pull request gh reported for each. The two are
 * read apart, because a row is recomputed from Git, the session and the agent
 * listing on every read, while a pull request is gh's last answer, which the
 * daemon only holds.
 *
 * The daemon pushes `worktrees` when the set of tracked worktrees changes or a
 * session changes where a row shows it, `agents` when a Claude session
 * registry or Codex writer lock does, and `pull-requests` after it asks gh
 * about a row. None carries a payload, so the index reads again. The daemon
 * asks gh only while an index listens, starting the moment one begins to, so
 * no answer lands before the stream that would announce it. A stream that
 * dropped and came back reads both again, since changes land while it is down
 * and the index otherwise never polls.
 *
 * While `held`, for as long as a card is dragged or a drop is written, a push
 * reads nothing and is remembered instead, as the board holds its reads; the
 * first moment it is not held, one read of each catches up. A read already
 * under way when the hold begins still lands, so the page draws what it had
 * at pickup for as long as a card is held.
 */
export function useTrackedWorktrees({ held }: { readonly held: boolean }) {
  const client = useQueryClient()
  const rows = useQuery(reads.worktrees())
  const pullRequests = useQuery(reads.pullRequests())

  const readRows = React.useCallback(() => reread({ client, queryKey: reads.worktrees().queryKey }), [client])
  const readPullRequests = React.useCallback(
    () => reread({ client, queryKey: reads.pullRequests().queryKey }),
    [client],
  )

  useStream({
    board: '',
    on: { agents: readRows, worktrees: readRows, 'pull-requests': readPullRequests },
    hold: { held, events, release: () => Promise.all([readRows(), readPullRequests()]) },
  })

  return {
    rows: rows.data ?? null,
    notice: rows.error === null ? null : rowsProblem(rows.error),
    pullRequests: pullRequests.data ?? {},
    pullRequestsNotice: pullRequests.error === null ? null : pullRequestsProblem(pullRequests.error),
    /** Reads the rows now, whether or not reads are held: what a write does once it has landed. */
    reload: readRows,
  }
}
