import * as React from 'react'

import { eventsUrl, IndexApi } from './api'
import { useNewestRead } from './newest-read'

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : null)

const rowsProblem = (error: unknown) => reasonOf(error) ?? 'Could not load the worktrees'

const pullRequestsProblem = (error: unknown) =>
  `The pull requests could not be read: ${reasonOf(error) ?? 'the read failed'}`

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
  const rows = useNewestRead({ read: IndexApi.read, describe: rowsProblem })
  const pullRequests = useNewestRead({ read: IndexApi.pullRequests, describe: pullRequestsProblem })
  const loadRows = rows.load
  const loadPullRequests = pullRequests.load

  React.useEffect(() => {
    const controller = new AbortController()
    void loadRows(controller.signal)
    void loadPullRequests(controller.signal)
    return () => controller.abort()
  }, [loadRows, loadPullRequests])

  usePushedReads({ held, loadRows, loadPullRequests })

  return {
    rows: rows.answer,
    notice: rows.problem,
    pullRequests: pullRequests.answer ?? {},
    pullRequestsNotice: pullRequests.problem,
    /** Reads the rows now, whether or not reads are held: what a write does once it has landed. */
    reload: loadRows,
  }
}

/**
 * The reads the daemon's pushes ask for, each when it is pushed, or, while
 * `held`, remembered and made once when it is not.
 */
function usePushedReads({ held, loadRows, loadPullRequests }: {
  readonly held: boolean
  readonly loadRows: () => Promise<void>
  readonly loadPullRequests: () => Promise<void>
}) {
  const heldRef = React.useRef(held)
  const missedRef = React.useRef(false)

  React.useEffect(() => {
    const source = new EventSource(eventsUrl(['agents', 'worktrees', 'pull-requests']))
    const dropped = { value: false }
    const unlessHeld = (read: () => void) => () => {
      if (heldRef.current) missedRef.current = true
      else read()
    }
    const refetchRows = unlessHeld(() => void loadRows())
    const refetchPullRequests = unlessHeld(() => void loadPullRequests())
    source.addEventListener('agents', refetchRows)
    source.addEventListener('worktrees', refetchRows)
    source.addEventListener('pull-requests', refetchPullRequests)
    source.addEventListener('error', () => { dropped.value = true })
    source.addEventListener('open', () => {
      if (!dropped.value) return
      dropped.value = false
      refetchRows()
      refetchPullRequests()
    })
    return () => source.close()
  }, [loadRows, loadPullRequests])

  React.useEffect(() => {
    heldRef.current = held
    if (held || !missedRef.current) return
    missedRef.current = false
    void loadRows()
    void loadPullRequests()
  }, [held, loadRows, loadPullRequests])
}
