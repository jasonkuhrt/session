import { type QueryClient, type QueryKey, queryOptions } from '@tanstack/react-query'

import { DaemonApi, IndexApi, readPlace, SessionApi } from './api'

/**
 * Every read a page makes, as TanStack Query holds it: one query per source,
 * keyed by the board's prefix where the source is a board's, so each is read
 * on its own and read again only when its own answer changed. A query is read
 * when its page mounts it and again when the page's stream says its answer
 * changed; nothing is read on focus, on reconnect or on a timer. The item and
 * file pages compose their reads where they draw them, under the keys
 * `[board, 'item', id]` and `[board, 'file', path]`.
 */
export const reads = {
  /** Every tracked worktree: the index's rows, and the boards a board's picker can switch to. */
  worktrees: () => queryOptions({ queryKey: ['worktrees'], queryFn: ({ signal }) => IndexApi.read(signal) }),

  /** gh's last report for each row's branch, as the daemon holds it. */
  pullRequests: () =>
    queryOptions({ queryKey: ['pull-requests'], queryFn: ({ signal }) => IndexApi.pullRequests(signal) }),

  /** What the daemon can do for a page: a terminal through cmux, and Zed. */
  capabilities: () =>
    queryOptions({ queryKey: ['daemon'], queryFn: ({ signal }) => DaemonApi.capabilities(signal) }),

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
