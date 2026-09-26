import { type QueryKey, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query'

import { reread } from './reads'
import { useStream } from './stream'

/** What a page last read, and why its latest read failed. */
export type Followed<A> = {
  /** Null until the first read lands. */
  readonly value: A | null
  /** Why the latest read failed; what was read before it stays on screen. */
  readonly error: string | null
}

/**
 * One read of a page under a board, kept current with the files: made when
 * the page opens, again on every `changed` the daemon pushes for a write under
 * the worktree's `.session`, and again when a dropped stream comes back,
 * because writes land while it is down. Only the latest read lands, so a slow
 * answer never replaces a newer one, and a failed read keeps what the page
 * last showed and says why. The page never polls, and its stream carries
 * nothing but `changed`, so it keeps nothing else asking.
 */
export function useFollowed<A, K extends QueryKey>({ board, read }: {
  /** The board's prefix, whose stream says when to read again. */
  readonly board: string
  readonly read: UseQueryOptions<A, Error, A, K>
}): Followed<A> {
  const client = useQueryClient()
  const { data, error } = useQuery(read)
  useStream({ board, on: { changed: () => reread({ client, queryKey: read.queryKey }) } })
  return {
    value: data ?? null,
    error: error === null ? null : reasonOf(error),
  }
}

/** Why a read failed, in the daemon's words when it gave some. */
const reasonOf = (error: unknown) => (error instanceof Error ? error.message : 'The session could not be read')
