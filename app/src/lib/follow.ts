import * as React from 'react'

import { eventsUrl } from './api'

/** What a page last read, and why its latest read failed. */
export type Followed<A> = {
  /** Null until the first read lands. */
  readonly value: A | null
  /** Why the latest read failed; what was read before it stays on screen. */
  readonly error: string | null
}

/**
 * One read of a page under a board, kept current with the files: made when
 * the page opens, again on every `changed` the daemon pushes for a write under
 * the worktree's `.session`, and again when a dropped stream comes back,
 * because writes land while it is down. Only the latest read lands, so a slow
 * answer never replaces a newer one, and a failed read keeps what the page
 * last showed and says why. The page never polls, and its stream carries
 * nothing but `changed`, so it keeps nothing else asking.
 *
 * `read` is the page's one question and must keep its identity across renders.
 */
export function useFollowed<A>(read: (signal: AbortSignal) => Promise<A>): Followed<A> {
  const [state, setState] = React.useState<Followed<A>>({ value: null, error: null })

  React.useEffect(() => {
    const controller = new AbortController()
    let cancelled = false
    let latest = 0
    const load = async () => {
      const mine = ++latest
      try {
        const value = await read(controller.signal)
        if (cancelled || mine !== latest) return
        setState({ value, error: null })
      } catch (error) {
        if (cancelled || mine !== latest) return
        const message = error instanceof Error ? error.message : 'The session could not be read'
        setState((last) => ({ value: last.value, error: message }))
      }
    }

    void load()
    const source = new EventSource(eventsUrl(['changed']))
    let dropped = false
    source.addEventListener('changed', () => void load())
    source.addEventListener('error', () => {
      dropped = true
    })
    source.addEventListener('open', () => {
      if (!dropped) return
      dropped = false
      void load()
    })
    return () => {
      cancelled = true
      controller.abort()
      source.close()
    }
  }, [read])

  return state
}
