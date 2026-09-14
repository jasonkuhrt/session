import type { ClaudeSession, CodexThread } from '../../contract'

/**
 * What the two agent surfaces agree a listing means. The board's strip and the
 * index's cell read the same words off the same answers, so one can never call
 * a session something the other does not.
 */

/** The statuses Claude Code reports today, in the order a person needs them. */
export const statusOrder = ['waiting', 'busy', 'shell', 'idle']

/** A session the listing gave no status for; not a value the enum can take. */
export const missingStatus = 'no status'

/** The one status that means a person is being waited on. */
export const waitingStatus = 'waiting'

/**
 * Sessions per status: the known statuses in their order, then anything newer
 * in the order it arrived, so a value this build has never heard of is counted
 * and named rather than dropped.
 */
export function statusCounts(sessions: readonly ClaudeSession[]) {
  const counts = new Map<string, number>()
  for (const session of sessions) {
    const status = session.status ?? missingStatus
    counts.set(status, (counts.get(status) ?? 0) + 1)
  }
  const rank = (status: string) => {
    const known = statusOrder.indexOf(status)
    return known === -1 ? statusOrder.length : known
  }
  return [...counts].map(([status, count]) => ({ status, count })).toSorted((left, right) =>
    rank(left.status) - rank(right.status)
  )
}

/** Threads a live process holds open right now; `null` is unknown, never open. */
export const loadedCount = (threads: readonly CodexThread[]) =>
  threads.filter((thread) => thread.loaded === true).length
