import { useSearch } from '@tanstack/react-router'

import type { ArchiveRecord } from '../contract'
import { encodeWorktreeKey } from '../contract'
import { ListingEmpty, PageLoading, PageSurface, useFocusUpTo } from './components/page'
import { useTip } from './components/tip'
import { problemOf } from './lib/api'
import { archiveStateMeaning } from './lib/archive'
import { useBoardName, useBoardPath } from './lib/base'
import { useFollowed } from './lib/follow'
import { listingMeta } from './lib/listings'
import { reads } from './lib/reads'
import { idOf } from './levels'
import { Node } from './substrate/node'
import type { Entry } from './tree-types'

/**
 * The session's archive, newest first by the day in each name. It is memory,
 * not work: nothing here is waiting on anyone, and each record's Enter opens
 * it on its own page, read-only. A name that is not one the engine writes is
 * listed as it is, since nothing can be read from it.
 */
export function ArchivePage() {
  const { focus: leaf } = useSearch({ strict: false })
  const board = useBoardPath()
  const name = useBoardName()
  const key = encodeWorktreeKey(name)
  const { value, error } = useFollowed({ board, read: reads.archive(board) })
  const [place, archive] = value ?? [null, null]
  const directory = place?.kind === 'read' ? place.directory : null
  const records = archive?.records ?? []
  const recordId = idOf({ kind: 'record', page: 'archive', path: '' })
  const entries: Entry[] = records.map((record) => ({
    at: record.path,
    heading: record.title ?? record.name,
    facts: [
      ...(record.id === null ? [] : [{ key: 'id', text: record.id, meaning: 'The item, by the id it kept through every stage.' }]),
      ...(record.date === null ? [] : [{ key: 'date', text: record.date, meaning: 'The day the item was filed under archive/.' }]),
      ...(record.state === null ? [] : [{ key: 'state', text: record.state, meaning: archiveStateMeaning(record.state) }]),
      { key: 'path', text: record.path, meaning: 'The record’s file, under the session.' },
    ],
  }))
  return (
    <PageSurface
      place={{ kind: 'listing', key, page: 'archive' }}
      leaf={leaf}
      title={listingMeta.archive.label}
      sessions={new Map()}
      archived={null}
      entries={new Map([[recordId, entries]])}
      write={null}
      pending={false}
      rules={null}
      page={{
        // A record opens on the file page, beside the archive under its worktree.
        opens: (at, path) => [...path.slice(0, -2), idOf({ kind: 'record', page: 'file', path: at })],
        pathOf: (at) => (directory === null ? null : `${directory}/${at}`),
        path: directory === null ? null : `${directory}/archive`,
      }}
      ready={value !== null || error !== null}
      problem={error ?? problemOf(place)}
    >
      {archive === null ? (error === null ? <PageLoading /> : null) : <Records records={records} />}
    </PageSurface>
  )
}

/** The records, one line each: the day, the id, the title and the state, as each name gives them. */
function Records({ records }: { records: readonly ArchiveRecord[] }) {
  const record = useFocusUpTo('record')
  const tip = useTip()
  const heading = <span title={tip(listingMeta.archive.meaning)}>{listingMeta.archive.label}</span>
  return (
    <>
      {record === null
        ? <h1 className="mb-6 text-2xl font-medium">{heading}</h1>
        : <Node path={record} as="h2" className="-mx-2.5 mb-6 px-2.5 py-1 text-2xl font-medium">{heading}</Node>}
      {records.length === 0 ? <ListingEmpty>No records.</ListingEmpty> : (
        <ol className="space-y-0.5 text-sm">
          {records.map((entry) => {
            const line = entry.date === null || entry.id === null || entry.title === null || entry.state === null
              ? <span className="wrap-anywhere" title={tip('This file’s name is not one the engine writes, so no day, item or state is read from it.')}>{entry.name}</span>
              : (
                <span className="grid grid-cols-[6.5rem_minmax(0,1fr)_auto] items-baseline gap-x-3">
                  <span className="font-mono text-xs text-muted-foreground tabular-nums">{entry.date}</span>
                  <span className="min-w-0 truncate"><span className="mr-2 font-mono text-xs">{entry.id}</span>{entry.title}</span>
                  <span className="text-xs text-muted-foreground" title={tip(archiveStateMeaning(entry.state))}>{entry.state}</span>
                </span>
              )
            return (
              <li key={entry.path}>
                {record === null ? line : <Node path={[...record, idOf({ kind: 'section', at: entry.path })]} className="px-2 py-1">{line}</Node>}
              </li>
            )
          })}
        </ol>
      )}
    </>
  )
}
