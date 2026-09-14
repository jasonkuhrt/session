/**
 * The daemon serves the index at `/`, each board at `/w/<key>/`, and one item
 * at `/w/<key>/item/<ID>`, where the key is a worktree name and may hold more
 * than one segment. One bundle serves all three, so requests, Markdown links
 * and the event stream hang off the board's prefix whichever page is open.
 */
const pathname = window.location.pathname

/**
 * The board prefix and the item under it. The key is taken as everything
 * before the first `/item/`, which is what the daemon's own longest-key match
 * resolves in every real name; a worktree whose name contains a segment called
 * `item` would need the server to say so, and it would answer 404 rather than
 * the wrong board.
 */
const route = /^(\/w\/.+?)\/item\/([^/]+)\/*$/u.exec(pathname)

export const basePath = route === null
  ? (pathname.startsWith('/w/') ? pathname.replace(/\/+$/u, '') : '')
  : route[1]!

export const isBoard = basePath !== ''

/** The item this page is opened on, or null for the board itself. */
export const itemId = route === null ? null : decodeURIComponent(route[2]!)

/** The page for one item of this board. The one place the route is spelled. */
export const itemHref = (id: string) => `${basePath}/item/${encodeURIComponent(id)}`
