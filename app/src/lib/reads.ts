import { type QueryClient, type QueryKey, queryOptions } from '@tanstack/react-query'

import { DaemonApi, IndexApi, readPlace, SessionApi } from './api'

/**
 * Every read a page makes, as TanStack Query holds it: one query per source,
 * keyed by the board's prefix where the source is a board's, so each is read
 * on its own. A query is read when its page mounts it and, where its answer
 * can change, again on the stream's event that names it. The rows a
 * worktree's board reads, for where its worktree stands, are read once, since
 * its stream does not say they changed, and what the daemon says about
 * itself when a page mounts and when a stream comes back. Nothing is read on
 * focus, when the browser comes back online or on a timer. The item and file
 * pages compose their reads where they draw them, under the keys
 * `[board, 'item', id]` and `[board, 'file', path]`. Every answer is
 * kept for as long as the document lives, whichever page drew it last: a
 * page that mounts again draws the last answer of each of its reads while the
 * read it makes as it mounts is under way, and that read lands over it, so
 * only a read the document never made has nothing to draw, which is when a
 * page draws its skeleton.
 */
export const reads = {
  /**
   * Every tracked worktree: the index's rows, the rows a worktree's board and
   * its pages read for where the worktree stands, and the worktrees an epic's
   * board and a project's draw.
   */
  worktrees: () => queryOptions({ queryKey: ['worktrees'], queryFn: ({ signal }) => IndexApi.read(signal) }),

  /**
   * Every tracked worktree as the daemon lists them now, for what the rows at
   * hand can be too old to say: whether an epic or a project is in them, which
   * a page reached without a document load can name, as the index names an
   * epic a moment after a drag made it. Its answer lands where the rows' does,
   * since nothing asks the rows to stay as they were.
   */
  worktreesNow: () =>
    queryOptions({ queryKey: ['worktrees'], queryFn: ({ signal }) => IndexApi.read(signal), staleTime: 0 }),

  /** gh's last report for each row's branch, as the daemon holds it. */
  pullRequests: () =>
    queryOptions({ queryKey: ['pull-requests'], queryFn: ({ signal }) => IndexApi.pullRequests(signal) }),

  /**
   * What the daemon says about itself: what it can do for a page, a terminal
   * through cmux and Zed, and the sources it was started from, which name the
   * build the page was loaded from. The first page with a stream reads it
   * when it mounts, and every page with one reads it again when its stream
   * comes back, when a daemon started from other sources reloads the page and
   * one started from the same sources replaces what it can do. A page that
   * mounts after the first does not read it again, unlike every other read,
   * since the build stays the one the document loaded and a read on mount
   * would put the running daemon's stamp where the loaded build's is: the
   * page's stream asks the daemon when it first opens instead.
   */
  daemon: () =>
    queryOptions({
      queryKey: ['daemon'],
      queryFn: ({ signal }) => DaemonApi.describe(signal),
      refetchOnMount: false,
    }),

  /**
   * What the daemon says about itself now, for what the description the
   * document keeps can be too old to say: whether it serves a board taken on
   * after the document loaded, which a page reached without a document load
   * can name. Kept apart from `daemon`, whose stamp stays the loaded build's.
   */
  daemonNow: () =>
    queryOptions({
      queryKey: ['daemon', 'now'],
      queryFn: ({ signal }) => DaemonApi.describe(signal),
      staleTime: 0,
    }),

  /** A board's session: its stages and their items, with the revision a write is made against. */
  session: (board: string) =>
    queryOptions({ queryKey: [board, 'session'], queryFn: ({ signal }) => SessionApi.read(board, signal) }),

  /** The agents overlay of a board's worktree. */
  agents: (board: string) =>
    queryOptions({ queryKey: [board, 'agents'], queryFn: ({ signal }) => SessionApi.agents(board, signal) }),

  /** The `Session-Done` trailers on a board's unpushed commits that could not be acted on. */
  trailers: (board: string) =>
    queryOptions({ queryKey: [board, 'trailers'], queryFn: ({ signal }) => SessionApi.trailers(board, signal) }),

  /** A board's pull request and Linear issues, as gh and linear last answered. */
  links: (board: string) =>
    queryOptions({ queryKey: [board, 'links'], queryFn: ({ signal }) => SessionApi.links(board, signal) }),

  /** The ledger, read with where the page stands, so the two never disagree. */
  ledger: (board: string) =>
    queryOptions({
      queryKey: [board, 'ledger'],
      queryFn: ({ signal }) => Promise.all([readPlace({ board, signal }), SessionApi.ledger(board, signal)]),
    }),

  /** `context/`, read with where the page stands, for its name and root. */
  context: (board: string) =>
    queryOptions({
      queryKey: [board, 'context'],
      queryFn: ({ signal }) => Promise.all([readPlace({ board, signal }), SessionApi.context(board, signal)]),
    }),

  /** The archive's records, read with where the page stands. */
  archive: (board: string) =>
    queryOptions({
      queryKey: [board, 'archive'],
      queryFn: ({ signal }) => Promise.all([readPlace({ board, signal }), SessionApi.archive(board, signal)]),
    }),
}

/**
 * Read a query again now. A read of it still in flight is dropped first, so
 * only the newest read lands and a failed one keeps the last answer on screen.
 * Invalidating would not do: while a query's first read is in flight a push
 * folds into that read instead of starting another, and the change it
 * announced could be missed.
 */
export const reread = ({ client, queryKey }: { readonly client: QueryClient; readonly queryKey: QueryKey }) =>
  client
    .cancelQueries({ queryKey, exact: true })
    .then(() => client.refetchQueries({ queryKey, exact: true }))

/**
 * Show what a write answered with, as the page draws it. A read in flight
 * began before the write answered, so it is dropped rather than let land over
 * the answer; a read that has begun since is newer than the answer, and it
 * lands instead of it.
 */
export async function landWrite<A>({ client, queryKey, answer }: {
  readonly client: QueryClient
  readonly queryKey: QueryKey
  /** The value to show, made from what the write answered. */
  readonly answer: () => A | Promise<A>
}) {
  await client.cancelQueries({ queryKey, exact: true })
  const before = client.getQueryState(queryKey)?.dataUpdateCount ?? 0
  const landed = await answer()
  const since = client.getQueryState(queryKey)?.dataUpdateCount ?? 0
  if (since === before && client.isFetching({ queryKey, exact: true }) === 0) client.setQueryData(queryKey, landed)
}
