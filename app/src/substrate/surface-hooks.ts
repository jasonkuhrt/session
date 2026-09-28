import * as React from 'react'

import type { Drawn } from './motion'
import { pathOfKey } from './path'
import type { Path, SurfaceApi } from './seam'

/** What a click on a view leaves to the element it landed in: a link, a button, a field. */
const ownClick = 'a[href], button, input, summary'

/**
 * The view's clicks, heard once, on the view, and handed to the node they
 * landed in; a click on a link or a button inside a node is its own. A press
 * on a node leaves the browser's focus where it is, so the keys that follow
 * still reach the registry rather than the node.
 */
export function useViewClicks({ view, drawn, clicked }: {
  readonly view: React.RefObject<HTMLElement | null>
  readonly drawn: React.RefObject<ReadonlyMap<string, Drawn>>
  readonly clicked: (path: Path) => void
}) {
  const latest = React.useRef(clicked)
  React.useEffect(() => {
    latest.current = clicked
  })
  React.useEffect(() => {
    const element = view.current
    if (element === null) return () => null
    const nodeOfEvent = (event: MouseEvent) =>
      event.target instanceof HTMLElement && event.target.closest(ownClick) === null ? event.target.closest<HTMLElement>('[data-node]') : null
    const onClick = (event: MouseEvent) => {
      const key = nodeOfEvent(event)?.dataset['node']
      if (key !== undefined && drawn.current.has(key)) latest.current(pathOfKey(key))
    }
    const onPress = (event: MouseEvent) => {
      if (nodeOfEvent(event) !== null) event.preventDefault()
    }
    element.addEventListener('click', onClick)
    element.addEventListener('mousedown', onPress)
    return () => {
      element.removeEventListener('click', onClick)
      element.removeEventListener('mousedown', onPress)
    }
  }, [view, drawn])
}

/**
 * One object a view is handed for as long as it is drawn, which reads this
 * render's surface whenever it is asked, so a view that keeps it never acts
 * on a surface drawn before.
 */
export function useStableApi(api: SurfaceApi): SurfaceApi {
  const latest = React.useRef(api)
  React.useEffect(() => {
    latest.current = api
  })
  return React.useMemo<SurfaceApi>(() => ({
    get focus() {
      return latest.current.focus
    },
    get marks() {
      return latest.current.marks
    },
    setFocus: (path) => latest.current.setFocus(path),
    flash: (text) => latest.current.flash(text),
    clearMarks: () => latest.current.clearMarks(),
    unmark: (ids) => latest.current.unmark(ids),
    askName: (request) => latest.current.askName(request),
    choose: (request) => latest.current.choose(request),
    openSettings: () => latest.current.openSettings(),
    recall: (parent, children) => latest.current.recall(parent, children),
  }), [])
}
