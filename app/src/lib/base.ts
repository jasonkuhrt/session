import type { QueryClient, QueryExecuteOptions, QueryKey } from '@tanstack/react-query'
import { notFound, useParams } from '@tanstack/react-router'
import { Option, Schema } from 'effect'
import * as React from 'react'

import { AddressPathSchema, encodeWorktreeKey } from '../../contract'

/**
 * The daemon serves the index at `/` and a board for each filter: a
 * worktree's at `/w/<key>/`, an epic's at `/e/<name>/` and a project's at
 * `/p/<path>/`. A worktree's board has its pages under it: one item at
 * `item/<ID>`, the session's ledger, context and archive at `ledger`,
 * `context` and `archive`, and one file of the session at `file/<path>`. An
 * epic's board and a project's have one page under them, the ledger of every
 * worktree in view. A worktree's key is its name and a project's its path,
 * each encoded segment by segment, so either may hold more than one segment;
 * an epic's name holds no slash. A worktree board's requests, its Markdown
 * links and its event stream hang off its prefix whichever of its pages is
 * open, and a part of a page that belongs to one worktree's board names its
 * board through `BoardScope`.
 */

/** The three listings a board serves beside its lanes, by the name of their page. */
export type Listing = 'ledger' | 'context' | 'archive'

/**
 * The pages under a board whose key may hold a slash, after the key: a
 * worktree's item, listings and file, and a project's ledger. The key is
 * everything before the first segment that names a page, which is what the
 * daemon's own longest-key match resolves in every real name. A listing's page
 * has no trailing slash, because a board always has one: the daemon sends
 * `/w/<key>` on to `/w/<key>/`, so `/w/<key>/ledger/` can only be the board of
 * a worktree whose name ends in a segment called `ledger`, and
 * `/p/<path>/ledger/` the board of a project whose folder is called `ledger`.
 */
const keyedPages = {
  w: /^\/w\/(.+?)\/(item\/[^/]+\/*|ledger|context|archive|file\/.+)$/u,
  p: /^\/p\/(.+?)\/(ledger)$/u,
} as const

/** Which board an address is under, when its key may hold a slash: a worktree's, `w`, or a project's, `p`. */
const keyedBoard = /^\/([pw])\//u

/**
 * The address the browser shows, as the router matches it: a worktree's or a
 * project's key folded into one segment, each slash in it written `%2F`,
 * because a route's parameter is one segment. The router decodes the
 * parameter to the name or the path. Any other address is matched as it is.
 */
export const foldKey = (pathname: string): string => {
  const board = keyedBoard.exec(pathname)?.[1]
  if (board !== 'w' && board !== 'p') return pathname
  const page = keyedPages[board].exec(pathname)
  if (page !== null) return `/${board}/${page[1]!.replaceAll('/', '%2F')}/${page[2]!}`
  const key = pathname.slice(`/${board}/`.length).replace(/\/+$/u, '')
  return key === '' ? pathname : `/${board}/${key.replaceAll('/', '%2F')}/`
}

/** The address the router writes, as the browser shows it: the key's slashes unfolded again. */
export const unfoldKey = (pathname: string): string =>
  pathname.replace(/^\/([pw])\/([^/]+)/u, (_, board: string, key: string) => `/${board}/${key.replaceAll('%2F', '/')}`)

/**
 * A route's params as its schema decodes them, or false when they are not the
 * schema's. The address is a boundary, so every page's params pass through a
 * schema, and a decode that fails answers false, which the router takes for no
 * route here: the address draws the root's not-found page, as one no route
 * matches does, never an error.
 */
export const paramsOf = <S extends Schema.ConstraintDecoder<unknown>>(schema: S) => {
  const decode = Schema.decodeUnknownOption(schema)
  return (raw: unknown): S['Type'] | false => Option.getOrElse(decode(raw), () => false as const)
}

/**
 * The other half of an address that is no page: one whose params decode but
 * name nothing there is. The read that says what an address may name is made
 * before the page mounts, and when its answer does not hold what this address
 * names, the root draws the not-found page and the page reads nothing, no
 * session and no stream. A board is gated on the daemon's description, which
 * names the boards it serves; a page drawn from the index's rows would be
 * gated on those. The answer is kept for the document, so the page that draws
 * the same read shows it rather than asking again. A read that fails says
 * nothing about the address, and the page draws as it would without the gate.
 */
export async function noPageUnless<T, K extends QueryKey>({ client, read, named }: {
  readonly client: QueryClient
  /** The read whose answer says what an address may name. */
  readonly read: QueryExecuteOptions<T, Error, T, T, K>
  /** Whether that answer holds what this address names. */
  readonly named: (answer: T) => boolean
}): Promise<void> {
  let answer: T
  try {
    answer = await client.query({ ...read, gcTime: Number.POSITIVE_INFINITY })
  } catch {
    return
  }
  if (!named(answer)) throw notFound()
}

/** A board's prefix, from its worktree's name: the key the daemon routes it by, under `/w/`. */
export const boardPath = (name: string) => `/w/${encodeWorktreeKey(name)}`

/** An epic's name or an item's id as the address carries it: one URI component. */
const encodedComponent = Schema.encodeSync(Schema.StringFromUriComponent)

/** An epic's board's prefix, from its name. */
export const epicPath = (name: string) => `/e/${encodedComponent(name)}`

/**
 * A project's board's prefix, from its path: the path under `/p`, encoded
 * segment by segment as a worktree's key is, its leading slash the one after
 * `/p`.
 */
export const projectPath = (path: string) => `/p${encodeWorktreeKey(path)}`

/**
 * The board a part of a page belongs to, where one page draws the worktrees
 * of more than one board: an epic's or a project's board, and their ledger.
 * Everything addressed under a worktree's board, a card's link and a Markdown
 * link among them, reads its board here first.
 */
export const BoardScope = React.createContext<string | null>(null)

/**
 * The prefix of the worktree board a part of the page belongs to: its
 * `BoardScope`, or else the board the address is under; nothing on the index
 * and on an epic's or a project's page outside such a part, which belong to
 * no one worktree's board.
 */
export function useBoardPath() {
  const scoped = React.useContext(BoardScope)
  const params = useParams({ from: '/w/$key', shouldThrow: false })
  return scoped ?? (params === undefined ? '' : boardPath(params.key))
}

/** A path under the session as a URL path, encoded as the address carries it: every segment encoded, the slashes kept. */
const encodedPath = Schema.encodeSync(AddressPathSchema)

/** The page for one item of a board. The one place the route is spelled. */
export const itemHref = ({ board, id }: { readonly board: string; readonly id: string }) =>
  `${board}/item/${encodedComponent(id)}`

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
