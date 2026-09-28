import type { QueryClient, QueryExecuteOptions, QueryKey } from '@tanstack/react-query'
import { linkOptions, notFound, useParams } from '@tanstack/react-router'
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
 * session and no stream. A worktree's board is gated on the daemon's
 * description, which names the boards it serves, and an epic's board and a
 * project's on the index's rows. An answer is kept as long as its read keeps
 * it: the daemon's description for the document, so the board that draws it
 * shows it rather than asking again, and the rows no longer than a page draws
 * them, since a page draws only the rows it read since it mounted. A page
 * reached without a document load can name what was taken on after the
 * answer at hand was read, so an answer that does not hold the address is
 * asked again now, by `again`, before the address is called no page. A read
 * that fails says nothing about the address, and the page draws as it would
 * without the gate.
 */
export async function noPageUnless<T, K extends QueryKey, L extends QueryKey>({ client, read, again, named }: {
  readonly client: QueryClient
  /** The read whose answer says what an address may name. */
  readonly read: QueryExecuteOptions<T, Error, T, T, K>
  /** The same question asked now, for an address the answer at hand does not hold. */
  readonly again: QueryExecuteOptions<T, Error, T, T, L>
  /** Whether that answer holds what this address names. */
  readonly named: (answer: T) => boolean
}): Promise<void> {
  let answer: T
  try {
    answer = await client.query(read)
    if (!named(answer)) answer = await client.query(again)
  } catch {
    return
  }
  if (!named(answer)) throw notFound()
}

/**
 * What every address carries after its path: the focus, as the id of the node
 * it is on, and on an item's page the board it was opened from, an epic's or
 * a project's, when it was not its worktree's own. Each is decoded where the
 * address is read, and one that does not decode is left out, as if the
 * address had not carried it.
 */
const AddressSearchSchema = Schema.Struct({
  focus: Schema.optional(Schema.String),
  via: Schema.optional(Schema.Literals(['epic', 'project'])),
})

const decodeFocus = Schema.decodeUnknownOption(AddressSearchSchema.fields.focus)
const decodeVia = Schema.decodeUnknownOption(AddressSearchSchema.fields.via)

/** An address's search as the router reads it, each field decoded or left out. */
export const addressSearch = (raw: Readonly<Record<string, unknown>>): typeof AddressSearchSchema.Type => ({
  focus: Option.getOrUndefined(decodeFocus(raw['focus'])),
  via: Option.getOrUndefined(decodeVia(raw['via'])),
})

/** A board's prefix, from its worktree's name: the key the daemon routes it by, under `/w/`. */
export const boardPath = (name: string) => `/w/${encodeWorktreeKey(name)}`

/**
 * The board a part of a page belongs to, where one page draws the worktrees
 * of more than one board: an epic's or a project's board, and their ledger.
 * Everything addressed under a worktree's board by its prefix, a Markdown link
 * among them, reads its board here first.
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

/**
 * The name of the worktree whose board the open page is under, as the address
 * carries it, for what is drawn only on a board's pages; the router refuses
 * the call anywhere else, so a part of an epic's or a project's board is
 * given its worktree's name instead.
 */
export const useBoardName = () => useParams({ from: '/w/$key' }).key

/**
 * The board's pages as the router's destinations, so a link and a key that
 * opens a page go the same way: to the route, with the worktree's name, the
 * epic's or the project's path, and the item or path as its parameters, which
 * the route's schema encodes and the router writes into the address the
 * daemon serves, one segment each, the file path's slashes kept.
 * Following one moves within the document, as every move between the board's
 * pages does. A link to one is the current page's only when it goes to the
 * page that is open, never to the page it sits under.
 */
const exact = { exact: true } as const

/** Every worktree the daemon tracks, at the root. */
export const toIndex = linkOptions({ to: '/', activeOptions: exact })

/** A path under the session as a URL path, encoded as the address carries it: every segment encoded, the slashes kept. */
const encodedPath = Schema.encodeSync(AddressPathSchema)

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
