import * as React from 'react'

import type { AgentsSummary, FocusResult, Item, Session, TrailerProblem } from '../contract'
import { stageNames } from '../contract'
import { AgentsStrip } from './components/agents'
import { Board } from './components/board'
import type { BoardNameRequest } from './components/session-dialogs'
import { CompleteDialog, NameDialog } from './components/session-dialogs'
import { SessionHeader } from './components/session-header'
import { useTerminalAvailable } from './components/terminal-action'
import { TrailerProblems } from './components/trailer-problems'
import type { Choosing } from './components/workflow-card'
import { Alert, AlertDescription } from './components/ui/alert'
import { Skeleton } from './components/ui/skeleton'
import { eventsUrl, SessionApi } from './lib/api'
import { useNow } from './lib/clock'
import { useNewestRead } from './lib/newest-read'
import { refreshedNotice, useSessionMutations } from './lib/session-mutations'

const linksProblem = (error: unknown) =>
  error instanceof Error ? error.message : 'The pull request and issues could not be read'

function App() {
  const [session, setSession] = React.useState<Session | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [dragging, setDragging] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [agents, setAgents] = React.useState<AgentsSummary | null>(null)
  const [agentsError, setAgentsError] = React.useState<string | null>(null)
  const [trailers, setTrailers] = React.useState<readonly TrailerProblem[]>([])
  const [naming, setNaming] = React.useState<BoardNameRequest | null>(null)
  const [completing, setCompleting] = React.useState<Item | null>(null)
  const [choosing, setChoosing] = React.useState<Choosing>(null)
  const [selection, setSelection] = React.useState<Set<string>>(new Set())
  const now = useNow()
  const terminal = useTerminalAvailable()

  const load = React.useCallback(async (signal?: AbortSignal): Promise<Session | null> => {
    try {
      const next = await SessionApi.read(signal)
      if (signal?.aborted) return null
      setSession(next)
      setLoadError(null)
      return next
    } catch (error) {
      if (!signal?.aborted) setLoadError(error instanceof Error ? error.message : 'Could not load the session')
      return null
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [])

  const reload = React.useCallback(async () => {
    await load()
  }, [load])

  const { pending, failure, refreshed, mutate, follow } = useSessionMutations({
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

  // The trailers answer is the daemon's, derived from the branch and the files;
  // a failed read keeps what the board last showed rather than clearing it.
  const loadTrailers = React.useCallback(async (signal?: AbortSignal) => {
    try {
      const next = await SessionApi.trailers(signal)
      if (!signal?.aborted) setTrailers(next)
    } catch {
      // The session read beside it reports an unreachable daemon.
    }
  }, [])

  // The links are the daemon's last answers from gh and linear, read on their
  // own for the same reason as the agents: a source that cannot be reached
  // must not take the board down, and a failed read keeps the chips it last had.
  // gh and linear answer apart, so two reads can resolve out of order; only the
  // newest lands.
  const links = useNewestRead({ read: SessionApi.links, describe: linksProblem })
  const loadLinks = links.load

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
    void loadTrailers(controller.signal)
    void loadLinks(controller.signal)
    return () => controller.abort()
  }, [load, loadAgents, loadLinks, loadTrailers])

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
    const source = new EventSource(eventsUrl(['changed', 'agents', 'trailers', 'links']))
    const refetch = () => {
      if (busyRef.current) missedRef.current = true
      else void follow(load)
    }
    // The agents overlay, the trailers and the links are not the files, so none
    // is held back by a drag, and each is read only when its own answer changed.
    const refetchAgents = () => void loadAgents()
    const refetchTrailers = () => void loadTrailers()
    const refetchLinks = () => void loadLinks()
    source.addEventListener('changed', refetch)
    source.addEventListener('agents', refetchAgents)
    source.addEventListener('trailers', refetchTrailers)
    source.addEventListener('links', refetchLinks)
    source.addEventListener('error', () => { droppedRef.current = true })
    source.addEventListener('open', () => {
      if (!droppedRef.current) return
      droppedRef.current = false
      refetch()
      refetchAgents()
      refetchTrailers()
      refetchLinks()
    })
    return () => source.close()
  }, [follow, load, loadAgents, loadLinks, loadTrailers])

  React.useEffect(() => {
    busyRef.current = busy
    if (busy || !missedRef.current) return
    missedRef.current = false
    void load()
  }, [busy, load])

  // Only the lane that is choosing has chosen items; one that has moved out of
  // it since is no longer chosen.
  const choosableIds = new Set(
    choosing === null ? [] : session?.stages.find(stage => stage.stage === choosing.stage)?.items.map(item => item.id),
  )
  const selectedIds = new Set([...selection].filter(id => choosableIds.has(id)))
  const choose = (next: Choosing) => {
    setChoosing(next)
    setSelection(new Set())
  }
  // A lane left with nothing to choose stops choosing, and an item that has
  // left the lane is not chosen again if it comes back.
  if (choosing !== null && session !== null && choosableIds.size === 0) choose(null)
  else if (selectedIds.size !== selection.size) setSelection(selectedIds)

  // A write that failed and a write the board recovered from read differently:
  // one is a problem to look at, the other is the board saying it caught up.
  const problem = failure ?? loadError

  return (
    <div className="min-h-dvh bg-background text-foreground">
      {/* One tab per board, so a row of them is readable. React hoists this into the head. */}
      <title>{session?.worktree ? `${session.worktree.name} · Session` : 'Session'}</title>
      <SessionHeader
        worktree={session?.worktree}
        rules={session?.rules ?? false}
        links={links.answer}
        linksError={links.problem}
        terminal={terminal}
      />
      <AgentsStrip agents={agents} error={agentsError} now={now} onFocus={focusAgent} />
      <TrailerProblems problems={trailers} />
      {problem === null ? null : (
        <Alert variant="destructive" className="mx-6 mt-4 w-auto">
          <AlertDescription>{problem}</AlertDescription>
        </Alert>
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
            choosing={choosing}
            onChoose={choose}
            selectedIds={selectedIds}
            onSelect={(id, selected) => setSelection(current => {
              const next = new Set(current)
              if (selected) next.add(id)
              else next.delete(id)
              return next
            })}
            onGroup={(stage, ids) => setNaming({ kind: 'group', stage, ids })}
            onQueue={(ids, group) => setNaming({ kind: 'batch', ids, group })}
            onUngroup={ids => void mutate('/api/ungroup', { ids })}
            onStart={() => void mutate('/api/start', {})}
            onComplete={setCompleting}
            onMove={(id, placement) => mutate('/api/move', { id, ...placement })}
            onDraggingChange={setDragging}
          />
        ) : <p className="py-20 text-center text-muted-foreground">The session files could not be loaded.</p>}
      </main>

      <NameDialog
        request={naming}
        pending={pending}
        onClose={() => setNaming(null)}
        onName={async name => {
          if (naming === null) return
          // A name the lane's choice asked for names what is still chosen,
          // since the files may have moved under the open dialog, and ends
          // the choice; one a group's heading asked for names that group and
          // leaves any lane's choice as it is.
          const fromChoice = naming.kind === 'group' || naming.group === null
          const ids = fromChoice ? naming.ids.filter(id => selectedIds.has(id)) : naming.ids
          if (ids.length === 0) {
            choose(null)
            setNaming(null)
            return
          }
          const path = naming.kind === 'group' ? '/api/group' : '/api/batch'
          if (await mutate(path, { ids, name })) {
            if (fromChoice) choose(null)
            setNaming(null)
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
