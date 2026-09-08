import * as React from 'react'

import type { Item, Session, Stage } from '../contract'
import { stageNames } from '../contract'
import { Board } from './components/board'
import { DetailDialog } from './components/item-detail'
import { AddCandidateDialog, BatchDialog, CompleteDialog, SourceEditor } from './components/session-dialogs'
import { Skeleton } from './components/ui/skeleton'
import { ApiError, SessionApi } from './lib/api'

function App() {
  const [session, setSession] = React.useState<Session | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [dragging, setDragging] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const [notice, setNotice] = React.useState<string | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [selectedItem, setSelectedItem] = React.useState<string | null>(null)
  const [editingStage, setEditingStage] = React.useState<{ stage: Stage; revision: string } | null>(null)
  const [adding, setAdding] = React.useState(false)
  const [batching, setBatching] = React.useState(false)
  const [completing, setCompleting] = React.useState<Item | null>(null)
  const [editorConflict, setEditorConflict] = React.useState<{ revision: string; markdown: string } | null>(null)
  const [batchSelection, setSelectedBatchIds] = React.useState<Set<string>>(new Set())

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

  React.useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  React.useEffect(() => {
    if (editingStage || pending || dragging) return
    const controller = new AbortController()
    let refreshing = false
    const refresh = async () => {
      if (document.hidden || refreshing) return
      refreshing = true
      try {
        await load(controller.signal)
      } finally {
        refreshing = false
      }
    }
    // Disk changes arrive automatically. Pause while editing so the draft keeps
    // its opening revision; a conflicting save still shows the current source.
    // Cancel an in-flight read too, so it cannot replace a later mutation result.
    // Dragging pauses refresh because the sortable library owns placement until drop.
    const interval = window.setInterval(refresh, 5_000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      controller.abort()
      window.clearInterval(interval)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [editingStage, pending, dragging, load])

  const batchIds = new Set(session?.stages.find(stage => stage.stage === 'BATCH')?.items.map(item => item.id))
  const selectedBatchIds = new Set([...batchSelection].filter(id => batchIds.has(id)))

  const mutate = React.useCallback(
    async (path: Parameters<typeof SessionApi.mutate>[0], body: Record<string, unknown>) => {
      if (!session) return false
      setPending(true)
      setNotice(null)
      try {
        const next = await SessionApi.mutate(path, { ...body, revision: session.revision })
        setSession(next)
        return true
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          await load()
          setNotice('The Markdown changed on disk. The board was refreshed; please try again.')
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

  const saveFile = React.useCallback(
    async (stage: Stage, markdown: string, revision: string) => {
      setPending(true)
      setNotice(null)
      try {
        const next = await SessionApi.saveFile({ stage, markdown, revision })
        setSession(next)
        return true
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          try {
            const latest = await SessionApi.read()
            setSession(latest)
            const latestMarkdown = latest.stages.find((entry) => entry.stage === stage)?.markdown ?? ''
            setEditorConflict({ revision: latest.revision, markdown: latestMarkdown })
            setNotice(null)
          } catch (refreshError) {
            setNotice(refreshError instanceof Error ? refreshError.message : 'Could not refresh the changed source.')
          }
        } else {
          setNotice(error instanceof Error ? error.message : 'The request failed')
        }
        return false
      } finally {
        setPending(false)
      }
    },
    [],
  )

  const selectedStage = session?.stages.find(stage => stage.items.some(item => item.id === selectedItem))
  const currentItem = selectedStage?.items.find(item => item.id === selectedItem) ?? null
  const sourceStage = session?.stages.find(stage => stage.stage === editingStage?.stage)

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="border-b px-6 py-5">
        {session?.worktree ? (
          <dl className="flex gap-8 text-sm">
            <div>
              <dt className="text-muted-foreground">Branch</dt>
              <dd className="font-medium">{session.worktree.branch ?? 'No branch'}</dd>
            </div>
            <div title={session.worktree.path}>
              <dt className="text-muted-foreground">Worktree</dt>
              <dd className="font-medium">{session.worktree.name}</dd>
            </div>
          </dl>
        ) : null}
      </header>
      {notice || loadError ? (
        <p role="alert" className="mx-6 mt-4 rounded-lg border border-destructive bg-muted p-3 text-sm">
          {notice ?? loadError}
        </p>
      ) : null}
      <main className="overflow-x-auto p-6">
        {loading ? (
          <div className="grid grid-cols-4 gap-4">
            {stageNames.map(stage => <Skeleton key={stage} className="h-64" />)}
          </div>
        ) : session ? (
          <Board
            stages={session.stages}
            pending={pending}
            selectedBatchIds={selectedBatchIds}
            onOpen={setSelectedItem}
            onEdit={stage => {
              setEditorConflict(null)
              setEditingStage({ stage, revision: session.revision })
            }}
            onAdd={() => setAdding(true)}
            onSelect={(id, selected) => setSelectedBatchIds(current => {
              const next = new Set(current)
              if (selected) next.add(id)
              else next.delete(id)
              return next
            })}
            onBatch={() => setBatching(true)}
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
        notice={notice}
        onOpenChange={open => { if (!open) setSelectedItem(null) }}
        onMove={to => { if (currentItem) void mutate('/api/move', { id: currentItem.id, to }) }}
        onComplete={() => { if (currentItem) setCompleting(currentItem) }}
      />
      {sourceStage && editingStage ? (
        <SourceEditor
          stage={sourceStage}
          revision={editingStage.revision}
          conflict={editorConflict}
          open
          pending={pending}
          onOpenChange={(open) => {
            if (!open) {
              setEditingStage(null)
              setEditorConflict(null)
            }
          }}
          onUseLatest={(revision) => {
            setEditingStage({ stage: editingStage.stage, revision })
            setEditorConflict(null)
          }}
          onSave={saveFile}
        />
      ) : null}

      <AddCandidateDialog
        open={adding}
        pending={pending}
        onOpenChange={setAdding}
        onAdd={(title, body) =>
          mutate('/api/item', {
            stage: 'TRIAGE',
            title,
            body: `### Decision\n\n${body || 'What should we decide?'}`,
          })
        }
      />

      <BatchDialog
        open={batching}
        pending={pending}
        count={selectedBatchIds.size}
        onOpenChange={setBatching}
        onStart={async name => {
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
