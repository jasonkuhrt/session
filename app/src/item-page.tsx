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

/** Where an item is, and the item itself, from the one session read. */
function locate(session: Session | null, id: string) {
  for (const stage of session?.stages ?? []) {
    const item = stage.items.find((candidate) => candidate.id === id)
    if (item) return { item, stage: stage.stage }
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
    <Button variant="ghost" size="sm" render={<a aria-label="Board" href={boardHref} />}>
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
  pending,
  onMove,
  onComplete,
}: {
  item: Item
  stage: Stage
  pending: boolean
  onMove: (to: Stage) => void
  onComplete: () => void
}) {
  return (
    <article className="max-w-[72ch] space-y-6">
      <div className="space-y-2">
        {item.batch ? <p className="text-sm font-medium text-muted-foreground">{item.batch}</p> : null}
        <h1 className="text-2xl font-medium">{item.title}</h1>
        <p className="flex flex-wrap items-baseline gap-3 font-mono text-xs text-muted-foreground">
          <Copyable value={item.id}>{item.id}</Copyable>
          <Copyable value={item.path}>
            <span className="break-all">{item.path}</span>
          </Copyable>
        </p>
      </div>

      <StageControl item={item} stage={stage} pending={pending} onMove={onMove} />

      {stage === 'EXECUTE' ? (
        <Button className="w-fit" onClick={onComplete} disabled={pending}>
          <CheckCircle2 /> Complete work
        </Button>
      ) : null}

      <Markdown collapseEvidence>{item.body || '_No detail has been written yet._'}</Markdown>
    </article>
  )
}
