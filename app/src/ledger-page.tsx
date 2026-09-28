import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearch } from '@tanstack/react-router'
import * as React from 'react'

import type { LedgerEntry, WorktreeSummary } from '../contract'
import { encodeWorktreeKey } from '../contract'
import { Markdown } from './components/markdown'
import { NoPage } from './components/no-page'
import { ListingEmpty, ListingNotices, PageLoading, PageSurface, useFocusUpTo } from './components/page'
import { useTip } from './components/tip'
import { problemOf } from './lib/api'
import { BoardScope, useBoardName, useBoardPath } from './lib/base'
import { useNow } from './lib/clock'
import type { UnionFilter } from './lib/filter'
import { boardOf, keyTaken, unionOf } from './lib/filter'
import { useFolds } from './lib/folds'
import { useFollowed } from './lib/follow'
import { absoluteTime, relativeTime } from './lib/format'
import { listingMeta } from './lib/listings'
import { reads, reread, sinceMount } from './lib/reads'
import { useStream } from './lib/stream'
import { idOf } from './levels'
import type { PageActions } from './session-seam'
import { Node } from './substrate/node'
import type { Fact } from './substrate/seam'
import type { Entry } from './tree-types'

/** What each key of an entry says, beside its value. */
const keyMeaning = {
  by: 'Who wrote the entry: a Claude Code session, a Codex thread, or a person.',
  branch: 'The Git branch checked out when the entry was written.',
  commit: 'The commit checked out when the entry was written.',
  batch: 'The batch Execute was running when the entry was written.',
} as const

/** An entry's keys beyond its date and title, as facts: `by` always, and each of the others only when the entry names one. */
const factsOf = (entry: LedgerEntry, now: number): Fact[] => [
  { key: 'age', text: relativeTime(entry.date, now), meaning: `Written at ${absoluteTime(entry.date)}.` },
  ...(['by', 'branch', 'commit', 'batch'] as const).flatMap((key) => {
    const value = entry[key]
    return value === null ? [] : [{ key, text: `${key}: ${value}`, meaning: keyMeaning[key] }]
  }),
]

/** One entry of a ledger drawn, with the worktree whose ledger it is in on a merged one. */
type Drawn = { readonly at: string; readonly entry: LedgerEntry; readonly row: WorktreeSummary | null; readonly board: string }

/**
 * A ledger's entries as the page draws them: newest first, each a node the
 * focus can be on, its title and age its heading, whose Enter folds its body
 * to its heading. Nothing here is unread, and nothing asks to be dismissed.
 */
function Entries({ drawn, foldKey, now }: { drawn: readonly Drawn[]; foldKey: string; now: number }) {
  const record = useFocusUpTo('record')
  const folds = useFolds()
  const tip = useTip()
  return (
    <>
      {record === null ? <h1 className="mb-6 text-2xl font-medium">{listingMeta.ledger.label}</h1> : (
        <Node path={record} as="h2" className="-mx-2.5 mb-6 px-2.5 py-1 text-2xl font-medium">
          <span title={tip(listingMeta.ledger.meaning)}>{listingMeta.ledger.label}</span>
        </Node>
      )}
      {drawn.length === 0 ? <ListingEmpty>No entries.</ListingEmpty> : (
        <ol className="space-y-6">
          {drawn.map(({ at, entry, row, board }) => {
            const folded = folds.folded(`${foldKey}/${at}`, false)
            const heading = (
              <div className="flex items-baseline justify-between gap-4">
                <h3 className="text-pretty text-lg leading-snug font-medium">{entry.title}</h3>
                <span className="shrink-0 text-xs text-muted-foreground" title={tip(`Written at ${absoluteTime(entry.date)}.`)}>
                  {row === null ? null : <span className="mr-3" title={tip(`Written in ${row.name}.`)}>{row.name}</span>}
                  {relativeTime(entry.date, now)}
                </span>
              </div>
            )
            return (
              <li key={at}>
                <BoardScope value={board}>
                  {record === null ? heading : (
                    <Node path={[...record, idOf({ kind: 'section', at })]} className="-mx-2.5 px-2.5 py-1">{heading}</Node>
                  )}
                  {folded || entry.body === '' ? null : <div className="mt-2"><Markdown>{entry.body}</Markdown></div>}
                </BoardScope>
              </li>
            )
          })}
        </ol>
      )}
    </>
  )
}

/** What Enter and a copy do on a ledger's entries: fold one, and copy its file. */
const ledgerActions = ({ drawn, foldKey, toggle, directoryOf, directory }: {
  drawn: readonly Drawn[]
  foldKey: string
  toggle: (key: string) => void
  directoryOf: (entry: Drawn) => string | null
  directory: string | null
}): PageActions => ({
  enter: (at) => toggle(`${foldKey}/${at}`),
  pathOf: (at) => {
    const found = drawn.find((entry) => entry.at === at)
    const root = found === undefined ? null : directoryOf(found)
    return found === undefined || root === null ? null : `${root}/${found.entry.path}`
  },
  path: directory === null ? null : `${directory}/ledger`,
})

/**
 * The session's ledger, newest first. A file in `ledger/` that breaks the
 * ledger's rules is not an entry, and the line above the entries names it.
 */
