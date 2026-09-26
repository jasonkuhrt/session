import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as React from 'react'

import type { FocusResult, Item } from '../contract'
import { stageNames } from '../contract'
import { AgentsStrip } from './components/agents'
import { Board } from './components/board'
import type { BoardNameRequest } from './components/session-dialogs'
import { CompleteDialog, NameDialog } from './components/session-dialogs'
import { SessionHeader } from './components/session-header'
import { TrailerProblems } from './components/trailer-problems'
import type { Choosing } from './components/workflow-card'
import { useCapabilities } from './components/worktree-actions'
import { Alert, AlertDescription } from './components/ui/alert'
import { Skeleton } from './components/ui/skeleton'
import { SessionApi } from './lib/api'
import { useBoardPath } from './lib/base'
import { useNow } from './lib/clock'
import { landWrite, reads, reread } from './lib/reads'
import { refreshedNotice, useSessionMutations } from './lib/session-mutations'
import { useStream } from './lib/stream'

const messageOf = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback)

/** Why a read failed, or nothing while it has not. */
const failureOf = (error: unknown, fallback: string) => (error === null ? null : messageOf(error, fallback))

/**
 * The board's reads, each on its own. The agents overlay, the trailers and the
 * links answer different questions than the files do and change on their own
 * schedule, and a source that cannot be reached must not take the board down
 * with it: a failed read keeps what it last had and says the latest one
 * failed. The trailers are the daemon's answer, derived from the branch and
 * the files, and a failed read of them says nothing: the session read beside
 * it reports an unreachable daemon.
 */
function useBoardReads(board: string) {
  const session = useQuery(reads.session(board))
  const agents = useQuery(reads.agents(board))
  const trailers = useQuery(reads.trailers(board))
  const links = useQuery(reads.links(board))
  return {
    session: session.data ?? null,
    loading: session.isPending,
    loadError: failureOf(session.error, 'Could not load the session'),
    agents: agents.data ?? null,
    agentsError: failureOf(agents.error, 'The agent listing could not be read'),
    trailers: trailers.data ?? [],
    links: links.data ?? null,
    linksError: failureOf(links.error, 'The pull request and issues could not be read'),
  }
}

function App() {
  const board = useBoardPath()
  const client = useQueryClient()
  const [dragging, setDragging] = React.useState(false)
  const [naming, setNaming] = React.useState<BoardNameRequest | null>(null)
  const [completing, setCompleting] = React.useState<Item | null>(null)
  const [choosing, setChoosing] = React.useState<Choosing>(null)
  const [selection, setSelection] = React.useState<Set<string>>(new Set())
  const now = useNow()
  const capabilities = useCapabilities()

  const { session, loading, loadError, agents, agentsError, trailers, links, linksError } = useBoardReads(board)

  const readSession = React.useCallback(() => reread({ client, queryKey: reads.session(board).queryKey }), [board, client])

  const { pending, failure, refreshed, mutate, follow } = useSessionMutations({
    session,
    // A write answers with the session it made, which is drawn at once.
    onSession: (next) => landWrite({ client, queryKey: reads.session(board).queryKey, answer: () => next }),
    reload: readSession,
  })

  const focusAgent = React.useCallback(async (pid: number): Promise<FocusResult> => {
    try {
      return await SessionApi.focus(board, pid)
    } catch (error) {
      return { ok: false, reason: messageOf(error, 'The focus request failed') }
    }
  }, [board])

  // The daemon pushes one `changed` event per debounced write under `.session`;
  // the board never polls. A read of the session waits while a mutation is in
  // flight or a card is being dragged, because the sortable library owns
  // placement until drop, and one read catches up when that ends. The agents
  // overlay, the trailers and the links are not the files, so none is held
  // back by a drag, and each is read only when its own answer changed.
  const busy = pending || dragging
  useStream({
    board,
    on: {
      changed: () => follow(async () => {
        await readSession()
        return client.getQueryData(reads.session(board).queryKey) ?? null
      }),
      agents: () => reread({ client, queryKey: reads.agents(board).queryKey }),
      trailers: () => reread({ client, queryKey: reads.trailers(board).queryKey }),
      links: () => reread({ client, queryKey: reads.links(board).queryKey }),
    },
    hold: { held: busy, events: ['changed'], release: readSession },
  })

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
        links={links}
        linksError={linksError}
        terminal={capabilities.terminal}
        zed={capabilities.zed}
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
