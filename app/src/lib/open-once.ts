import type * as React from 'react'

/**
 * Everything the board opens outside itself is opened once. A page on the web
 * opens in a tab of its own, named for its address, and asking for it again
 * brings that tab forward as it is, without reloading it, instead of opening
 * another. An address an app answers, such as `codex://`, is handed to that
 * app, which is where the one copy of it lives, and no tab is opened for it.
 * A reader who wants another copy asks the way browsers already offer: a
 * middle click, or a click with a modifier, which is left to the browser.
 */

/** One browsing target per address, so two links to one page share its tab. */
const targetFor = (url: string) => `session:${url}`

const isWeb = (url: string) => url.startsWith('https://') || url.startsWith('http://')

/**
 * Whether a target is the blank one `window.open` has just made. One opened
 * before is on the destination's origin by now, where reading its address
 * throws.
 */
const isBlank = (target: Window) => {
  try {
    return target.location.href === 'about:blank'
  } catch {
    return false
  }
}

/**
 * Open `url` once. A tab this page opened for it before is found by its name
 * and focused; only when there is none does a blank one open, and only a blank
 * one is sent to the address. It answers false when the browser refused to
 * open anything, so the link can fall back to what it does by itself.
 */
export const openOnce = (url: string): boolean => {
  if (!isWeb(url)) {
    window.location.assign(url)
    return true
  }
  const target = window.open('', targetFor(url))
  if (target === null) return false
  // The opener is kept on purpose. Chrome moves a tab that has no opener into
  // a browsing context group of its own when it navigates to another site, and
  // a name there can never be found again, which would open a second tab on
  // every click. The cost is that the opened page can reach back to this tab.
  if (isBlank(target)) target.location.replace(url)
  target.focus()
  return true
}

/**
 * The click handler of every link that leaves the board. A plain click opens
 * once; any other button or a modifier is the reader asking for a copy of
 * their own, and the link's own `href` answers it.
 */
export const openOnceOnClick = (url: string) => (event: React.MouseEvent<HTMLElement>) => {
  if (event.defaultPrevented || event.button !== 0) return
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  if (openOnce(url)) event.preventDefault()
}
