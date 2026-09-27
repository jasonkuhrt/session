import * as React from 'react'

import type { Session } from '../../contract'
import type { SessionMutation, SessionWriteBody } from './api'
import { ApiError, SessionApi } from './api'

/** A conflict is not a failure: nothing was lost and the surface caught up. */
export const refreshedNotice =
  'The Markdown changed on disk. The board was refreshed; please try again.'

/** The sessions a surface draws, by the prefix of the board each is served under; null until its first read lands. */
export type SessionsOnScreen = ReadonlyMap<string, Session | null>

/**
 * The one way a surface changes the records, so the board and the item page
 * cannot drift on the part that matters: every mutation goes to the board of
 * the session it changes, carrying the revision the surface drew it on, and
 * one that lost the race reloads that session and says the records moved
 * rather than overwriting a newer file. That is the session it read, unless
 * the write was made on an earlier one, as a board's drop is made on the
 * session it drew when the card was picked up. A board that draws the
 * worktrees of an epic or a project writes each item through its own
 * worktree's board, so nothing crosses worktrees. A real failure and a
 * refresh are kept apart, because one is a problem to look at and the other
 * is the surface saying it caught up.
 */
export function useSessionMutations(input: {
  readonly sessions: SessionsOnScreen
  /** Shows the session a write answered with, on its board; the write stays pending until a returned promise settles. */
  readonly onSession: (board: string, session: Session) => void | Promise<void>
  /** Reads one board's session again. */
  readonly reload: (board: string) => Promise<void>
}) {
  const { sessions, onSession, reload } = input
  const [pending, setPending] = React.useState(false)
  const [failure, setFailure] = React.useState<string | null>(null)
  const [refreshed, setRefreshed] = React.useState(false)

  const mutate = React.useCallback(
    // `drawn` is the revision the write was drawn on; the session read, when left out.
    async <P extends SessionMutation>(board: string, path: P, body: SessionWriteBody<P>, drawn?: string) => {
      const session = sessions.get(board) ?? null
      if (!session) return false
      setPending(true)
      setFailure(null)
      setRefreshed(false)
      try {
        await onSession(board, await SessionApi.mutate(board, path, body, drawn ?? session.revision))
        return true
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          // The notice stands on the session the reload reads, so it follows it.
          await reload(board)
          setRefreshed(true)
        } else {
          setFailure(error instanceof Error ? error.message : 'The request failed')
        }
        return false
      } finally {
        setPending(false)
      }
    },
    [onSession, reload, sessions],
  )

  const clear = React.useCallback(() => {
    setFailure(null)
    setRefreshed(false)
  }, [])
  const follow = useFollow(sessions, clear)

  return { pending, failure, refreshed, mutate, follow }
}

/**
 * A fresh read after a pushed change, which makes a surface's messages stale
 * only when a session moved past what the surface shows of it: the push for a
 * write the surface already reloaded after a conflict arrives just after that
 * reload, and must not take away the notice that says the surface caught up.
 */
function useFollow(sessions: SessionsOnScreen, clear: () => void) {
  // The revisions on screen, so a fresh read can tell whether any moved past them.
  const shown = React.useRef<ReadonlyMap<string, string | null>>(new Map())
  React.useEffect(() => {
    shown.current = new Map([...sessions].map(([board, session]) => [board, session?.revision ?? null]))
  }, [sessions])
  return React.useCallback(
    async (read: () => Promise<SessionsOnScreen>) => {
      const before = shown.current
      const next = await read()
      const moved = [...next].some(([board, session]) => session !== null && session.revision !== (before.get(board) ?? null))
      if (moved) clear()
    },
    [clear],
  )
}
