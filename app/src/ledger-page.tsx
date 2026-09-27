import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import * as React from 'react'

import type { LedgerEntry, WorktreeSummary } from '../contract'
import { BoardPageFrame, ListingEmpty, ListingNotices, PageLoading } from './components/board-page'
import { Markdown } from './components/markdown'
import { NoPage } from './components/no-page'
import { useTip } from './components/tip'
import { Card, CardContent } from './components/ui/card'
import { WorktreeMark } from './components/worktree-marks'
import { problemOf, worktreeOf } from './lib/api'
import { BoardScope, useBoardPath } from './lib/base'
import { useNow } from './lib/clock'
import type { UnionFilter } from './lib/filter'
import { boardOf, filterPath, unionOf } from './lib/filter'
import { useFollowed } from './lib/follow'
import { absoluteTime, relativeTime } from './lib/format'
import { listingMeta, unionLedgerMeaning } from './lib/listings'
import { reads, reread } from './lib/reads'
import { useStream } from './lib/stream'

/** What each key of an entry says, beside its value. */
const keyMeaning = {
  by: 'Who wrote the entry: a Claude Code session, a Codex thread, or a person.',
  branch: 'The Git branch checked out when the entry was written.',
  commit: 'The commit checked out when the entry was written.',
  batch: 'The batch Execute was running when the entry was written.',
} as const

/**
 * An entry's keys beyond its date and title, as the entry has them: `by`
 * always, and each of the others only when the entry names one.
 */
const keysOf = (entry: LedgerEntry) =>
  (['by', 'branch', 'commit', 'batch'] as const).flatMap((key) => {
    const value = entry[key]
    return value === null ? [] : [{ key, value, meaning: keyMeaning[key] }]
  })

/**
 * The session's ledger, newest first. Every entry is a card, read where it
 * stands: nothing here is unread, and nothing asks to be dismissed. A file in
 * `ledger/` that breaks the ledger's rules is not an entry, and the line above
 * the cards names it.
 */
export function LedgerPage() {
  const now = useNow()
  const board = useBoardPath()
  // Where the page stands and the ledger's entries are read together, so the two never disagree.
  const { value, error } = useFollowed({ board, read: reads.ledger(board) })
  const [place, ledger] = value ?? [null, null]
  return (
    <BoardPageFrame
      title={listingMeta.ledger.label}
      boardName={worktreeOf(place)}
      boardMeaning="The board of the session this ledger belongs to."
      crumbs={[{ label: listingMeta.ledger.label, meaning: listingMeta.ledger.meaning }]}
      problem={error ?? problemOf(place)}
    >
      {ledger === null ? (error === null ? <PageLoading /> : null) : (
        <>
          <ListingNotices notices={ledger.notices} />
          {ledger.entries.length === 0
            ? <ListingEmpty>No entries.</ListingEmpty>
            : (
              <ol className="space-y-4">
                {ledger.entries.map((entry) => (
                  <li key={entry.path}>
                    <EntryCard entry={entry} now={now} />
                  </li>
                ))}
              </ol>
            )}
        </>
      )}
    </BoardPageFrame>
  )
}

const messageOf = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback)

/** One entry of a merged ledger, with the worktree whose ledger it is in. */
type Merged = { readonly row: WorktreeSummary; readonly entry: LedgerEntry }

/**
 * Newest first by date, then by name, as each ledger is ordered, and entries
 * that share both stand in the order the worktrees do.
 */
const newestFirst = (left: Merged, right: Merged) => {
  if (left.entry.date !== right.entry.date) return left.entry.date < right.entry.date ? 1 : -1
  if (left.entry.name === right.entry.name) return 0
  return left.entry.name < right.entry.name ? -1 : 1
}

/**
 * The ledger of an epic's board or a project's: the entries of every
 * worktree in view, merged newest first, each dated and named for the
 * worktree it was written in, whose board its name opens, and each read as
 * that worktree's own ledger page reads it, its Markdown links resolved in its
 * own session. A file one of them left out is named above the cards with its
 * worktree's name. It follows the root's one stream, as the board does:
 * `changed` there is every tracked session's, on which it reads every ledger
 * in view again, and `worktrees` says who is in view. An address no tracked
 * worktree is in draws the not-found page once the rows have said so.
 */
