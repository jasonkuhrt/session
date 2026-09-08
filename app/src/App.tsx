import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  ExternalLink,
  FilePenLine,
  Layers3,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Sparkles,
} from 'lucide-react'
import * as React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import type { Item, Session, Stage, StageFile } from '../contract'
import { stageNames } from '../contract'
import { Button, buttonVariants } from './components/ui/button'
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

const requiredSections: Partial<Record<Stage, string[]>> = {
  TRIAGE: ['Decision'],
  DESIGN: ['Open questions'],
  BATCH: ['Outcome', 'Acceptance'],
  EXECUTE: ['Outcome', 'Acceptance'],
}

function missingSections(body: string, target: Stage) {
  return (requiredSections[target] ?? []).filter(
    (section) => !new RegExp(`^###\\s+${section}\\s*$`, 'im').test(body),
  )
}

function sectionHasContent(body: string, section: string) {
  const lines = body.split(/\r?\n/)
  const start = lines.findIndex((line) => line.trimEnd() === `### ${section}`)
  if (start === -1) return false
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]!
    if (/^#{1,3}\s/.test(line)) return false
    if (line.trim() !== '') return true
  }
  return false
}

function prepareMoveBody(body: string, target: Stage) {
  const additions = missingSections(body, target).map((section) => `### ${section}\n`)
  return [body.trim(), ...additions].filter(Boolean).join('\n\n')
}

