import * as React from 'react'

import type { Drawn } from './motion'
import { leafOf, pathOfKey } from './path'
import type { Path, Seam, SurfaceApi } from './seam'

/**
 * What a click on a view leaves to the element it landed in: a link, a button,
 * a field. A node's own link is not one of them, since its click is the
 * node's: the link a node is drawn as, or is drawn around what it draws, and
 * the same link a view draws again beside it, each marked `data-node-link`.
 * Neither is a word with its tip behind it, which Tips draws as a button and
 * which is still a word, as it is to a drag. Any other link is a control of
 * its own, so a click on it takes no focus and runs no Enter.
 */
const ownClick = 'a[href]:not([data-node-link]), button:not([data-explained]), input, summary'

/** The node an event landed in, unless it landed in a control of its own. */
const nodeOfEvent = (event: MouseEvent) =>
  event.target instanceof Element && event.target.closest(ownClick) === null ? event.target.closest<HTMLElement>('[data-node]') : null

/**
 * Whether a click is the browser's rather than the view's: one with ⌘, Ctrl,
 * Alt or Shift held, or with any button but the first, which on a link opens
 * its address in a tab or a window of its own, as TanStack Router's `Link`
 * leaves it.
 */
export const browserClick = (event: MouseEvent | React.MouseEvent) =>
  event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey

/**
 * The gesture a drag ends in, which is the drag's: its release, made while a
 * drag holds the view, is marked before the drag library takes it, and the
 * next press lets the mark go, for a browser that makes no click of it.
 */
function useDragEnd(held: boolean) {
  const holding = React.useRef(held)
  const ended = React.useRef(false)
  React.useEffect(() => {
    holding.current = held
  })
  React.useEffect(() => {
    const onRelease = () => {
      ended.current = holding.current
    }
    const onGesture = () => {
      ended.current = false
    }
    window.addEventListener('pointerup', onRelease, true)
    window.addEventListener('pointerdown', onGesture, true)
    return () => {
      window.removeEventListener('pointerup', onRelease, true)
      window.removeEventListener('pointerdown', onGesture, true)
    }
  }, [])
  return ended
}

/**
 * The view's clicks, heard once, on the view, and handed to the node they
 * landed in, with what the node is; a click on a link or a button inside a
 * node is its own, and a click the browser answers is left to it. A node
 * drawn as a link leaves its address to the browser that way and nothing
 * else: a plain click on its link is the view's, so the link does not follow
 * itself. A press on a node leaves the browser's focus where it is, so the
 * keys that follow still reach the registry rather than the node. A click a
 * browser makes of the release that ends a drag runs nothing, and follows no
 * link, and neither does one made of a press on a control of its own that
 * slid off it and was released elsewhere in the node, which the browser aims
 * at the node around both: the press was the control's, not the node's.
 */
export function useViewClicks({ view, drawn, held, clicked }: {
  readonly view: React.RefObject<HTMLElement | null>
  readonly drawn: React.RefObject<ReadonlyMap<string, Drawn>>
  /** Whether a drag holds the view. */
  readonly held: boolean
  readonly clicked: (path: Path, node: Drawn) => void
}) {
  const latest = React.useRef(clicked)
  React.useEffect(() => {
    latest.current = clicked
  })
  const dragEnded = useDragEnd(held)
  /** The control of its own the last press landed in, until the click that follows it, if any, is heard. */
  const pressed = React.useRef<Element | null>(null)
  React.useEffect(() => {
    const element = view.current
    if (element === null) return () => null
    const onClick = (event: MouseEvent) => {
      const control = pressed.current
      pressed.current = null
      // Nothing follows it, a link it lands on included.
      if (dragEnded.current) {
        dragEnded.current = false
        event.preventDefault()
        return
      }
      if (browserClick(event)) return
      // A press on a control of its own is the control's, wherever it is released.
      if (control !== null && !(event.target instanceof Node && control.contains(event.target))) return
      const landed = nodeOfEvent(event)
      const key = landed?.dataset['node']
      const node = key === undefined ? undefined : drawn.current.get(key)
      if (landed === null || key === undefined || node === undefined) return
      // A node's own link would follow itself; its click is the view's.
      const link = event.target instanceof Element ? event.target.closest('a[data-node-link]') : null
      if (link !== null && landed.contains(link)) event.preventDefault()
      latest.current(pathOfKey(key), node)
    }
    const onPress = (event: MouseEvent) => {
      pressed.current = event.target instanceof Element ? event.target.closest(ownClick) : null
      if (nodeOfEvent(event) !== null) event.preventDefault()
    }
    element.addEventListener('click', onClick)
    element.addEventListener('mousedown', onPress)
    return () => {
      element.removeEventListener('click', onClick)
      element.removeEventListener('mousedown', onPress)
    }
  }, [view, drawn, dragEnded, pressed])
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
    relocate: (path) => latest.current.relocate(path),
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
 * address is, or a carry that keeps the focus on what it carries, is the
 * address's focus at once, found where the node is now, and the address
 * changing, as the move's own write or Back does, is the focus from then on.
 * A move to another view is a history entry of its own, and a move still
 * waiting for the address is written into the entry it leaves first, so Back
 * returns to where the focus was; the history merges writes made in one tick,
 * so the new entry waits for that one.
 */
export function useAddressedFocus(seam: Seam) {
  const [pending, setPending] = React.useState<Path | null>(null)
  const timer = React.useRef(0)
  /** The move the timer is to write into the address, until it does. */
  const waitingFor = React.useRef<Path | null>(null)
  React.useEffect(() => () => window.clearTimeout(timer.current), [])
  const addressLeaf = leafOf(seam.focus)
  const [addressSeen, setAddressSeen] = React.useState(addressLeaf)
  if (addressSeen !== addressLeaf) {
    setAddressSeen(addressLeaf)
    setPending(null)
  }
  const focus = pending !== null && leafOf(pending) !== addressLeaf ? pending : seam.focus

  /**
   * Writes a move, settling once the address holds it when it changes the
   * view; `replace` puts another view in place of this entry. The move still
   * waiting is read from where it waits rather than from what was drawn, so a
   * move and another view in one tick, as a click that focuses a node and
   * opens its page, leaves the node in the entry it leaves.
   */
  const write = (target: Path, { replace }: { readonly replace: boolean }): Promise<void> => {
    const waited = waitingFor.current
    window.clearTimeout(timer.current)
    timer.current = 0
    waitingFor.current = null
    if (seam.viewOf(target) !== seam.viewOf(focus)) {
      if (replace) return seam.go(target, { replace: true })
      const before = waited !== null && leafOf(waited) !== addressLeaf ? seam.go(waited, { replace: true }) : Promise.resolve()
      return before.then(() => seam.go(target, { replace: false }))
    }
    setPending(target)
    waitingFor.current = target
    timer.current = window.setTimeout(() => {
      timer.current = 0
      waitingFor.current = null
      void seam.go(target, { replace: true })
    }, addressMilliseconds)
    return Promise.resolve()
  }

  /** Whether a move is still waiting for the address. */
  const waiting = () => waitingFor.current !== null

  return { focus, write, waiting }
}
