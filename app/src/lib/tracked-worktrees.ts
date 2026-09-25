import * as React from 'react'

import { eventsUrl, IndexApi } from './api'
import { useNewestRead } from './newest-read'

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : null)

const rowsProblem = (error: unknown) => reasonOf(error) ?? 'Could not load the sessions'

const pullRequestsProblem = (error: unknown) =>
  `The pull requests could not be read: ${reasonOf(error) ?? 'the read failed'}`

/**
 * What the index shows, as the daemon last reported it: a row for every
 * tracked worktree, and the pull request gh reported for each. The two are
 * read apart, because a row is recomputed from Git, the session and the agent
 * listing on every read, while a pull request is gh's last answer, which the
 * daemon only holds.
 *
 * The daemon pushes `worktrees` when the set of tracked worktrees changes,
 * `agents` when a Claude session registry or Codex writer lock does, and
 * `pull-requests` after it asks gh about a row. None carries a payload, so the
 * index reads again. The daemon asks gh only while an index listens, starting
 * the moment one begins to, so no answer lands before the stream that would
 * announce it. A stream that dropped and came back reads both again, since
 * changes land while it is down and the index otherwise never polls.
 */
export function useTrackedWorktrees() {
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

  React.useEffect(() => {
    const source = new EventSource(eventsUrl(['agents', 'worktrees', 'pull-requests']))
    const dropped = { value: false }
    const refetchRows = () => void loadRows()
    const refetchPullRequests = () => void loadPullRequests()
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

  return {
    rows: rows.answer,
    notice: rows.problem,
    pullRequests: pullRequests.answer ?? {},
    pullRequestsNotice: pullRequests.problem,
  }
}
