import {
  Check,
  CheckCircle2,
  CircleDot,
  ExternalLink,
  FilePenLine,
  Layers3,
  MoreHorizontal,
  Plus,
  Sparkles,
} from 'lucide-react'
import * as React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import type { Item, Session, Stage, StageFile } from '../contract'
import { stageNames } from '../contract'
import { requiredSections, sectionHasContent } from '../stage-rules'
import { Button } from './components/ui/button'
import { Card } from './components/ui/card'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  SheetContent,
} from './components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './components/ui/dropdown-menu'
import { ApiError, SessionApi } from './lib/api'
import { cn } from './lib/utils'

const stageMeta: Record<Stage, { label: string; hint: string; color: string }> = {
  TRIAGE: { label: 'Triage', hint: 'Decide what to pursue', color: '#c084fc' },
  DESIGN: { label: 'Design', hint: 'Resolve open questions', color: '#60a5fa' },
  BATCH: { label: 'Batch', hint: 'Group settled work', color: '#fbbf24' },
  EXECUTE: { label: 'Execute', hint: 'Current batch', color: '#34d399' },
}

function App() {
  const [session, setSession] = React.useState<Session | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [pending, setPending] = React.useState(false)
  const [notice, setNotice] = React.useState<string | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [selectedItem, setSelectedItem] = React.useState<{ id: string; stage: Stage } | null>(null)
  const [editingStage, setEditingStage] = React.useState<{ stage: Stage; revision: string } | null>(null)
  const [adding, setAdding] = React.useState(false)
  const [batching, setBatching] = React.useState(false)
  const [completing, setCompleting] = React.useState<Item | null>(null)
  const [editorConflict, setEditorConflict] = React.useState<{ revision: string; markdown: string } | null>(null)
  const [selectedBatchIds, setSelectedBatchIds] = React.useState<Set<string>>(new Set())

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
    if (editingStage || pending) return
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
    const interval = window.setInterval(refresh, 5_000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      controller.abort()
      window.clearInterval(interval)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [editingStage, pending, load])

  React.useEffect(() => {
    if (!session) return
    const batchIds = new Set(
      session.stages.find((stage) => stage.stage === 'BATCH')?.items.map((item) => item.id) ?? [],
    )
    setSelectedBatchIds((current) => new Set([...current].filter((id) => batchIds.has(id))))
  }, [session])

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

  const currentItem = selectedItem
    ? session?.stages
        .find((stage) => stage.stage === selectedItem.stage)
        ?.items.find((item) => item.id === selectedItem.id) ?? null
    : null

  const executeItems = session?.stages.find((stage) => stage.stage === 'EXECUTE')?.items ?? []

  return (
    <div className="min-h-dvh bg-[#09090b] text-zinc-100 selection:bg-violet-400/30">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <header className="relative z-10 mx-auto grid max-w-[1800px] grid-cols-[minmax(0,1fr)_auto] items-start gap-x-5 gap-y-4 px-5 pb-8 pt-7 sm:px-8 sm:pb-12 sm:pt-10 xl:px-12">
          <h1 className="text-3xl font-semibold tracking-[-0.045em] text-white sm:text-5xl">
            Session
          </h1>
          {session?.worktree ? (
            <dl className="col-span-2 row-start-2 flex flex-wrap gap-x-6 gap-y-2 text-sm leading-6">
              <div className="min-w-0 max-w-full">
                <dt className="text-[13px] text-zinc-400">Branch</dt>
                <dd className="break-words font-medium text-zinc-200">{session.worktree.branch ?? 'No branch'}</dd>
              </div>
              <div className="min-w-0 max-w-full" title={session.worktree.path}>
                <dt className="text-[13px] text-zinc-400">Worktree</dt>
                <dd className="break-words font-medium text-zinc-200">{session.worktree.name}</dd>
              </div>
            </dl>
          ) : null}
        <div className="col-start-2 row-start-1 flex items-center gap-2">
          <Button onClick={() => setAdding(true)} disabled={!session || pending}>
            <Plus className="size-4" />
            <span className="hidden sm:inline">Add candidate</span>
            <span className="sm:hidden">Add</span>
          </Button>
        </div>
      </header>

      <nav className="sticky top-0 z-30 -mt-3 mb-5 border-y border-white/[0.07] bg-[#09090b]/95 px-5 py-2.5 backdrop-blur md:hidden" aria-label="Workflow stages">
        <div className="mx-auto flex max-w-md items-center justify-between gap-1">
          {stageNames.map((stage) => (
            <a
              key={stage}
              href={`#${stage.toLowerCase()}`}
              className="rounded-lg px-2 py-1.5 text-[13px] font-semibold text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-white focus-visible:outline-2 focus-visible:outline-white/70"
            >
              {stageMeta[stage].label}
            </a>
          ))}
        </div>
      </nav>

      {notice || loadError ? (
        <div role="alert" className="relative z-10 mx-5 mb-5 rounded-xl border border-amber-300/15 bg-amber-300/[0.06] px-4 py-3 text-sm text-amber-100 sm:mx-8 xl:mx-12">
          {notice ?? loadError}
        </div>
      ) : null}

      <main className="relative z-10 mx-auto max-w-[1800px] px-5 pb-16 sm:px-8 xl:px-12">
        {loading ? (
          <BoardSkeleton />
        ) : session ? (
          <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-4">
            {stageNames.map((stageName) => {
              const stage = session.stages.find((candidate) => candidate.stage === stageName)
              return stage ? (
                <StageColumn
                  key={stageName}
                  stage={stage}
                  pending={pending}
                  selectedBatchIds={selectedBatchIds}
                  executeOccupied={executeItems.length > 0}
                  onOpen={(item) => setSelectedItem({ id: item.id, stage: stageName })}
                  onEdit={() => {
                    setEditorConflict(null)
                    setEditingStage({ stage: stageName, revision: session.revision })
                  }}
                  onSelect={(id, selected) =>
                    setSelectedBatchIds((current) => {
                      const next = new Set(current)
                      if (selected) next.add(id)
                      else next.delete(id)
                      return next
                    })
                  }
                  onBatch={() => setBatching(true)}
                  onComplete={setCompleting}
                />
              ) : null
            })}
          </div>
        ) : (
          <div className="rounded-3xl border border-dashed border-white/10 py-20 text-center text-zinc-500">
            The session files could not be loaded.
          </div>
        )}
      </main>

      <DetailDialog
        item={currentItem}
        stage={selectedItem?.stage ?? null}
        open={Boolean(currentItem)}
        pending={pending}
        notice={notice}
        onOpenChange={(open) => !open && setSelectedItem(null)}
        onMove={(to) => {
          if (!currentItem || !selectedItem) return
          void mutate('/api/move', { id: currentItem.id, to }).then((ok) => {
            if (ok) setSelectedItem({ id: currentItem.id, stage: to })
          })
        }}
        onComplete={() => currentItem && setCompleting(currentItem)}
      />

      {session && editingStage ? (
        <SourceEditor
          stage={session.stages.find((stage) => stage.stage === editingStage.stage)!}
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
        onStart={(name) =>
          mutate('/api/batch', { ids: [...selectedBatchIds], name }).then((ok) => {
            if (ok) {
              setSelectedBatchIds(new Set())
              setBatching(false)
            }
          })
        }
      />

      <CompleteDialog
        item={completing}
        pending={pending}
        onOpenChange={(open) => !open && setCompleting(null)}
        onComplete={() =>
          completing &&
          mutate('/api/complete', { id: completing.id }).then((ok) => {
            if (ok) {
              setCompleting(null)
              setSelectedItem(null)
            }
          })
        }
      />
    </div>
  )
}

type StageColumnProps = {
  stage: StageFile
  pending: boolean
  selectedBatchIds: Set<string>
  executeOccupied: boolean
  onOpen: (item: Item) => void
  onEdit: () => void
  onSelect: (id: string, selected: boolean) => void
  onBatch: () => void
  onComplete: (item: Item) => void
}

function StageColumn({
  stage,
  pending,
  selectedBatchIds,
  executeOccupied,
  onOpen,
  onEdit,
  onSelect,
  onBatch,
  onComplete,
}: StageColumnProps) {
  const meta = stageMeta[stage.stage]
  const isBatch = stage.stage === 'BATCH'

  return (
    <section
      id={stage.stage.toLowerCase()}
      className="stage-column min-h-[22rem] scroll-mt-16 rounded-[1.6rem] border border-white/[0.065] bg-white/[0.018] p-3.5 sm:p-4"
      style={{ '--stage-color': meta.color } as React.CSSProperties}
    >
      <div className="mb-5 flex items-start justify-between gap-3 px-1 pt-1">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="stage-dot size-2 rounded-full" />
            <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-zinc-100">{meta.label}</h2>
            <span className="rounded-full bg-white/[0.07] px-2.5 py-0.5 text-[13px] font-medium text-zinc-400">
              {stage.items.length}
            </span>
          </div>
          <p className="mt-1.5 pl-[1.125rem] text-[13px] leading-5 text-zinc-400">{meta.hint}</p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8" title={`${stage.stage} file actions`}>
              <MoreHorizontal className="size-4" />
              <span className="sr-only">{stage.stage} file actions</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onEdit}>
              <FilePenLine className="size-4" /> Edit Markdown
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a href={`/files/${stage.stage}.md`} target="_blank" rel="noreferrer">
                <ExternalLink className="size-4" /> Open source file
              </a>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {isBatch ? (
        <div className="mb-3 rounded-xl border border-white/[0.07] bg-black/15 p-2.5">
          <Button
            size="sm"
            className="w-full"
            disabled={pending || selectedBatchIds.size === 0 || executeOccupied}
            onClick={onBatch}
          >
            <Layers3 className="size-3.5" />
            {executeOccupied
              ? 'Execution occupied'
              : selectedBatchIds.size > 0
                ? `Start batch · ${selectedBatchIds.size}`
                : 'Select work to batch'}
          </Button>
        </div>
      ) : null}

      <div className="space-y-2.5">
        {stage.items.length === 0 ? (
          <div className="flex min-h-40 flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.07] px-6 text-center">
            <CircleDot className="mb-3 size-4 text-zinc-700" />
            <p className="text-[14px] leading-6 text-zinc-500">
              {stage.stage === 'EXECUTE' ? 'Ready for the next focused batch.' : 'Nothing waiting here.'}
            </p>
          </div>
        ) : (
          stage.items.map((item) => (
            <WorkflowCard
              key={item.id}
              item={item}
              stage={stage.stage}
              pending={pending}
              selected={selectedBatchIds.has(item.id)}
              onOpen={() => onOpen(item)}
              onSelect={(selected) => onSelect(item.id, selected)}
              onComplete={() => onComplete(item)}
            />
          ))
        )}
      </div>
    </section>
  )
}

type WorkflowCardProps = {
  item: Item
  stage: Stage
  pending: boolean
  selected: boolean
  onOpen: () => void
  onSelect: (selected: boolean) => void
  onComplete: () => void
}

function WorkflowCard({
  item,
  stage,
  pending,
  selected,
  onOpen,
  onSelect,
  onComplete,
}: WorkflowCardProps) {
  return (
    <Card
      className={cn(
        'group relative overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:border-white/[0.14] hover:bg-[#171719]',
        selected && 'border-[color:var(--stage-color)]/40 bg-[#191816]',
      )}
    >
      <div className="stage-edge absolute inset-y-0 left-0 w-px opacity-60" />
      <div className="flex items-start gap-3 p-4">
        {stage === 'BATCH' ? (
          <label className="mt-0.5 flex cursor-pointer items-center" onClick={(event) => event.stopPropagation()}>
            <input
              type="checkbox"
              className="batch-checkbox size-4 rounded border-white/15 bg-transparent"
              checked={selected}
              onChange={(event) => onSelect(event.target.checked)}
              aria-label={`Select ${item.title} for batch`}
            />
          </label>
        ) : null}

        <button className="min-w-0 flex-1 cursor-pointer text-left outline-none" onClick={onOpen}>
          <h3 className="text-[17px] font-semibold leading-6 tracking-[-0.015em] text-zinc-50 transition-colors group-hover:text-white">
            {item.title}
          </h3>
          {item.summary ? (
            <p className="mt-2.5 line-clamp-2 text-[15px] leading-6 text-zinc-300">{item.summary}</p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px] leading-5 text-zinc-500">
            <span className="font-mono">{item.id}</span>
            {item.group ? (
              <>
                <span className="text-zinc-700">·</span>
                <span>{item.group}</span>
              </>
            ) : null}
          </div>
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="-mr-1 -mt-1 size-7 opacity-60 group-hover:opacity-100"
              disabled={pending}
              title={`Actions for ${item.title}`}
            >
              <MoreHorizontal className="size-3.5" />
              <span className="sr-only">Actions for {item.title}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onOpen}>Read detail</DropdownMenuItem>
            {stage === 'EXECUTE' ? (
              <DropdownMenuItem onSelect={onComplete} className="text-emerald-300">
                <Check className="size-3.5" /> Complete
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </Card>
  )
}

function moveAvailability(item: Item, current: Stage, target: Stage) {
  if (target === current) return { enabled: false, reason: `Already in ${stageMeta[target].label}` }
  if (current === 'EXECUTE') {
    return { enabled: false, reason: 'Complete this execution item before changing its stage' }
  }
  if (target === 'EXECUTE') {
    return { enabled: false, reason: 'Start an execution batch from Batch' }
  }

  const missing = (requiredSections[target] ?? []).filter((section) => !sectionHasContent(item.body, section))
  if (missing.length === 0) return { enabled: true, reason: null }
  if (target === 'BATCH') return { enabled: false, reason: 'Settle the outcome and acceptance with your agent first' }
  if (target === 'DESIGN') return { enabled: false, reason: 'Write the open questions with your agent first' }
  return { enabled: false, reason: 'Write the decision with your agent first' }
}

function DetailDialog({
  item,
  stage,
  open,
  pending,
  notice,
  onOpenChange,
  onMove,
  onComplete,
}: {
  item: Item | null
  stage: Stage | null
  open: boolean
  pending: boolean
  notice: string | null
  onOpenChange: (open: boolean) => void
  onMove: (to: Stage) => void
  onComplete: () => void
}) {
  const tooltipBase = React.useId()
  if (!item || !stage) return null
  const meta = stageMeta[stage]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <SheetContent aria-describedby={undefined} style={{ '--stage-color': meta.color } as React.CSSProperties}>
        <div className="border-b border-white/[0.07] px-6 py-7 sm:px-10 sm:py-9">
          {item.group ? <div className="mb-4 text-[13px] font-semibold text-zinc-400">{item.group}</div> : null}
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 pr-10">
            <span className="font-mono text-[12px] text-zinc-500">{item.id}</span>
            <DialogTitle className="max-w-2xl text-3xl sm:text-4xl">{item.title}</DialogTitle>
          </div>

          <div className="mt-6 grid grid-cols-4 gap-1 rounded-2xl border border-white/[0.08] bg-black/20 p-1" role="group" aria-label="Workflow stage">
            {stageNames.map((candidate, index) => {
              const availability = moveAvailability(item, stage, candidate)
              const current = candidate === stage
              const unavailable = pending || !availability.enabled
              const reason = pending ? 'Another update is in progress' : availability.reason
              const tooltipId = `${tooltipBase}-${candidate}`
              return (
                <div key={candidate} className="group/stage relative min-w-0">
                  <button
                    type="button"
                    aria-pressed={current}
                    aria-disabled={unavailable}
                    aria-describedby={unavailable && !current ? tooltipId : undefined}
                    className={cn(
                      'w-full min-w-0 rounded-xl px-1 py-2.5 text-[12px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70 sm:px-2 sm:text-[13px]',
                      current && 'bg-white text-zinc-950',
                      !current && !unavailable && 'cursor-pointer text-zinc-200 hover:bg-white/[0.08] hover:text-white',
                      !current && unavailable && 'cursor-not-allowed text-zinc-500',
                    )}
                    onClick={(event) => {
                      // Touch browsers do not consistently focus tapped buttons.
                      // Focus exposes the same explanation as hover and keyboard.
                      if (unavailable) event.currentTarget.focus()
                      else onMove(candidate)
                    }}
                  >
                    {stageMeta[candidate].label}
                  </button>
                  {unavailable && !current ? (
                    <span
                      id={tooltipId}
                      role="tooltip"
                      className={cn(
                        'pointer-events-none absolute top-[calc(100%+.5rem)] z-30 hidden w-52 rounded-xl border border-white/10 bg-zinc-900 px-3 py-2 text-left text-[12px] font-medium leading-5 text-zinc-200 shadow-2xl group-hover/stage:block group-focus-within/stage:block',
                        index < 2 ? 'left-0' : 'right-0',
                      )}
                    >
                      {reason}
                    </span>
                  ) : null}
                </div>
              )
            })}
          </div>

          {stage === 'EXECUTE' ? (
            <Button className="mt-4" onClick={onComplete} disabled={pending}>
              <CheckCircle2 className="size-4" /> Complete work
            </Button>
          ) : null}

          {notice ? (
            <div className="mt-4 rounded-xl border border-amber-300/20 bg-amber-300/[0.07] px-4 py-3 text-[14px] leading-6 text-amber-100">
              {notice}
            </div>
          ) : null}
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-8 sm:px-10 sm:py-10">
          <Markdown collapseEvidence>{item.body || '_No detail has been written yet._'}</Markdown>
        </div>
      </SheetContent>
    </Dialog>
  )
}

function SourceEditor({
  stage,
  revision,
  conflict,
  open,
  pending,
  onOpenChange,
  onUseLatest,
  onSave,
}: {
  stage: StageFile
  revision: string
  conflict: { revision: string; markdown: string } | null
  open: boolean
  pending: boolean
  onOpenChange: (open: boolean) => void
  onUseLatest: (revision: string) => void
  onSave: (stage: Stage, markdown: string, revision: string) => Promise<boolean>
}) {
  const [markdown, setMarkdown] = React.useState(stage.markdown)
  const dirty = markdown !== stage.markdown
  const parts = stage.file.split('/')
  const fileName = parts.pop() ?? stage.file
  const directory = parts.join('/')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <SheetContent className="max-w-5xl" onEscapeKeyDown={(event) => dirty && event.preventDefault()}>
        <div className="flex items-start justify-between gap-6 border-b border-white/[0.07] px-6 py-6 pr-20 sm:px-8">
          <div>
            <div className="mb-2 text-[13px] font-semibold text-zinc-500">Source file</div>
            <DialogTitle className="font-mono text-xl">{fileName}</DialogTitle>
            <DialogDescription className="break-all font-mono text-[13px]">{directory}</DialogDescription>
          </div>
        </div>
        <div className="grid min-h-0 flex-1 lg:grid-cols-2">
          <div className="flex min-h-[45dvh] flex-col border-b border-white/[0.07] lg:border-b-0 lg:border-r">
            <div className="border-b border-white/[0.07] px-5 py-2.5 text-[13px] font-semibold text-zinc-500">
              Markdown
            </div>
            <textarea
              className="min-h-[40dvh] flex-1 resize-none bg-[#0d0d0f] p-5 font-mono text-[13px] leading-6 text-zinc-300 outline-none placeholder:text-zinc-700 focus:bg-[#0f0f11]"
              value={markdown}
              onChange={(event) => setMarkdown(event.target.value)}
              spellCheck={false}
            />
          </div>
          <div className="min-h-[45dvh] overflow-y-auto">
            <div className="sticky top-0 z-10 border-b border-white/[0.07] bg-[#111113]/95 px-5 py-2.5 text-[13px] font-semibold text-zinc-500 backdrop-blur">
              {conflict ? 'Latest source on disk' : 'Preview'}
            </div>
            {conflict ? (
              <div className="p-5 sm:p-6">
                <div className="mb-4 rounded-xl border border-amber-300/20 bg-amber-300/[0.07] p-4 text-[14px] leading-6 text-amber-100">
                  The source changed after this draft opened. Review the current disk version below, then explicitly use its revision before saving your draft.
                </div>
                <pre className="max-h-[52dvh] overflow-auto whitespace-pre-wrap rounded-xl border border-white/10 bg-[#0a0a0c] p-4 font-mono text-[13px] leading-6 text-zinc-300">{conflict.markdown}</pre>
                <Button className="mt-4" onClick={() => onUseLatest(conflict.revision)}>
                  Use latest revision
                </Button>
              </div>
            ) : (
              <div className="p-6 sm:p-8">
                <Markdown>{markdown || '_This file is empty._'}</Markdown>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between gap-4 border-t border-white/[0.07] px-6 py-4 sm:px-8">
          <p className="text-[13px] text-zinc-500">{dirty ? 'Unsaved changes' : 'File is up to date'}</p>
          <div className="flex gap-2">
            <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
            <Button
              disabled={!dirty || pending || conflict !== null}
              onClick={() => void onSave(stage.stage, markdown, revision).then((ok) => ok && onOpenChange(false))}
            >
              {pending ? 'Saving…' : 'Save source'}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Dialog>
  )
}

function AddCandidateDialog({
  open,
  pending,
  onOpenChange,
  onAdd,
}: {
  open: boolean
  pending: boolean
  onOpenChange: (open: boolean) => void
  onAdd: (title: string, body: string) => Promise<boolean>
}) {
  const [title, setTitle] = React.useState('')
  const [body, setBody] = React.useState('')

  const reset = () => {
    setTitle('')
    setBody('')
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { onOpenChange(next); if (!next) reset() }}>
      <DialogContent>
        <div className="mb-7">
          <div className="mb-3 inline-flex size-10 items-center justify-center rounded-xl bg-violet-400/10 text-violet-300">
            <Sparkles className="size-4" />
          </div>
          <DialogTitle>Add a candidate</DialogTitle>
          <DialogDescription>Capture it in TRIAGE. Shape and move it when the idea earns attention.</DialogDescription>
        </div>
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault()
            if (!title.trim()) return
            void onAdd(title.trim(), body.trim()).then((ok) => {
              if (ok) { reset(); onOpenChange(false) }
            })
          }}
        >
          <Field label="Title">
            <input autoFocus className="field" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="A concise working title" required />
          </Field>
          <Field label="Detail" optional>
            <textarea className="field min-h-36 resize-y font-mono text-[13px] leading-6" value={body} onChange={(event) => setBody(event.target.value)} placeholder="Markdown: context, questions, constraints…" />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <DialogClose asChild><Button variant="ghost" type="button">Cancel</Button></DialogClose>
            <Button type="submit" disabled={!title.trim() || pending}>{pending ? 'Adding…' : 'Add to TRIAGE'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function BatchDialog({
  open,
  pending,
  count,
  onOpenChange,
  onStart,
}: {
  open: boolean
  pending: boolean
  count: number
  onOpenChange: (open: boolean) => void
  onStart: (name: string) => void
}) {
  const [name, setName] = React.useState('')
  return (
    <Dialog open={open} onOpenChange={(next) => { onOpenChange(next); if (!next) setName('') }}>
      <DialogContent>
        <div className="mb-7 inline-flex size-10 items-center justify-center rounded-xl bg-amber-400/10 text-amber-300">
          <Layers3 className="size-4" />
        </div>
        <DialogTitle>Start a focused batch</DialogTitle>
        <DialogDescription>{count} selected {count === 1 ? 'item' : 'items'} will move into EXECUTE together.</DialogDescription>
        <form className="mt-7 space-y-6" onSubmit={(event) => { event.preventDefault(); if (name.trim()) onStart(name.trim()) }}>
          <Field label="Batch name">
            <input autoFocus className="field" value={name} onChange={(event) => setName(event.target.value)} placeholder="What outcome unites this work?" required />
          </Field>
          <div className="flex justify-end gap-2">
            <DialogClose asChild><Button variant="ghost" type="button">Cancel</Button></DialogClose>
            <Button type="submit" disabled={!name.trim() || count === 0 || pending}>{pending ? 'Starting…' : 'Start batch'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function CompleteDialog({
  item,
  pending,
  onOpenChange,
  onComplete,
}: {
  item: Item | null
  pending: boolean
  onOpenChange: (open: boolean) => void
  onComplete: () => void
}) {
  return (
    <Dialog open={Boolean(item)} onOpenChange={onOpenChange}>
      <DialogContent>
        <div className="mb-7 inline-flex size-10 items-center justify-center rounded-xl bg-emerald-400/10 text-emerald-300">
          <CheckCircle2 className="size-4" />
        </div>
        <DialogTitle>Complete this work?</DialogTitle>
        <DialogDescription>
          <span className="text-zinc-300">{item?.title}</span> will leave EXECUTE and be recorded by the source workflow.
        </DialogDescription>
        <div className="mt-8 flex justify-end gap-2">
          <DialogClose asChild><Button variant="ghost">Keep working</Button></DialogClose>
          <Button onClick={onComplete} disabled={pending}>{pending ? 'Completing…' : 'Complete'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, optional, children }: { label: string; optional?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 flex items-center justify-between text-[13px] font-semibold text-zinc-300">
        {label}
        {optional ? <span className="font-normal text-zinc-600">Optional</span> : null}
      </span>
      {children}
    </label>
  )
}

function Markdown({ children, collapseEvidence = false }: { children: string; collapseEvidence?: boolean }) {
  const evidenceMatch = collapseEvidence ? /^###\s+Evidence\s*$/im.exec(children) : null
  const primary = evidenceMatch ? children.slice(0, evidenceMatch.index) : children
  const evidence = evidenceMatch ? children.slice(evidenceMatch.index + evidenceMatch[0].length).trim() : null

  return (
    <div className="markdown-reader">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children: linkChildren, href }) => <MarkdownLink href={href}>{linkChildren}</MarkdownLink>,
          input: (props) => <input {...props} disabled />,
        }}
      >
        {primary}
      </ReactMarkdown>
      {evidence ? (
        <details className="evidence-panel">
          <summary>Evidence</summary>
          <div className="pt-4">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ children: linkChildren, href }) => <MarkdownLink href={href}>{linkChildren}</MarkdownLink>,
                input: (props) => <input {...props} disabled />,
              }}
            >
              {evidence}
            </ReactMarkdown>
          </div>
        </details>
      ) : null}
    </div>
  )
}

