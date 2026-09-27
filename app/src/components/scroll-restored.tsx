import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import { useElementScrollRestoration } from '@tanstack/react-router'
import * as React from 'react'

/**
 * Where Back or Forward left this page, reached once its content is drawn.
 * The router scrolls the window back when the page mounts, but a page reads
 * after it mounts, so a long page is still its skeleton then and the scroll
 * stops short. This scrolls there again once `ready`, the page's own first
 * read having landed, and no read of the page is still under way, such as
 * the picker's, whose control is taller than the name it replaces: scrolling
 * earlier would leave the page as far off as that growth. It scrolls once and
 * never after, so a later read never moves the page under the reader. A page
 * reached by a link has no place to come back to and stays at the top. It
 * draws nothing, so the reads it watches redraw nothing else.
 */
export function ScrollRestored({ ready }: { ready: boolean }) {
  const place = useElementScrollRestoration({ getElement: () => window })
  const client = useQueryClient()
  const fetching = useIsFetching()
  const restored = React.useRef(false)
  React.useEffect(() => {
    if (!ready || restored.current || fetching > 0) return
    // A read begun in this same commit, such as the picker's when the session
    // lands, starts in an effect that may run after this one, so the client is
    // asked once every effect of the commit has run; a read under way then
    // brings this back when it ends.
    let current = true
    queueMicrotask(() => {
      if (!current || restored.current || client.isFetching() > 0) return
      restored.current = true
      if (place !== undefined) window.scrollTo({ top: place.scrollY, left: place.scrollX })
    })
    return () => {
      current = false
    }
  }, [client, fetching, place, ready])
  return null
}
