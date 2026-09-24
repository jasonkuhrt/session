import type { ArchiveRecord } from '../contract'
import { BoardPageFrame, ListingEmpty, PageLoading } from './components/board-page'
import { Explained, useTip } from './components/tip'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './components/ui/table'
import { problemOf, readPlace, SessionApi, worktreeOf } from './lib/api'
import { filePageHref } from './lib/base'
import { useFollowed } from './lib/follow'
import { listingMeta } from './lib/listings'

/** The page reads where it stands and the archive's records together. */
const readArchive = (signal: AbortSignal) => Promise.all([readPlace(signal), SessionApi.archive(signal)])

/** What each column holds, said where its name is. */
const columnMeaning = {
  date: 'The day the item was filed under archive/, as its file name gives it.',
  id: 'The item, by the id it kept through every stage.',
  title: 'The item’s title when it was filed; it opens the record, which is the item’s text exactly as its file held it.',
  state: 'How the item left the stages: done when it was finished, or the stage it was filed from.',
} as const

/**
 * What a state word says about how an item left. `done` is finished work;
 * every other word is the stage `session archive` filed it from, which sets an
 * item aside without finishing it.
 */
const stateMeaning = (state: string) => {
  switch (state) {
    case 'done': {
      return 'done: it was finished, filed with session done, the board’s Complete work, or a commit’s Session-Done trailer.'
    }
    case 'triage': {
      return 'triage: it was filed from Triage with session archive, a candidate that was rejected.'
    }
    case 'design': {
      return 'design: it was filed from Design with session archive, while its design questions were still open.'
    }
    case 'batch': {
      return 'batch: it was filed from Batch with session archive, settled work that never ran.'
    }
    case 'queue': {
      return 'queue: it was filed from Queue with session archive, before its batch started.'
    }
    case 'execute': {
      return 'execute: it was filed from Execute with session archive, a started item that was abandoned.'
    }
    default: {
      return `${state}: the state the record’s file name gives.`
    }
  }
}

/**
 * The session's archive, newest first by the day in each name. It is memory,
 * not work: nothing here is waiting on anyone, and each record opens on its
 * own page, read-only. A name that is not one the engine writes is listed as
 * it is, since nothing can be read from it.
 */
export function ArchivePage() {
  const { value, error } = useFollowed(readArchive)
  const [place, archive] = value ?? [null, null]
  return (
    <BoardPageFrame
      title={listingMeta.archive.label}
      worktree={worktreeOf(place)}
      boardMeaning="The board of the session this archive belongs to."
      crumbs={[{ label: listingMeta.archive.label, meaning: listingMeta.archive.meaning }]}
      problem={error ?? problemOf(place)}
    >
      {archive === null ? (error === null ? <PageLoading /> : null) : archive.records.length === 0
        ? <ListingEmpty>No records.</ListingEmpty>
        : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead><Explained meaning={columnMeaning.date}>Date</Explained></TableHead>
                <TableHead><Explained meaning={columnMeaning.id}>ID</Explained></TableHead>
                <TableHead><Explained meaning={columnMeaning.title}>Title</Explained></TableHead>
                <TableHead><Explained meaning={columnMeaning.state}>State</Explained></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {archive.records.map((record) => <RecordRow key={record.path} record={record} />)}
            </TableBody>
          </Table>
        )}
    </BoardPageFrame>
  )
}

const recordLink = 'rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50'

/** One record: the day, the item, its title, and how it left, as its name gives them. */
function RecordRow({ record }: { record: ArchiveRecord }) {
  const tip = useTip()
  const { date, id, title, state } = record
  if (date === null || id === null || title === null || state === null) {
    return (
      <TableRow>
        <TableCell colSpan={4} className="whitespace-normal wrap-anywhere">
          <a
            className={recordLink}
            href={filePageHref(record.path)}
            title={tip('This file’s name is not one the engine writes, so no day, item or state is read from it; it opens the file.')}
          >
            {record.name}
          </a>
        </TableCell>
      </TableRow>
    )
  }
  return (
    <TableRow>
      <TableCell className="font-mono text-muted-foreground tabular-nums">{date}</TableCell>
      <TableCell className="font-mono">{id}</TableCell>
      <TableCell className="whitespace-normal">
        <a className={recordLink} href={filePageHref(record.path)} title={tip(`Read the record of ${id} on a page of its own.`)}>
          {title}
        </a>
      </TableCell>
      <TableCell>
        <Explained meaning={stateMeaning(state)}>{state}</Explained>
      </TableCell>
    </TableRow>
  )
}
