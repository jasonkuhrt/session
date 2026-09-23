/**
 * The daemon serves the index at `/`, each board at `/w/<key>/`, and the
 * board's pages under it: one item at `item/<ID>`, the session's ledger,
 * context and archive at `ledger`, `context` and `archive`, and one file of
 * the session at `file/<path>`. The key is a worktree name and may hold more
 * than one segment. One bundle serves all of them, so requests, Markdown links
 * and the event stream hang off the board's prefix whichever page is open.
 */
const pathname = window.location.pathname

/** The three listings a board serves beside its lanes, by the name of their page. */
export type Listing = 'ledger' | 'context' | 'archive'

/** Which page of a board is open. */
export type BoardPage =
  | { readonly kind: 'board' }
  | { readonly kind: 'item'; readonly id: string }
  | { readonly kind: Listing }
  | { readonly kind: 'file'; readonly path: string }

/**
 * The board prefix and the page under it. The key is taken as everything
 * before the first segment that names a page, which is what the daemon's own
 * longest-key match resolves in every real name. A listing's page has no
 * trailing slash, because a board always has one: the daemon sends `/w/<key>`
 * on to `/w/<key>/`, so `/w/<key>/ledger/` can only be the board of a
 * worktree whose name ends in a segment called `ledger`.
 */
const route = /^(\/w\/.+?)\/(?:item\/([^/]+)\/*|(ledger|context|archive)|file\/(.+))$/u.exec(pathname)

/** A path segment as it was written, or as it came when it does not decode, which the daemon then refuses. */
const decoded = (text: string) => {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

export const basePath = route === null
  ? (pathname.startsWith('/w/') ? pathname.replace(/\/+$/u, '') : '')
  : route[1]!

const pageOf = (match: RegExpExecArray): BoardPage => {
  const [, , id, listing, path] = match
  if (id !== undefined) return { kind: 'item', id: decoded(id) }
  if (listing === 'ledger' || listing === 'context' || listing === 'archive') return { kind: listing }
  return { kind: 'file', path: decoded(path ?? '') }
}

/** The page of this board that is open, or null on the index of every board. */
export const page: BoardPage | null = basePath === '' ? null : route === null ? { kind: 'board' } : pageOf(route)

/** A path under the session as a URL path: every segment encoded, the slashes kept. */
const encodedPath = (path: string) => path.split('/').map((segment) => encodeURIComponent(segment)).join('/')

/** The page for one item of this board. The one place the route is spelled. */
export const itemHref = (id: string) => `${basePath}/item/${encodeURIComponent(id)}`

/** The page of one of this board's listings. */
export const listingHref = (listing: Listing) => `${basePath}/${listing}`

/** The page that renders one Markdown file of this session, by its path under the session. */
export const filePageHref = (path: string) => `${basePath}/file/${encodedPath(path)}`

/** One file of this session as it is on disk, served by the board's files route. */
export const rawFileHref = (path: string) => `${basePath}/files/${encodedPath(path)}`

/**
 * An address on this page as the absolute URL a tab is named for, or null when
 * the URL parser rejects it, as it rejects `http://localhost:PORT/` written in
 * prose. Such a link is still drawn, as the browser draws it; it only has no
 * tab to be opened once in. Resolving it never throws, because it runs while
 * a page renders and a throw there blanks the page.
 */
export const absoluteHref = (href: string): string | null =>
  URL.canParse(href, window.location.href) ? new URL(href, window.location.href).href : null

/** Whether a file is one the file page renders: the files route serves `.md`, in any case, as Markdown. */
export const isMarkdownPath = (path: string) => /\.md$/iu.test(path)
