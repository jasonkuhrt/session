import * as React from 'react'

import type { Session } from '../../contract'
import type { SessionMutation, SessionWriteBody } from './api'
import { ApiError, SessionApi } from './api'

/** A conflict is not a failure: nothing was lost and the view caught up. */
export const refreshedNotice =
  'The Markdown changed on disk. The board was refreshed; please try again.'

/** A write to one worktree's records, on the revision it was drawn on, answering why it did not land, or null. */
export type SessionWrite = <P extends SessionMutation>(
  board: string,
  path: P,
  body: SessionWriteBody<P>,
  drawn?: string,
) => Promise<string | null>

/**
 * The one way a view changes the records, so the board and the item page
 * cannot drift on the part that matters: every write goes to the board of the
 * session it changes, carrying the revision the view drew it on, and one that
 * lost the race reads that session again and says the records moved rather
 * than overwriting a newer file. The view says what either answer is in the
 * detail line, since a write is a command's and a command's reason is said
 * there.
 */
export function useSessionWrites(input: {
  /** The revision of each board's session as the view drew it; null while it has not been read. */
  readonly revisionOf: (board: string) => string | null
  /** Shows the session a write answered with, on its board; the write stays pending until a returned promise settles. */
  readonly onSession: (board: string, session: Session) => void | Promise<void>
  /** Reads one board's session again. */
  readonly reload: (board: string) => Promise<unknown>
}): { readonly pending: boolean; readonly write: SessionWrite } {
  const { revisionOf, onSession, reload } = input
  const [pending, setPending] = React.useState(false)
  const write: SessionWrite = React.useCallback(
    async (board, path, body, drawn) => {
      const revision = drawn ?? revisionOf(board)
      if (revision === null) return 'The session has not been read yet.'
      setPending(true)
      try {
        await onSession(board, await SessionApi.mutate(board, path, body, revision))
        return null
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          await reload(board)
          return refreshedNotice
        }
        return error instanceof Error ? error.message : 'The request failed'
      } finally {
        setPending(false)
      }
    },
    [onSession, reload, revisionOf],
  )
  return { pending, write }
}
