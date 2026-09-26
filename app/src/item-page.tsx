import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2 } from 'lucide-react'
import * as React from 'react'

import type { ArchiveRecord, Item, Session, Stage } from '../contract'
import { BoardPageFrame, PageLoading } from './components/board-page'
import { Copyable } from './components/copyable'
import { Markdown } from './components/markdown'
import { CompleteDialog } from './components/session-dialogs'
import { StageControl } from './components/stage-control'
import { Explained, useTip } from './components/tip'
import { Button } from './components/ui/button'
import { SessionApi } from './lib/api'
import { archiveStateMeaning, readArchivedItem } from './lib/archive'
import { useBoardPath } from './lib/base'
import { landWrite, reread } from './lib/reads'
import { refreshedNotice, useSessionMutations } from './lib/session-mutations'
import { useStream } from './lib/stream'
import { groupMeta } from './lib/workflow'

/** Where an item is, the item itself, and the root its path is relative to. */
function locate(session: Session | null, id: string) {
  if (session === null) return null
  for (const stage of session.stages) {
    const item = stage.items.find((candidate) => candidate.id === id)
    if (item) return { item, stage: stage.stage, directory: session.directory }
  }
  return null
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : 'Could not load the session')

/**
 * One read of the session, as the page shows it. When no stage holds the item
 * its archived record is read first, so the page goes from the item in its
 * stage to the item in the archive in one step, never through a moment where
 * the item is nowhere. An archive that cannot be read still lets the session
 * land, so the page never stays on one the files have moved past, and it says
 * why the item is not shown.
 */
async function landed({ board, id, session, signal }: {
  readonly board: string
  readonly id: string
  readonly session: Session
  readonly signal?: AbortSignal | undefined
}) {
  if (locate(session, id) !== null) return { session, archived: null, unread: null }
  try {
    return { session, archived: await readArchivedItem({ board, id, signal }), unread: null }
  } catch (error) {
    return { session, archived: null, unread: `The archive could not be read, so ${id} is not shown: ${messageOf(error)}` }
  }
}

const itemRead = (board: string, id: string) =>
  queryOptions({
    queryKey: [board, 'item', id],
    queryFn: async ({ signal }) => landed({ board, id, session: await SessionApi.read(board, signal), signal }),
  })

/**
 * The page's read as it draws it: the session and, when no stage holds the
 * item, its archived record. A read that failed says why; one that landed says
 * why the archive, when it was needed, could not be read.
 */
function useItemRead(board: string, id: string) {
  const { data, error, isPending } = useQuery(itemRead(board, id))
  return {
    session: data?.session ?? null,
    archived: data?.archived ?? null,
    loading: isPending,
    loadError: error === null ? data?.unread ?? null : messageOf(error),
  }
}

/**
 * One item, on its own page.
 *
 * An item is a Markdown document, sometimes a long one, so it is read in a
 * page at a reading width rather than squeezed into a panel over the board.
 * The page is addressable, which is what makes an item something you can link
 * a person to; the board's cards are ordinary links into it. The page follows
 * the item wherever it is filed: from stage to stage, and into `archive/` when
 * it is finished or set aside, where it is still the item, read-only.
 */
export function ItemPage({ id }: { id: string }) {
  const board = useBoardPath()
  const client = useQueryClient()
  const [completing, setCompleting] = React.useState<Item | null>(null)
  const { session, archived, loading, loadError } = useItemRead(board, id)

  const reload = React.useCallback(() => reread({ client, queryKey: itemRead(board, id).queryKey }), [board, client, id])

  // A write answers with the session it made, which lands the same way a read
  // does: an item it filed away is shown in the archive rather than as gone.
  // The write stays pending until it has landed, so nothing on the page acts
  // on the session it replaced.
  const { pending, failure, refreshed, mutate, follow } = useSessionMutations({
    session,
    onSession: (next) => landWrite({
      client,
      queryKey: itemRead(board, id).queryKey,
      answer: () => landed({ board, id, session: next }),
    }),
    reload,
  })

  // The daemon pushes `changed` for every write under this worktree's
  // `.session`, `archive/` included. The page holds no placement of its own,
  // so it always reads again. It reads nothing else, so its stream carries
  // nothing else.
  useStream({
    board,
    on: {
      changed: () => follow(async () => {
        await reload()
        return client.getQueryData(itemRead(board, id).queryKey)?.session ?? null
      }),
    },
  })

  const found = locate(session, id)
  // A write that failed and a read that failed are both problems to look at;
  // a refresh is the page saying it caught up, which reads differently.
  const problem = failure ?? loadError

  return (
    <BoardPageFrame
      title={id}
      worktree={session?.worktree?.name ?? null}
      boardMeaning="The board this item is on."
      crumbs={[{ label: id, meaning: `The item ${id}, on a page of its own.`, literal: true }]}
      problem={problem}
      notice={refreshed ? refreshedNotice : null}
    >
      {loading
        ? <PageLoading />
        : found === null
        ? archived === null || session === null
          // A read that failed says so above; only a read that worked can say the item is not here.
          ? problem === null
            ? (
              <p className="text-sm text-muted-foreground">
                No item {id} in this session.{' '}
                <a className="underline underline-offset-4" href={`${board}/`}>Back to the board</a>
              </p>
            )
            : null
          : (
            <Detail
              item={archived.item}
              place={{ kind: 'archived', record: archived.record }}
              directory={session.directory}
              pending={pending}
            />
          )
        : (
          <Detail
            item={found.item}
            place={{ kind: 'stage', stage: found.stage }}
            directory={found.directory}
            pending={pending}
            onMove={(to) => void mutate('/api/move', { id: found.item.id, to })}
            onComplete={() => setCompleting(found.item)}
          />
        )}

      <CompleteDialog
        item={completing}
        pending={pending}
        onOpenChange={(open) => !open && setCompleting(null)}
        onComplete={async () => {
          // The item leaves Execute for `archive/`, and the page stays with it there.
          if (completing && await mutate('/api/complete', { id: completing.id })) setCompleting(null)
        }}
      />
    </BoardPageFrame>
  )
}

