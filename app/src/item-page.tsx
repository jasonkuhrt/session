import { CheckCircle2, Columns3 } from 'lucide-react'
import * as React from 'react'

import type { Item, Session, Stage } from '../contract'
import { Copyable } from './components/copyable'
import { Markdown } from './components/markdown'
import { CompleteDialog } from './components/session-dialogs'
import { SessionHeader } from './components/session-header'
import { StageControl } from './components/stage-control'
import { Button } from './components/ui/button'
import { Skeleton } from './components/ui/skeleton'
import { eventsUrl, SessionApi } from './lib/api'
import { basePath } from './lib/base'
import { refreshedNotice, useSessionMutations } from './lib/session-mutations'

const boardHref = `${basePath}/`

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
  const back = (
    <Button
      variant="ghost"
      size="sm"
      nativeButton={false}
      title="Back to this worktree's board."
      render={<a aria-label="Board" href={boardHref} />}
    >
      <Columns3 /> Board
    </Button>
  )

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <title>{session?.worktree ? `${id} · ${session.worktree.name} · Session` : `${id} · Session`}</title>
      <SessionHeader worktree={session?.worktree} back={back} />
      {problem === null ? null : (
        <p role="alert" className="mx-6 mt-4 rounded-lg border border-destructive bg-muted p-3 text-sm">
          {problem}
        </p>
      )}
      {refreshed ? <p className="mx-6 mt-4 text-sm text-muted-foreground">{refreshedNotice}</p> : null}

      <main className="p-6">
        {loading
          ? (
            <div className="max-w-[72ch] space-y-4">
              <Skeleton className="h-8 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-64" />
            </div>
          )
          : found === null
          ? (
            <p className="text-sm text-muted-foreground">
              No item {id} in this session. <a className="underline underline-offset-4" href={boardHref}>Board</a>
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
    <article className="max-w-[72ch] space-y-6">
      <div className="space-y-2">
        {/* A batch name on its own is a phrase nobody can place, so it is
            labelled the way the header labels a branch. */}
        {item.batch
          ? (
            <dl className="text-sm">
              <dt className="text-muted-foreground" title="The batch this item was queued in.">Batch</dt>
              <dd className="font-medium text-muted-foreground">{item.batch}</dd>
            </dl>
          )
          : null}
        <h1 className="text-2xl font-medium">{item.title}</h1>
        <p className="flex flex-wrap items-baseline gap-3 font-mono text-xs text-muted-foreground">
          <Copyable value={item.id} label={`the item id ${item.id}`}>{item.id}</Copyable>
          {/* The line places the item in the session; what it copies is the
              file, which is what a terminal beside this page can open. */}
          <Copyable value={`${directory}/${item.path}`} label={`the file ${directory}/${item.path}`}>
            <span className="break-all">{item.path}</span>
          </Copyable>
        </p>
      </div>

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

      <Markdown collapseEvidence>{item.body || '_No detail has been written yet._'}</Markdown>
    </article>
  )
}
