import * as React from 'react'

import type { Drawn } from './motion'
import { leafOf, pathOfKey } from './path'
import type { Path, Seam, SurfaceApi } from './seam'

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

/** How long a move within a view waits for the next before the address follows it, so a held key writes history once. */
const addressMilliseconds = 150

/**
 * The focus as drawn, and how a move reaches the address. A move within a
 * view is drawn at once and written once the moves stop; it stands only while
 * it names another leaf than the address does, so a move back to where the
 * address is, or a carry that keeps the focus on its card, is the address's
 * focus at once, found where the node is now, and the address changing, as
 * the move's own write or Back does, is the focus from then on. A move to
 * another view is a history entry of its own, and a move still waiting for
 * the address is written into the entry it leaves first, so Back returns to
 * where the focus was; the history merges writes made in one tick, so the
 * new entry waits for that one.
 */
export function useAddressedFocus(seam: Seam) {
  const [pending, setPending] = React.useState<Path | null>(null)
  const timer = React.useRef(0)
  React.useEffect(() => () => window.clearTimeout(timer.current), [])
  const addressLeaf = leafOf(seam.focus)
  const [addressSeen, setAddressSeen] = React.useState(addressLeaf)
  if (addressSeen !== addressLeaf) {
    setAddressSeen(addressLeaf)
    setPending(null)
  }
  const focus = pending !== null && leafOf(pending) !== addressLeaf ? pending : seam.focus

  const write = (target: Path) => {
    const waited = timer.current !== 0
    window.clearTimeout(timer.current)
    timer.current = 0
    if (seam.viewOf(target) !== seam.viewOf(focus)) {
      const before = waited && leafOf(focus) !== addressLeaf ? seam.go(focus, { replace: true }) : Promise.resolve()
      void before.then(() => seam.go(target, { replace: false }))
      return
    }
    setPending(target)
    timer.current = window.setTimeout(() => {
      timer.current = 0
      void seam.go(target, { replace: true })
    }, addressMilliseconds)
  }

  /** Whether a move is still waiting for the address. */
  const waiting = () => timer.current !== 0

  return { focus, write, waiting }
}
