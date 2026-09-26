import * as React from 'react'

import type { Session } from '../../contract'
import type { SessionMutation } from './api'
import { ApiError, SessionApi } from './api'
import { useBoardPath } from './base'

/** A conflict is not a failure: nothing was lost and the surface caught up. */
export const refreshedNotice =
  'The Markdown changed on disk. The board was refreshed; please try again.'

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
  /** Shows the session a write answered with; the write stays pending until a returned promise settles. */
  readonly onSession: (session: Session) => void | Promise<void>
  readonly reload: () => Promise<void>
}) {
  const { session, onSession, reload } = input
  const board = useBoardPath()
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
        await onSession(await SessionApi.mutate(board, path, { ...body, revision: session.revision }))
        return true
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          // The notice stands on the session the reload reads, so it follows it.
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
    [board, onSession, reload, session],
  )

  const clear = React.useCallback(() => {
    setFailure(null)
    setRefreshed(false)
  }, [])
  const follow = useFollow(session, clear)

  return { pending, failure, refreshed, mutate, follow }
}

/**
 * A fresh read after a pushed change, which makes a surface's messages stale
 * only when it moved past what the surface shows: the push for a write the
 * surface already reloaded after a conflict arrives just after that reload,
 * and must not take away the notice that says the surface caught up.
 */
function useFollow(session: Session | null, clear: () => void) {
  // The revision on screen, so a fresh read can tell whether it moved past it.
  const shown = React.useRef<string | null>(null)
  React.useEffect(() => {
    shown.current = session?.revision ?? null
  }, [session])
  return React.useCallback(
    async (read: () => Promise<Session | null>) => {
      const before = shown.current
      const next = await read()
      if (next !== null && next.revision !== before) clear()
    },
    [clear],
  )
}