function App() {
  const [session, setSession] = React.useState<Session | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [pending, setPending] = React.useState(false)
  const [notice, setNotice] = React.useState<string | null>(null)
  const [selectedItem, setSelectedItem] = React.useState<{ id: string; stage: Stage } | null>(null)
  const [editingStage, setEditingStage] = React.useState<{ stage: Stage; revision: string } | null>(null)
  const [editingItem, setEditingItem] = React.useState<{ item: Item; stage: Stage; revision: string } | null>(null)
  const [adding, setAdding] = React.useState(false)
  const [batching, setBatching] = React.useState(false)
  const [moving, setMoving] = React.useState<{ item: Item; from: Stage; to: Stage } | null>(null)
  const [completing, setCompleting] = React.useState<Item | null>(null)
  const [editorConflict, setEditorConflict] = React.useState<{ revision: string; markdown: string } | null>(null)
  const [itemConflict, setItemConflict] = React.useState<{ revision: string; item: Item } | null>(null)
  const [selectedBatchIds, setSelectedBatchIds] = React.useState<Set<string>>(new Set())

  const load = React.useCallback(async () => {
    try {
      const next = await SessionApi.read()
      setSession(next)
      setNotice(null)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not load the session')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  React.useEffect(() => {
    if (editingStage || editingItem) return
    const refresh = () => void load()
    const interval = window.setInterval(refresh, 15_000)
    window.addEventListener('focus', refresh)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', refresh)
    }
  }, [editingItem, editingStage, load])

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

  const saveItem = React.useCallback(
    async (id: string, title: string, body: string, revision: string) => {
      setPending(true)
      setNotice(null)
      try {
        const next = await SessionApi.updateItem({ id, title, body, revision })
        setSession(next)
        return true
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          try {
            const latest = await SessionApi.read()
            setSession(latest)
            const latestItem = latest.stages.flatMap((stage) => stage.items).find((item) => item.id === id)
            if (latestItem) setItemConflict({ revision: latest.revision, item: latestItem })
            else setNotice('This item no longer exists in the latest source.')
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

      <header className="relative z-10 mx-auto flex max-w-[1800px] items-start justify-between gap-5 px-5 pb-8 pt-7 sm:px-8 sm:pb-12 sm:pt-10 xl:px-12">
        <div className="min-w-0">
          <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-zinc-400">
            <span className="inline-block size-1.5 rounded-full bg-emerald-400 shadow-[0_0_14px_rgba(52,211,153,.8)]" />
            Four-stage workflow
          </div>
          <h1 className="text-3xl font-semibold tracking-[-0.045em] text-white sm:text-5xl">
            Session
          </h1>
          <p className="mt-3 max-w-2xl truncate text-[13px] text-zinc-500 sm:text-sm">
            {session?.directory ?? 'Loading the session files…'}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => void load()} disabled={pending} title="Refresh files">
            <RefreshCw className={cn('size-4', pending && 'animate-spin')} />
            <span className="sr-only">Refresh files</span>
          </Button>
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

      {notice ? (
        <div className="relative z-10 mx-5 mb-5 rounded-xl border border-amber-300/15 bg-amber-300/[0.06] px-4 py-3 text-sm text-amber-100 sm:mx-8 xl:mx-12">
          {notice}
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
                  onMove={(item, to) => setMoving({ item, from: stageName, to })}
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

      <ItemSheet
        item={currentItem}
        stage={selectedItem?.stage ?? null}
        open={Boolean(currentItem)}
        pending={pending}
        onOpenChange={(open) => !open && setSelectedItem(null)}
        onEdit={() => {
          if (!selectedItem || !currentItem) return
          setSelectedItem(null)
          setItemConflict(null)
          setEditingItem({ item: currentItem, stage: selectedItem.stage, revision: session.revision })
        }}
        onMove={(to) => {
          if (!currentItem || !selectedItem) return
          setSelectedItem(null)
          setMoving({ item: currentItem, from: selectedItem.stage, to })
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

      {editingItem ? (
        <ItemEditor
          key={editingItem.item.id}
          edit={editingItem}
          conflict={itemConflict}
          pending={pending}
          notice={notice}
          onOpenChange={(open) => {
            if (!open) {
              setEditingItem(null)
              setItemConflict(null)
            }
          }}
          onUseLatest={(revision) => {
            setEditingItem({ ...editingItem, revision })
            setItemConflict(null)
          }}
          onSave={(title, body) =>
            saveItem(editingItem.item.id, title, body, editingItem.revision).then((ok) => {
              if (ok) {
                setEditingItem(null)
                setItemConflict(null)
              }
            })
          }
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

      {moving ? (
        <MoveDialog
          key={`${moving.item.id}-${moving.to}`}
          move={moving}
          pending={pending}
          notice={notice}
          onOpenChange={(open) => !open && setMoving(null)}
          onMove={(body) =>
            mutate('/api/move', { id: moving.item.id, to: moving.to, body }).then((ok) => {
              if (ok) setMoving(null)
            })
          }
        />
      ) : null}

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
  onMove: (item: Item, to: Stage) => void
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
  onMove,
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
              onMove={(to) => onMove(item, to)}
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
  onMove: (to: Stage) => void
  onSelect: (selected: boolean) => void
  onComplete: () => void
}

function WorkflowCard({
  item,
  stage,
  pending,
  selected,
  onOpen,
  onMove,
  onSelect,
  onComplete,
}: WorkflowCardProps) {
  const movableStages = stage === 'EXECUTE'
    ? []
    : stageNames.filter((candidate) => candidate !== stage && candidate !== 'EXECUTE')

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
            {movableStages.map((candidate) => (
              <DropdownMenuItem key={candidate} onSelect={() => onMove(candidate)}>
                <ArrowRight className="size-3.5" /> Move to {candidate}
              </DropdownMenuItem>
            ))}
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

function ItemSheet({
  item,
  stage,
  open,
  pending,
  onOpenChange,
  onEdit,
  onMove,
  onComplete,
}: {
  item: Item | null
  stage: Stage | null
  open: boolean
  pending: boolean
  onOpenChange: (open: boolean) => void
  onEdit: () => void
  onMove: (to: Stage) => void
  onComplete: () => void
}) {
  if (!item || !stage) return null
  const meta = stageMeta[stage]
  const movableStages = stage === 'EXECUTE'
    ? []
    : stageNames.filter((candidate) => candidate !== stage && candidate !== 'EXECUTE')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <SheetContent style={{ '--stage-color': meta.color } as React.CSSProperties}>
        <div className="border-b border-white/[0.07] px-6 py-7 pr-20 sm:px-10 sm:py-9">
          <div className="mb-4 flex items-center gap-2 text-[13px] font-semibold text-zinc-400">
            <span className="stage-dot size-1.5 rounded-full" /> {meta.label}
            {item.group ? <><span className="text-zinc-700">/</span>{item.group}</> : null}
          </div>
          <DialogTitle className="max-w-2xl text-3xl sm:text-4xl">{item.title}</DialogTitle>
          <div className="mt-6 flex flex-wrap gap-2">
            {stage === 'EXECUTE' ? (
              <Button onClick={onComplete} disabled={pending}>
                <CheckCircle2 className="size-4" /> Complete work
              </Button>
            ) : null}
            {movableStages.length ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" disabled={pending}>
                    Move <ChevronDown className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {movableStages.map((candidate) => (
                    <DropdownMenuItem key={candidate} onSelect={() => onMove(candidate)}>
                      <ArrowRight className="size-3.5" /> {candidate}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            <Button variant="outline" onClick={onEdit} disabled={pending}>
              <FilePenLine className="size-4" /> Edit
            </Button>
            <a
              className={buttonVariants({ variant: 'ghost' })}
              href={`/files/${stage}.md`}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink className="size-4" /> Open Markdown
            </a>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-8 sm:px-10 sm:py-10">
          <Markdown collapseEvidence>{item.body || '_No detail has been written yet._'}</Markdown>
        </div>
        <div className="border-t border-white/[0.07] px-6 py-4 font-mono text-[13px] text-zinc-500 sm:px-10">
          #{item.id}
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

function ItemEditor({
  edit,
  conflict,
  pending,
  notice,
  onOpenChange,
  onUseLatest,
  onSave,
}: {
  edit: { item: Item; stage: Stage; revision: string }
  conflict: { revision: string; item: Item } | null
  pending: boolean
  notice: string | null
  onOpenChange: (open: boolean) => void
  onUseLatest: (revision: string) => void
  onSave: (title: string, body: string) => Promise<void>
}) {
  const [title, setTitle] = React.useState(edit.item.title)
  const [body, setBody] = React.useState(edit.item.body)
  const required = requiredSections[edit.stage] ?? []
  const incomplete = required.filter((section) => !sectionHasContent(body, section))
  const dirty = title.trim() !== edit.item.title || body.trim() !== edit.item.body

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogTitle>Edit item</DialogTitle>
        <DialogDescription>
          Update this {stageMeta[edit.stage].label} item without navigating the entire stage file.
        </DialogDescription>

        <div className="mt-6 space-y-5">
          <Field label="Title">
            <input
              autoFocus
              className="field text-[16px]"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
            />
          </Field>
          <Field label="Item Markdown">
            <textarea
              className="field min-h-[38dvh] resize-y font-mono text-[14px] leading-6"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              spellCheck={false}
            />
          </Field>
        </div>

        {required.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {required.map((section) => {
              const ready = sectionHasContent(body, section)
              return (
                <span
                  key={section}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[13px]',
                    ready
                      ? 'border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-200'
                      : 'border-amber-300/20 bg-amber-300/[0.07] text-amber-100',
                  )}
                >
                  {ready ? <Check className="size-3.5" /> : <CircleDot className="size-3.5" />}
                  ### {section}
                </span>
              )
            })}
          </div>
        ) : null}

        {conflict ? (
          <div className="mt-5 rounded-2xl border border-amber-300/20 bg-amber-300/[0.06] p-4">
            <p className="text-[14px] font-semibold text-amber-100">Review latest source</p>
            <p className="mt-1 text-[13px] leading-5 text-amber-100/75">
              This item changed after the editor opened. Your draft is preserved above.
            </p>
            <div className="mt-3 rounded-xl border border-white/10 bg-[#0a0a0c] p-4">
              <p className="text-[15px] font-semibold text-white">{conflict.item.title}</p>
              <pre className="mt-3 max-h-44 overflow-auto whitespace-pre-wrap font-mono text-[13px] leading-6 text-zinc-300">{conflict.item.body}</pre>
            </div>
            <Button className="mt-3" onClick={() => onUseLatest(conflict.revision)}>
              Use latest revision
            </Button>
          </div>
        ) : null}

        {notice ? (
          <div className="mt-4 rounded-xl border border-amber-300/20 bg-amber-300/[0.07] px-4 py-3 text-[14px] leading-6 text-amber-100">
            {notice}
          </div>
        ) : null}

        <div className="mt-6 flex items-center justify-between gap-4">
          <span className="font-mono text-[13px] text-zinc-500">{edit.item.id}</span>
          <div className="flex gap-2">
            <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
            <Button
              disabled={!dirty || !title.trim() || incomplete.length > 0 || pending || conflict !== null}
              onClick={() => void onSave(title.trim(), body.trim())}
            >
              {pending ? 'Saving…' : 'Save item'}
            </Button>
          </div>
        </div>
      </DialogContent>
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

function MoveDialog({
  move,
  pending,
  notice,
  onOpenChange,
  onMove,
}: {
  move: { item: Item; from: Stage; to: Stage }
  pending: boolean
  notice: string | null
  onOpenChange: (open: boolean) => void
  onMove: (body: string) => Promise<void>
}) {
  const [body, setBody] = React.useState(() => prepareMoveBody(move.item.body, move.to))
  const required = requiredSections[move.to] ?? []
  const incomplete = required.filter((section) => !sectionHasContent(body, section))
  const target = stageMeta[move.to].label

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogTitle>Move to {target}</DialogTitle>
        <DialogDescription>
          Keep the useful context, then make the target stage's required sections explicit.
        </DialogDescription>

        {required.length > 0 ? (
          <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.035] p-4">
            <p className="text-[13px] font-semibold text-zinc-300">{target} requires</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {required.map((section) => {
                const ready = sectionHasContent(body, section)
                return (
                  <span
                    key={section}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[13px]',
                      ready
                        ? 'border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-200'
                        : 'border-amber-300/20 bg-amber-300/[0.07] text-amber-100',
                    )}
                  >
                    {ready ? <Check className="size-3.5" /> : <CircleDot className="size-3.5" />}
                    ### {section} {ready ? 'ready' : section === 'Open questions' ? '— write the open question' : '— write required content'}
                  </span>
                )
              })}
            </div>
          </div>
        ) : null}

        <label className="mt-6 block">
          <span className="mb-2 block text-[13px] font-semibold text-zinc-300">Item Markdown</span>
          <textarea
            autoFocus
            className="field min-h-[42dvh] resize-y font-mono text-[14px] leading-6"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            spellCheck={false}
          />
        </label>

        {notice ? (
          <div className="mt-4 rounded-xl border border-amber-300/20 bg-amber-300/[0.07] px-4 py-3 text-[14px] leading-6 text-amber-100">
            {notice}
          </div>
        ) : null}

        <div className="mt-6 flex items-center justify-between gap-4">
          <p className="text-[13px] text-zinc-500">
            {incomplete.length > 0
              ? `Answer ${incomplete.length === 1 ? 'the highlighted section' : 'the highlighted sections'} to continue.`
              : `Ready to move from ${stageMeta[move.from].label} to ${target}.`}
          </p>
          <div className="flex shrink-0 gap-2">
            <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
            <Button
              disabled={pending || incomplete.length > 0}
              onClick={() => void onMove(body.trim())}
            >
              {pending ? 'Moving…' : `Move to ${target}`}
            </Button>
          </div>
        </div>
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
