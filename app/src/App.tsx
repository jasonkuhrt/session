import { LayoutGrid } from 'lucide-react'
import * as React from 'react'

import type { AgentsSummary, FocusResult, Item, Session } from '../contract'
import { stageNames } from '../contract'
import { AgentsStrip } from './components/agents'
import { Board } from './components/board'
import { DetailDialog } from './components/item-detail'
import { BatchDialog, CompleteDialog } from './components/session-dialogs'
import { Button } from './components/ui/button'
import { Skeleton } from './components/ui/skeleton'
import { ApiError, eventsUrl, SessionApi } from './lib/api'
import { useNow } from './lib/clock'
import { parentPath } from './lib/format'

/** A conflict is not a failure: nothing was lost and the board caught up. */
const refreshedNotice = 'The Markdown changed on disk. The board was refreshed; please try again.'

function App() {
  const [session, setSession] = React.useState<Session | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [dragging, setDragging] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const [notice, setNotice] = React.useState<string | null>(null)
  const [refreshed, setRefreshed] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [agents, setAgents] = React.useState<AgentsSummary | null>(null)
  const [agentsError, setAgentsError] = React.useState<string | null>(null)
  const [selectedItem, setSelectedItem] = React.useState<string | null>(null)
  const [batching, setBatching] = React.useState(false)
  const [completing, setCompleting] = React.useState<Item | null>(null)
  const [batchSelection, setSelectedBatchIds] = React.useState<Set<string>>(new Set())
  const now = useNow()

  const load = React.useCallback(async (signal?: AbortSignal) => {
    try {
      const next = await SessionApi.read(signal)
      if (signal?.aborted) return
      setSession(next)
      setLoadError(null)
      setRefreshed(false)
    } catch (error) {
      if (!signal?.aborted) setLoadError(error instanceof Error ? error.message : 'Could not load the session')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [])

  // The agents overlay is read on its own: it answers a different question than
  // the files do, changes on its own schedule, and a source that cannot be
  // reached must not take the board down with it. A failed read keeps the rows
  // it last had and says that the latest one failed.
  const loadAgents = React.useCallback(async (signal?: AbortSignal) => {
    try {
      const next = await SessionApi.agents(signal)
      if (signal?.aborted) return
      setAgents(next)
      setAgentsError(null)
    } catch (error) {
      if (signal?.aborted) return
      setAgentsError(error instanceof Error ? error.message : 'The agent listing could not be read')
    }
  }, [])

  const focusAgent = React.useCallback(async (pid: number): Promise<FocusResult> => {
    try {
      return await SessionApi.focus(pid)
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : 'The focus request failed' }
    }
  }, [])

  React.useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    void loadAgents(controller.signal)
    return () => controller.abort()
  }, [load, loadAgents])

  // The daemon pushes one `changed` event per debounced write under `.session`;
  // the board never polls. A refetch waits while a mutation is in flight or a
  // card is being dragged, because the sortable library owns placement until
  // drop. Reconnecting refetches too, since writes can land while the stream
  // is down.
  const busy = pending || dragging
  const busyRef = React.useRef(busy)
  const missedRef = React.useRef(false)
  const droppedRef = React.useRef(false)

  React.useEffect(() => {
    const source = new EventSource(eventsUrl)
    const refetch = () => {
      if (busyRef.current) missedRef.current = true
      else void load()
    }
    // The agents overlay is not the files, so it is never held back by a drag.
    const refetchAgents = () => void loadAgents()
    source.addEventListener('changed', refetch)
    source.addEventListener('agents', refetchAgents)
    source.addEventListener('error', () => { droppedRef.current = true })
    source.addEventListener('open', () => {
      if (!droppedRef.current) return
      droppedRef.current = false
      refetch()
      refetchAgents()
    })
    return () => source.close()
  }, [load, loadAgents])

  React.useEffect(() => {
    busyRef.current = busy
    if (busy || !missedRef.current) return
    missedRef.current = false
    void load()
  }, [busy, load])

  const batchIds = new Set(session?.stages.find(stage => stage.stage === 'BATCH')?.items.map(item => item.id))
  const selectedBatchIds = new Set([...batchSelection].filter(id => batchIds.has(id)))

  const mutate = React.useCallback(
    async (path: Parameters<typeof SessionApi.mutate>[0], body: Record<string, unknown>) => {
      if (!session) return false
      setPending(true)
      setNotice(null)
      setRefreshed(false)
      try {
        const next = await SessionApi.mutate(path, { ...body, revision: session.revision })
        setSession(next)
        return true
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          // `load` clears this on the way through, so it is set after it.
          await load()
          setRefreshed(true)
        } else {
          setNotice(error instanceof Error ? error.message : 'The request failed')
        }
        return false
      } finally {
        setPending(false)
      }
    },
    [load, session],
  )

  const selectedStage = session?.stages.find(stage => stage.items.some(item => item.id === selectedItem))
  const currentItem = selectedStage?.items.find(item => item.id === selectedItem) ?? null
  // A write that failed and a write the board recovered from read differently:
  // one is a problem to look at, the other is the board saying it caught up.
  const failure = notice ?? loadError

  return (
    <div className="min-h-dvh bg-background text-foreground">
      {/* One tab per board, so a row of them is readable. React hoists this into the head. */}
      <title>{session?.worktree ? `${session.worktree.name} · Session` : 'Session'}</title>
      {/* The header wraps rather than pushing the page wider than the window. */}
      <header className="flex flex-wrap items-center gap-8 border-b px-6 py-5">
        {session?.worktree ? (
          <dl className="flex gap-8 text-sm">
            <div>
              <dt className="text-muted-foreground">Branch</dt>
              <dd className="font-medium">{session.worktree.branch ?? 'No branch'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Worktree</dt>
              <dd className="font-medium" title={session.worktree.path}>
                {session.worktree.name}
                <span className="ml-2 font-normal text-muted-foreground">{parentPath(session.worktree.path)}</span>
              </dd>
            </div>
          </dl>
        ) : null}
        <Button variant="ghost" size="sm" className="ml-auto" render={<a aria-label="All sessions" href="/" />}>
          <LayoutGrid /> All sessions
        </Button>
      </header>
      <AgentsStrip agents={agents} error={agentsError} now={now} onFocus={focusAgent} />
      {failure === null ? null : (
        <p role="alert" className="mx-6 mt-4 rounded-lg border border-destructive bg-muted p-3 text-sm">
          {failure}
        </p>
      )}
      {refreshed ? <p className="mx-6 mt-4 text-sm text-muted-foreground">{refreshedNotice}</p> : null}
      <main className="overflow-x-auto p-6">
        {loading ? (
          <div className="grid grid-cols-5 gap-4">
            {stageNames.map(stage => <Skeleton key={stage} className="h-64" />)}
          </div>
        ) : session ? (
          <Board
            stages={session.stages}
            pending={pending}
            selectedBatchIds={selectedBatchIds}
            onOpen={setSelectedItem}
            onSelect={(id, selected) => setSelectedBatchIds(current => {
              const next = new Set(current)
              if (selected) next.add(id)
              else next.delete(id)
              return next
            })}
            onQueue={() => setBatching(true)}
            onStart={() => void mutate('/api/start', {})}
            onComplete={setCompleting}
            onMove={(id, to, beforeId) => mutate('/api/move', { id, to, beforeId })}
            onDraggingChange={setDragging}
          />
        ) : <p className="py-20 text-center text-muted-foreground">The session files could not be loaded.</p>}
      </main>
      <DetailDialog
        item={currentItem}
        stage={selectedStage?.stage ?? null}
        open={Boolean(currentItem)}
        pending={pending}
        notice={notice ?? (refreshed ? refreshedNotice : null)}
        onOpenChange={open => { if (!open) setSelectedItem(null) }}
        onMove={to => { if (currentItem) void mutate('/api/move', { id: currentItem.id, to }) }}
        onComplete={() => { if (currentItem) setCompleting(currentItem) }}
      />

      <BatchDialog
        open={batching}
        pending={pending}
        count={selectedBatchIds.size}
        onOpenChange={setBatching}
        onQueue={async name => {
          if (await mutate('/api/batch', { ids: [...selectedBatchIds], name })) {
            setSelectedBatchIds(new Set())
            setBatching(false)
          }
        }}
      />

      <CompleteDialog
        item={completing}
        pending={pending}
        onOpenChange={(open) => !open && setCompleting(null)}
        onComplete={async () => {
          if (completing && await mutate('/api/complete', { id: completing.id })) {
            setCompleting(null)
            setSelectedItem(null)
          }
        }}
      />
    </div>
  )
}

export default App
