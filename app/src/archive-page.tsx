import type { ArchiveRecord } from '../contract'
import { BoardPageFrame, ListingEmpty, PageLoading } from './components/board-page'
import { Explained, useTip } from './components/tip'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './components/ui/table'
import { problemOf, worktreeOf } from './lib/api'
import { archiveStateMeaning } from './lib/archive'
import { filePageHref, useBoardPath } from './lib/base'
import { useFollowed } from './lib/follow'
import { listingMeta } from './lib/listings'
import { reads } from './lib/reads'

/** What each column holds, said where its name is. */
const columnMeaning = {
  date: 'The day the item was filed under archive/, as its file name gives it.',
  id: 'The item, by the id it kept through every stage.',
  title: 'The item’s title when it was filed; it opens the record, which is the item’s text exactly as its file held it.',
  state: 'How the item left the stages: done when it was finished, or the stage it was filed from.',
} as const

/**
 * The session's archive, newest first by the day in each name. It is memory,
 * not work: nothing here is waiting on anyone, and each record opens on its
 * own page, read-only. A name that is not one the engine writes is listed as
 * it is, since nothing can be read from it.
 */
export function ArchivePage() {
  const board = useBoardPath()
  // Where the page stands and the archive's records are read together.
  const { value, error } = useFollowed({ board, read: reads.archive(board) })
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
  const board = useBoardPath()
  const { date, id, title, state } = record
  if (date === null || id === null || title === null || state === null) {
    return (
      <TableRow>
        <TableCell colSpan={4} className="whitespace-normal wrap-anywhere">
          <a
            className={recordLink}
            href={filePageHref({ board, path: record.path })}
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
        <a className={recordLink} href={filePageHref({ board, path: record.path })} title={tip(`Read the record of ${id} on a page of its own.`)}>
          {title}
        </a>
      </TableCell>
      <TableCell>
        <Explained meaning={archiveStateMeaning(state)}>{state}</Explained>
      </TableCell>
    </TableRow>
  )
}