function MarkdownLink({ href, children }: { href?: string; children: React.ReactNode }) {
  const [copied, setCopied] = React.useState(false)
  if (!href) return <span>{children}</span>

  if (href.startsWith('/') && !href.startsWith('/files/')) {
    return (
      <span className="path-link">
        <code>{href}</code>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(href).then(() => {
              setCopied(true)
              window.setTimeout(() => setCopied(false), 1_500)
            })
          }}
        >
          {copied ? 'Copied' : 'Copy path'}
        </button>
      </span>
    )
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !/^(https?:|mailto:)/i.test(href)) {
    return <span>{children}</span>
  }

  const target = href.startsWith('#') || href.startsWith('/files/') || /^(https?:|mailto:)/i.test(href)
    ? href
    : `/files/${href.replace(/^\.\//, '')}`

  return <a href={target} target={href.startsWith('#') ? undefined : '_blank'} rel="noreferrer">{children}</a>
}

function BoardSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {stageNames.map((stage) => (
        <div key={stage} className="min-h-80 animate-pulse rounded-[1.6rem] border border-white/[0.05] bg-white/[0.018] p-4">
          <div className="h-4 w-28 rounded bg-white/[0.05]" />
          <div className="mt-8 h-32 rounded-2xl bg-white/[0.035]" />
          <div className="mt-3 h-24 rounded-2xl bg-white/[0.025]" />
        </div>
      ))}
    </div>
  )
}

export default App
