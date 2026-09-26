import { useParams } from '@tanstack/react-router'

import { encodeWorktreeKey } from '../../contract'

/**
 * The daemon serves the index at `/`, each board at `/w/<key>/`, and the
 * board's pages under it: one item at `item/<ID>`, the session's ledger,
 * context and archive at `ledger`, `context` and `archive`, and one file of
 * the session at `file/<path>`. The key is a worktree's name, encoded segment
 * by segment, and may hold more than one segment. A board's requests, its
 * Markdown links and its event stream hang off its prefix whichever of its
 * pages is open.
 */

/** The three listings a board serves beside its lanes, by the name of their page. */
export type Listing = 'ledger' | 'context' | 'archive'

/**
 * A board's address and the page under it. The key is everything before the
 * first segment that names a page, which is what the daemon's own longest-key
 * match resolves in every real name. A listing's page has no trailing slash,
 * because a board always has one: the daemon sends `/w/<key>` on to
 * `/w/<key>/`, so `/w/<key>/ledger/` can only be the board of a worktree whose
 * name ends in a segment called `ledger`.
 */
const boardPage = /^\/w\/(.+?)\/(item\/[^/]+\/*|ledger|context|archive|file\/.+)$/u

/**
 * The address the browser shows, as the router matches it: a board's key
 * folded into one segment, each slash in it written `%2F`, because a route's
 * parameter is one segment. The router decodes the parameter to the
 * worktree's name. Any other address is matched as it is.
 */
export const foldBoardKey = (pathname: string): string => {
  if (!pathname.startsWith('/w/')) return pathname
  const page = boardPage.exec(pathname)
  if (page !== null) return `/w/${page[1]!.replaceAll('/', '%2F')}/${page[2]!}`
  const key = pathname.slice('/w/'.length).replace(/\/+$/u, '')
  return key === '' ? pathname : `/w/${key.replaceAll('/', '%2F')}/`
}

/** The address the router writes, as the browser shows it: the key's slashes unfolded again. */
export const unfoldBoardKey = (pathname: string): string =>
  pathname.replace(/^\/w\/([^/]+)/u, (_, key: string) => `/w/${key.replaceAll('%2F', '/')}`)

/** A board's prefix, from its worktree's name: the key the daemon routes it by, under `/w/`. */
export const boardPath = (name: string) => `/w/${encodeWorktreeKey(name)}`

/**
 * The prefix of the board whose page is open, from the worktree's name the
 * address carries, or nothing on the index, which belongs to no board.
 */
export function useBoardPath() {
  const { key } = useParams({ strict: false })
  return key === undefined ? '' : boardPath(key)
}

/** A path under the session as a URL path: every segment encoded, the slashes kept. */
const encodedPath = (path: string) => path.split('/').map((segment) => encodeURIComponent(segment)).join('/')

/** The page for one item of a board. The one place the route is spelled. */
export const itemHref = ({ board, id }: { readonly board: string; readonly id: string }) =>
  `${board}/item/${encodeURIComponent(id)}`

/** The page of one of a board's listings. */
export const listingHref = ({ board, listing }: { readonly board: string; readonly listing: Listing }) =>
  `${board}/${listing}`

/** The page that renders one Markdown file of a board's session, by its path under the session. */
export const filePageHref = ({ board, path }: { readonly board: string; readonly path: string }) =>
  `${board}/file/${encodedPath(path)}`

/** One file of a board's session as it is on disk, served by the board's files route. */
export const rawFileHref = ({ board, path }: { readonly board: string; readonly path: string }) =>
  `${board}/files/${encodedPath(path)}`

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