export function LedgerPage() {
  const { focus: leaf } = useSearch({ strict: false })
  const now = useNow()
  const board = useBoardPath()
  const name = useBoardName()
  const key = encodeWorktreeKey(name)
  const folds = useFolds()
  const { value, error } = useFollowed({ board, read: reads.ledger(board) })
  const [place, ledger] = value ?? [null, null]
  const directory = place?.kind === 'read' ? place.directory : null
  const drawn: Drawn[] = (ledger?.entries ?? []).map((entry) => ({ at: entry.path, entry, row: null, board }))
  const foldKey = `ledger:${key}`
  const recordId = idOf({ kind: 'record', page: 'ledger', path: '' })
  const entries: Entry[] = drawn.map(({ at, entry }) => ({ at, heading: entry.title, facts: factsOf(entry, now) }))
  return (
    <PageSurface
      place={{ kind: 'listing', key, page: 'ledger' }}
      leaf={leaf}
      title={listingMeta.ledger.label}
      sessions={new Map()}
      archived={null}
      entries={new Map([[recordId, entries]])}
      write={null}
      pending={false}
      rules={null}
      page={ledgerActions({ drawn, foldKey, toggle: folds.toggle, directoryOf: () => directory, directory })}
      ready={value !== null || error !== null}
      problem={error ?? problemOf(place)}
    >
      {ledger === null ? (error === null ? <PageLoading /> : null) : (
        <>
          <ListingNotices notices={ledger.notices} />
          <Entries drawn={drawn} foldKey={foldKey} now={now} />
        </>
      )}
    </PageSurface>
  )
}

const messageOf = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback)

/** Newest first by date, then by name, as each ledger is ordered. */
const newestFirst = (left: Drawn, right: Drawn) => {
  if (left.entry.date !== right.entry.date) return left.entry.date < right.entry.date ? 1 : -1
  if (left.entry.name === right.entry.name) return 0
  return left.entry.name < right.entry.name ? -1 : 1
}

/**
 * The ledger of an epic's board or a project's: the entries of every worktree
 * in view, merged newest first, each named for the worktree it was written
 * in, and read as that worktree's own ledger reads it, its Markdown links
 * resolved in its own session. It follows the root's one stream: `changed`
 * there is every tracked session's, and `worktrees` says who is in view.
 */
export function UnionLedgerPage({ filter }: { readonly filter: UnionFilter }) {
  const { focus: leaf } = useSearch({ strict: false })
  const now = useNow()
  const client = useQueryClient()
  const folds = useFolds()
  const rowsRead = useQuery(reads.worktrees())
  const rows = sinceMount(rowsRead)
  const union = rows === undefined ? undefined : unionOf({ filter, rows, now })
  const listedRows = rows ?? []
  const served = union?.rows.filter((row) => !keyTaken({ row, rows: listedRows })) ?? []
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
    const read = sinceMount(ledgers[index])
    return read === undefined ? [] : [{ row, place: read[0], listing: read[1] }]
  })
  const drawn: Drawn[] = listed
    .flatMap(({ row, listing }) => listing.entries.map((entry) => ({ at: `${row.key}/${entry.path}`, entry, row, board: boardOf(row) })))
    .toSorted(newestFirst)
  const notices = listed.flatMap(({ row, listing }) => listing.notices.map((notice) => `${row.name}: ${notice}`))
  const problems = [
    ...(rowsRead.error === null ? [] : [messageOf(rowsRead.error, 'Could not load the worktrees')]),
    ...(union?.rows ?? []).flatMap((row) => (keyTaken({ row, rows: listedRows }) ? [`${row.name} is not served: ${row.conflict}`] : [])),
    ...served.flatMap((row, index) => {
      const read = ledgers[index]
      const error = read?.error ?? null
      const problem = error === null ? problemOf(sinceMount(read)?.[0] ?? null) : messageOf(error, 'Could not load the ledger')
      return problem === null ? [] : [`${row.name}: ${problem}`]
    }),
  ]
  const loading = !rowsRead.isFetchedAfterMount || (ledgers.length > 0 && ledgers.every((read) => !read.isFetchedAfterMount))
  const foldKey = `ledger:${filter.kind}:${filter.kind === 'epic' ? filter.name : filter.path}`
  const recordId = idOf({ kind: 'record', page: 'ledger', path: '' })
  const directories = new Map(listed.map(({ row, place }) => [row.key, place.kind === 'read' ? place.directory : null]))
  return (
    <PageSurface
      place={{ kind: 'union-ledger', filter }}
      leaf={leaf}
      title={`${listingMeta.ledger.label} · ${union?.name ?? ''}`}
      sessions={new Map()}
      archived={null}
      entries={new Map([[recordId, drawn.map(({ at, entry, row }) => ({
        at,
        heading: entry.title,
        facts: [...(row === null ? [] : [{ key: 'worktree', text: row.name, meaning: 'The worktree the entry was written in.' }]), ...factsOf(entry, now)],
      }))]])}
      write={null}
      pending={false}
      rules={null}
      page={ledgerActions({ drawn, foldKey, toggle: folds.toggle, directoryOf: (entry) => (entry.row === null ? null : directories.get(entry.row.key) ?? null), directory: null })}
      ready={!loading}
      problem={problems.length === 0 ? null : problems.join(' ')}
    >
      {loading ? <PageLoading /> : (
        <>
          <ListingNotices notices={notices} />
          <Entries drawn={drawn} foldKey={foldKey} now={now} />
        </>
      )}
    </PageSurface>
  )
}