export function UnionLedgerPage({ filter }: { readonly filter: UnionFilter }) {
  const now = useNow()
  const client = useQueryClient()
  const rows = useQuery(reads.worktrees())
  const union = rows.data === undefined ? undefined : unionOf({ filter, rows: rows.data, now })
  const served = union?.rows.filter((row) => row.conflict === null) ?? []
  const ledgers = useQueries({ queries: served.map((row) => reads.ledger(boardOf(row))) })
  const readRows = React.useCallback(() => reread({ client, queryKey: reads.worktrees().queryKey }), [client])
  useStream({
    board: '',
    on: {
      changed: () => Promise.all(served.map((row) => reread({ client, queryKey: reads.ledger(boardOf(row)).queryKey }))),
      worktrees: readRows,
    },
  })

  if (union === null) return <NoPage />

  const listed = served.flatMap((row, index) => {
    const listing = ledgers[index]?.data?.[1]
    return listing === undefined ? [] : [{ row, listing }]
  })
  const entries = listed.flatMap(({ row, listing }) => listing.entries.map((entry): Merged => ({ row, entry }))).toSorted(newestFirst)
  const notices = listed.flatMap(({ row, listing }) => listing.notices.map((notice) => `${row.name}: ${notice}`))
  const problems = [
    ...(rows.error === null ? [] : [messageOf(rows.error, 'Could not load the worktrees')]),
    ...(union?.rows ?? []).flatMap((row) => (row.conflict === null ? [] : [`${row.name} is not served: ${row.conflict}`])),
    ...served.flatMap((row, index) => {
      const read = ledgers[index]
      const error = read?.error ?? null
      // A session whose items cannot be read still has its ledger listed, with the reason beside it.
      const problem = error === null ? problemOf(read?.data?.[0] ?? null) : messageOf(error, 'Could not load the ledger')
      return problem === null ? [] : [`${row.name}: ${problem}`]
    }),
  ]
  // As the board does: loading until a first ledger lands, and a worktree that joins the view later appears once its own does.
  const loading = rows.isPending || (ledgers.length > 0 && ledgers.every((read) => read.isPending))
  return (
    <BoardPageFrame
      title={listingMeta.ledger.label}
      boardName={union?.name ?? null}
      boardHref={`${filterPath(filter)}/`}
      boardMeaning="The board of the worktrees whose ledgers these are."
      crumbs={[{ label: listingMeta.ledger.label, meaning: unionLedgerMeaning }]}
      problem={problems.length === 0 ? null : problems.join(' ')}
    >
      {loading ? <PageLoading /> : (
        <>
          <ListingNotices notices={notices} />
          {entries.length === 0
            ? <ListingEmpty>No entries.</ListingEmpty>
            : (
              <ol className="space-y-4">
                {entries.map(({ row, entry }) => (
                  <li key={`${row.key}:${entry.path}`}>
                    <BoardScope value={boardOf(row)}>
                      <EntryCard entry={entry} now={now} worktree={row} />
                    </BoardScope>
                  </li>
                ))}
              </ol>
            )}
        </>
      )}
    </BoardPageFrame>
  )
}

/**
 * One entry: what it says, when it was written, its body, and the rest of what
 * it records. In a merged ledger it also names the worktree it was written in,
 * beside its age.
 */
function EntryCard({ entry, now, worktree }: { entry: LedgerEntry; now: number; worktree?: WorktreeSummary | undefined }) {
  const tip = useTip()
  const age = (
    <span className="shrink-0 text-xs text-muted-foreground" title={tip(`Written at ${absoluteTime(entry.date)}.`)}>
      {relativeTime(entry.date, now)}
    </span>
  )
  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-pretty text-lg leading-snug font-medium">{entry.title}</h2>
          {worktree === undefined ? age : (
            <span className="flex shrink-0 items-center gap-3">
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <WorktreeMark />
                <a
                  className="rounded-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                  href={`${boardOf(worktree)}/`}
                  title={tip(`Written in ${worktree.name}: open its board.`)}
                >
                  {worktree.name}
                </a>
              </span>
              {age}
            </span>
          )}
        </div>
        {entry.body === '' ? null : <Markdown>{entry.body}</Markdown>}
        <p className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-muted-foreground">
          {keysOf(entry).map(({ key, value, meaning }) => (
            <span key={key} className="wrap-anywhere" title={tip(meaning)}>
              {key}: {value}
            </span>
          ))}
        </p>
      </CardContent>
    </Card>
  )
}
