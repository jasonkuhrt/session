import * as React from 'react'

import type { Session } from '../../contract'
import { ApiError, SessionApi } from './api'

/** A conflict is not a failure: nothing was lost and the surface caught up. */
export const refreshedNotice =
  'The Markdown changed on disk. The board was refreshed; please try again.'

/** Every route that moves the records. The board and the item page share them. */
export type SessionMutation = '/api/move' | '/api/batch' | '/api/start' | '/api/complete'

/**
 * The one way a surface changes the records, so the board and the item page
 * cannot drift on the part that matters: every mutation carries the revision
 * the surface read, and one that lost the race reloads and says the records
 * moved rather than overwriting a newer file. A real failure and a refresh are
 * kept apart, because one is a problem to look at and the other is the surface
 * saying it caught up.
 */
export function useSessionMutations(input: {
  readonly session: Session | null
  readonly onSession: (session: Session) => void
  readonly reload: () => Promise<void>
}) {
  const { session, onSession, reload } = input
  const [pending, setPending] = React.useState(false)
  const [failure, setFailure] = React.useState<string | null>(null)
  const [refreshed, setRefreshed] = React.useState(false)

  const mutate = React.useCallback(
    async (path: SessionMutation, body: Record<string, unknown>) => {
      if (!session) return false
      setPending(true)
      setFailure(null)
      setRefreshed(false)
      try {
        onSession(await SessionApi.mutate(path, { ...body, revision: session.revision }))
        return true
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          // `reload` settles this on the way through, so it is set after it.
          await reload()
          setRefreshed(true)
        } else {
          setFailure(error instanceof Error ? error.message : 'The request failed')
        }
        return false
      } finally {
        setPending(false)
      }
    },
    [onSession, reload, session],
  )

  /** A surface calls this when a fresh read has made both messages stale. */
  const settle = React.useCallback(() => {
    setFailure(null)
    setRefreshed(false)
  }, [])

  return { pending, failure, refreshed, mutate, settle }
}
