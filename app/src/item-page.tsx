import { CheckCircle2 } from 'lucide-react'
import * as React from 'react'

import type { Item, Session, Stage } from '../contract'
import { Copyable } from './components/copyable'
import { Markdown } from './components/markdown'
import { CompleteDialog } from './components/session-dialogs'
import { StageControl } from './components/stage-control'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from './components/ui/breadcrumb'
import { Button } from './components/ui/button'
import { Skeleton } from './components/ui/skeleton'
import { eventsUrl, SessionApi } from './lib/api'
import { basePath } from './lib/base'
import { refreshedNotice, useSessionMutations } from './lib/session-mutations'

const boardHref = `${basePath}/`

/**
 * The reading column: everything on the page shares it, so the title, the
 * controls and the prose all start on one line down the middle of the window.
 *
 * The measure is fixed rather than in `ch`, because `ch` here would be counted
 * against the page's font rather than the prose's, and the number that matters
 * is how many characters of the prose land on a line. At its 17px this is
 * about sixty-eight of them, which is the width a paragraph is read at rather
 * than scanned across.
 */
const column = 'mx-auto w-full max-w-[37rem]'

/** Where an item is, the item itself, and the root its path is relative to. */
function locate(session: Session | null, id: string) {
  if (session === null) return null
  for (const stage of session.stages) {
    const item = stage.items.find((candidate) => candidate.id === id)
    if (item) return { item, stage: stage.stage, directory: session.directory }
  }
  return null
}

/**
 * One item, on its own page.
 *
 * An item is a Markdown document, sometimes a long one, so it is read in a
 * page at a reading width rather than squeezed into a panel over the board.
 * The page is addressable, which is what makes an item something you can link
 * a person to; the board's cards are ordinary links into it.
 */
export function ItemPage({ id }: { id: string }) {
  const [session, setSession] = React.useState<Session | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [completing, setCompleting] = React.useState<Item | null>(null)

  const load = React.useCallback(async (signal?: AbortSignal) => {
    try {
      const next = await SessionApi.read(signal)
      if (signal?.aborted) return
      setSession(next)
      setLoadError(null)
    } catch (error) {
      if (!signal?.aborted) setLoadError(error instanceof Error ? error.message : 'Could not load the session')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [])

  const reload = React.useCallback(async () => {
    await load()
  }, [load])

  const { pending, failure, refreshed, mutate, settle } = useSessionMutations({
    session,
    onSession: setSession,
    reload,
  })

  React.useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  // The daemon pushes `changed` for every write under this worktree's
  // `.session`. The page holds no placement of its own, so it always refetches.
  React.useEffect(() => {
    const source = new EventSource(eventsUrl)
    const refetch = () => {
      settle()
      void load()
    }
    source.addEventListener('changed', refetch)
    return () => source.close()
  }, [load, settle])

  const found = locate(session, id)
  // A write that failed and a read that failed are both problems to look at;
  // a refresh is the page saying it caught up, which reads differently.
  const problem = failure ?? loadError

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <title>{session?.worktree ? `${id} · ${session.worktree.name} · Session` : `${id} · Session`}</title>
      <Trail id={id} worktree={session?.worktree?.name ?? null} />
      {problem === null ? null : (
        <p role="alert" className={`${column} mt-6 rounded-lg border border-destructive bg-muted p-3 text-sm`}>
          {problem}
        </p>
      )}
      {refreshed
        ? <p className={`${column} mt-6 text-sm text-muted-foreground`}>{refreshedNotice}</p>
        : null}

      <main className="px-6 pb-24 pt-10">
        {loading
          ? (
            <div className={`${column} space-y-4`}>
              <Skeleton className="h-9 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-64" />
            </div>
          )
          : found === null
          ? (
            <p className={`${column} text-sm text-muted-foreground`}>
              No item {id} in this session.{' '}
              <a className="underline underline-offset-4" href={boardHref}>Back to the board</a>
            </p>
          )
          : (
            <Detail
              item={found.item}
              stage={found.stage}
              directory={found.directory}
              pending={pending}
              onMove={(to) => void mutate('/api/move', { id: found.item.id, to })}
              onComplete={() => setCompleting(found.item)}
            />
          )}
      </main>

      <CompleteDialog
        item={completing}
        pending={pending}
        onOpenChange={(open) => !open && setCompleting(null)}
        onComplete={async () => {
          // The item leaves the session, so the page it was on has nowhere to
          // stand; the board is where the work continues.
          if (completing && await mutate('/api/complete', { id: completing.id })) {
            window.location.assign(boardHref)
          }
        }}
      />
    </div>
  )
}

/**
 * Where this page sits, and the way back out of it.
 *
 * An item is one level inside a worktree's board, which is one level inside
 * every session on this machine, and the trail is that sentence: each step
 * names the place it goes to, and the last one names where you are. It is the
 * page's only navigation, so it sits where a window's navigation sits rather
 * than inside the reading column.
 */
function Trail({ id, worktree }: { id: string; worktree: string | null }) {
  return (
    <header className="sticky top-0 z-10 border-b bg-background/85 px-6 py-3 backdrop-blur">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink
              render={
                <a
                  aria-label="All sessions"
                  href="/"
                  title="Every worktree the daemon is tracking."
                />
              }
            >
              All sessions
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink
              render={
                <a
                  aria-label={worktree ?? 'Board'}
                  href={boardHref}
                  title="The board this item is on."
                />
              }
            >
              {worktree ?? 'Board'}
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage className="font-mono">{id}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    </header>
  )
}

/**
 * The item itself: what it is called, where it is filed, where it can go next,
 * and then the document. The document is the reason the page exists, so the
 * things above it are kept to one line each and a rule hands the page over to
 * the prose.
 */
function Detail({
  item,
  stage,
  directory,
  pending,
  onMove,
  onComplete,
}: {
  item: Item
  stage: Stage
  /** The session root the item's path hangs off; absolute. */
  directory: string
  pending: boolean
  onMove: (to: Stage) => void
  onComplete: () => void
}) {
  return (
    <article className={column}>
      {/* A batch name on its own is a phrase nobody can place, so it is
          labelled the way the header labels a branch. */}
      {item.batch
        ? (
          <dl className="mb-3 flex items-baseline gap-2 text-sm">
            <dt className="text-muted-foreground" title="The batch this item was queued in.">Batch</dt>
            <dd className="font-medium">{item.batch}</dd>
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
        {stage === 'EXECUTE' ? (
          <Button
            className="w-fit"
            onClick={onComplete}
            disabled={pending}
            title="Finish this item: it leaves Execute and is filed under archive/ as done."
          >
            <CheckCircle2 /> Complete work
          </Button>
        ) : null}
      </div>

      <div className="mt-10 border-t pt-10">
        <Markdown collapseEvidence>{item.body || '_No detail has been written yet._'}</Markdown>
      </div>
    </article>
  )
}