/** Where the item on a page is filed: a stage, or the record it was filed away as. */
type Place = { readonly kind: 'stage'; readonly stage: Stage } | { readonly kind: 'archived'; readonly record: ArchiveRecord }

/**
 * The item itself: what it is called, where it is filed, where it can go next,
 * and then the document. The document is the reason the page exists, so the
 * things above it are kept to one line each and a rule hands the page over to
 * the prose.
 */
function Detail({
  item,
  place,
  directory,
  pending,
  onMove,
  onComplete,
}: {
  item: Item
  place: Place
  /** The session root the item's path hangs off; absolute. */
  directory: string
  pending: boolean
  /** Absent for an archived item, which has nowhere to go and nothing to complete. */
  onMove?: ((to: Stage) => void) | undefined
  onComplete?: (() => void) | undefined
}) {
  const tip = useTip()
  const stage = place.kind === 'stage' ? place.stage : null
  return (
    <article>
      {place.kind === 'archived' ? <ArchivedLine record={place.record} /> : null}
      {/* A group's name on its own is a phrase nobody can place, so it is
          labelled the way a field is: a batch in Queue and Execute, where
          every group is one, and a group everywhere else. */}
      {stage !== null && item.group
        ? (
          <dl className="mb-3 flex items-baseline gap-2 text-sm">
            <dt className="text-muted-foreground" title={tip(groupMeta[stage].field)}>{groupMeta[stage].label}</dt>
            <dd className="font-medium">{item.group}</dd>
          </dl>
        )
        : null}
      <h1 className="text-pretty text-3xl leading-tight font-medium tracking-tight">{item.title}</h1>
      <p className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-xs text-muted-foreground">
        <Copyable value={item.id} label={`the item id ${item.id}`}>{item.id}</Copyable>
        {/* The line places the item in the session; what it copies is the
            file, which is what a terminal beside this page can open. */}
        <Copyable value={`${directory}/${item.path}`} label={`the file ${directory}/${item.path}`}>
          <span className="break-all">{item.path}</span>
        </Copyable>
      </p>

      <div className="mt-8 space-y-4">
        <StageControl item={item} stage={stage} pending={pending} onMove={onMove} />
        {stage === 'Execute' && onComplete ? (
          <Button
            className="w-fit"
            onClick={onComplete}
            disabled={pending}
            title={tip('Finish this item: it leaves Execute and is filed under archive/ as done.')}
          >
            <CheckCircle2 /> Complete work
          </Button>
        ) : null}
      </div>

      <div className="mt-10 border-t pt-10">
        <Markdown collapseEvidence page>{item.body || '_No detail has been written yet._'}</Markdown>
      </div>
    </article>
  )
}

/**
 * Where an archived item is: under `archive/`, as its record's name says, with
 * how it left and the day it was filed. It stands where a group's name stands
 * for an item in a stage, above the title.
 */
function ArchivedLine({ record }: { record: ArchiveRecord }) {
  const tip = useTip()
  return (
    <dl className="mb-3 flex items-baseline gap-2 text-sm">
      <dt
        className="text-muted-foreground"
        title={tip('This item is filed under archive/, out of the five stages. Its page shows it as it was filed, read-only.')}
      >
        Archived
      </dt>
      <dd className="flex items-baseline gap-2 font-medium">
        {record.state === null
          ? null
          : <Explained meaning={archiveStateMeaning(record.state)}>{record.state}</Explained>}
        {record.date === null ? null : <span className="font-mono text-xs text-muted-foreground">{record.date}</span>}
      </dd>
    </dl>
  )
}
