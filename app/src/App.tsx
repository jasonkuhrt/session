import * as React from 'react'

import type { AgentsSummary, FocusResult, Item, Session } from '../contract'
import { stageNames } from '../contract'
import { AgentsStrip } from './components/agents'
import { Board } from './components/board'
import { BatchDialog, CompleteDialog } from './components/session-dialogs'
import { SessionHeader } from './components/session-header'
import { Skeleton } from './components/ui/skeleton'
import { eventsUrl, SessionApi } from './lib/api'
import { useNow } from './lib/clock'
import { refreshedNotice, useSessionMutations } from './lib/session-mutations'

function App() {
  const [session, setSession] = React.useState<Session | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [dragging, setDragging] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [agents, setAgents] = React.useState<AgentsSummary | null>(null)
  const [agentsError, setAgentsError] = React.useState<string | null>(null)
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
      else {
        settle()
        void load()
      }
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
  }, [load, loadAgents, settle])

  React.useEffect(() => {
    busyRef.current = busy
    if (busy || !missedRef.current) return
    missedRef.current = false
    void load()
  }, [busy, load])

  const batchIds = new Set(session?.stages.find(stage => stage.stage === 'BATCH')?.items.map(item => item.id))
  const selectedBatchIds = new Set([...batchSelection].filter(id => batchIds.has(id)))

  // A write that failed and a write the board recovered from read differently:
  // one is a problem to look at, the other is the board saying it caught up.
  const problem = failure ?? loadError

  return (
    <div className="min-h-dvh bg-background text-foreground">
      {/* One tab per board, so a row of them is readable. React hoists this into the head. */}
      <title>{session?.worktree ? `${session.worktree.name} · Session` : 'Session'}</title>
      <SessionHeader worktree={session?.worktree} />
      <AgentsStrip agents={agents} error={agentsError} now={now} onFocus={focusAgent} />
      {problem === null ? null : (
        <p role="alert" className="mx-6 mt-4 rounded-lg border border-destructive bg-muted p-3 text-sm">
          {problem}
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
          if (completing && await mutate('/api/complete', { id: completing.id })) setCompleting(null)
        }}
      />
    </div>
  )
}

export default App
