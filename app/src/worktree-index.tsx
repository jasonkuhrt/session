import { DragDropProvider, DragOverlay, useDragOperation } from '@dnd-kit/react'
import * as React from 'react'

import type { WorktreeSummary } from '../contract'
import type { EpicNameRequest } from './components/session-dialogs'
import { NameDialog } from './components/session-dialogs'
import { SettingsMenu } from './components/settings-menu'
import { useTerminalAvailable } from './components/terminal-action'
import { Explained } from './components/tip'
import { Alert, AlertDescription } from './components/ui/alert'
import { Skeleton } from './components/ui/skeleton'
import { TooltipProvider } from './components/ui/tooltip'
import type { DragContext } from './components/worktree-cards'
import { CardSpace, EpicCard, HeldPreview, LooseCard } from './components/worktree-cards'
import { MainStrip } from './components/worktree-row'
import { IndexApi } from './lib/api'
import { useNow } from './lib/clock'
import { dragSensors } from './lib/drag'
import type { Dashboard, Dragged, DropOutcome } from './lib/epics'
import { dashboardOf, draggedOf, dropOutcome, outcomeWords, targetId, targetOf, withEpics } from './lib/epics'
import { useTrackedWorktrees } from './lib/tracked-worktrees'

const skeletonCards = [1, 2, 3, 4, 5, 6]

/** One line for the whole page: a source that failed, failed for every row. */
const agentNotices = (rows: readonly WorktreeSummary[] | null) =>
  [...new Set(rows?.flatMap((row) => row.agents.notices) ?? [])]

/** What the page is, and what can be done on it, said where its name is. */
const headingMeaning = (
  <span className="block space-y-1">
    <span className="block">
      Every worktree the daemon is tracking, and what its session holds. A worktree joins this page when a session is
      created in it and leaves when that session is gone.
    </span>
    <span className="block">
      The main worktrees are pinned on top. Below them is a card per epic and one per worktree in none, the ones with a
      live agent first, then by their latest activity; one with nothing live and nothing in five days is dim and last.
    </span>
    <span className="block">
      Drag a worktree onto an epic to join it, onto another worktree to make an epic of the two, or out of its epic onto
      the space between the cards to leave it.
    </span>
  </span>
)

/** One worktree's new epic, as a write sends it. */
type EpicChange = { readonly row: WorktreeSummary; readonly epic: string | null }

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : 'The daemon did not answer.')

/** The worktrees a drop names, as the rows it read them from. */
const rowsAt = (rows: readonly WorktreeSummary[], paths: readonly string[]) =>
  paths.flatMap((path) => rows.filter((row) => row.path === path))

/** What a drop writes: every worktree it names, put in its epic or in none. */
const changesOf = (outcome: Exclude<DropOutcome, { kind: 'make' }>, rows: readonly WorktreeSummary[]): EpicChange[] =>
  outcome.kind === 'join'
    ? rowsAt(rows, outcome.paths).map((row) => ({ row, epic: outcome.epic }))
    : rowsAt(rows, [outcome.path]).map((row) => ({ row, epic: null }))

export function WorktreeIndex() {
  const [holding, setHolding] = React.useState(false)
  const [writing, setWriting] = React.useState(false)
  /** The epic each worktree being written is to be in, drawn until the daemon's answer replaces it. */
  const [writes, setWrites] = React.useState<ReadonlyMap<string, string | null>>(new Map())
  const [failure, setFailure] = React.useState<string | null>(null)
  const [naming, setNaming] = React.useState<EpicNameRequest | null>(null)
  // The page's clock as it read when a card was picked up: which cards are
  // quiet, and so where they are, does not move while one is held.
  const [heldAt, setHeldAt] = React.useState<number | null>(null)
  const busy = holding || writing
  const { rows: listed, notice, pullRequests, pullRequestsNotice, reload } = useTrackedWorktrees({ held: busy })
  const clock = useNow()
  const now = heldAt ?? clock
  const terminal = useTerminalAvailable()
  const rows = listed === null ? null : withEpics({ rows: listed, epics: writes })
  const dashboard = rows === null ? null : dashboardOf({ rows, now })
  const sourceNotices = [...agentNotices(rows), ...(pullRequestsNotice === null ? [] : [pullRequestsNotice])]

  /**
   * Put worktrees in epics, one request per worktree, since each worktree's
   * file is its own, and draw them there until the rows read afterwards,
   * which are what the page shows from then on, whatever landed.
   */
  const write = async (changes: readonly EpicChange[]) => {
    if (changes.length === 0) return
    setWriting(true)
    setFailure(null)
    setWrites(new Map(changes.map((change) => [change.row.path, change.epic])))
    const results = await Promise.allSettled(changes.map((change) => IndexApi.setEpic(change.row.key, change.epic)))
    const refusals = [...new Set(results.flatMap((result) => (result.status === 'rejected' ? [reasonOf(result.reason)] : [])))]
    await reload()
    setWrites(new Map())
    setFailure(refusals.length === 0 ? null : refusals.join(' '))
    setWriting(false)
    setHeldAt(null)
  }

  const context: DragContext = {
    pullRequests,
    now,
    terminal,
    rows: rows ?? [],
    writing,
    landingOn: null,
    onRename: (card) => setNaming({ kind: 'rename', ids: card.rows.map((row) => row.path), epic: card.name }),
  }

  return (
    <TooltipProvider>
      <div className="flex min-h-dvh flex-col bg-background text-foreground">
        <title>Worktrees</title>
        <header className="flex items-center gap-8 border-b px-6 py-5">
          <h1 className="font-medium">
            <Explained meaning={headingMeaning}>Worktrees</Explained>
          </h1>
          <SettingsMenu className="ml-auto" />
        </header>
        {notice ? (
          <Alert variant="destructive" className="mx-6 mt-4 w-auto">
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        ) : null}
        {failure ? (
          <Alert variant="destructive" className="mx-6 mt-4 w-auto">
            <AlertDescription>{failure}</AlertDescription>
          </Alert>
        ) : null}
        {sourceNotices.length === 0
          ? null
          : <p className="mx-6 mt-4 text-sm text-muted-foreground">{sourceNotices.join(' · ')}</p>}
        <main className="flex flex-1 flex-col gap-4 p-6">
          {dashboard === null || rows === null ? <LoadingCards /> : rows.length === 0 ? <EmptyState /> : (
            <DragDropProvider
              sensors={dragSensors}
              onDragStart={() => {
                setHolding(true)
                setHeldAt(clock)
                setFailure(null)
              }}
              onDragEnd={(event) => {
                setHolding(false)
                const dragged = draggedOf(event.operation.source?.id)
                const outcome = event.canceled || dragged === null
                  ? null
                  : dropOutcome({ rows, dragged, target: targetOf(event.operation.target?.id) })
                if (outcome === null || outcome.kind === 'make') setHeldAt(null)
                if (outcome === null) return
                if (outcome.kind !== 'make') {
                  void write(changesOf(outcome, rows))
                  return
                }
                const named = rowsAt(rows, outcome.paths)
                if (named.length === 2) {
                  setNaming({ kind: 'epic', ids: outcome.paths, names: [named[0]!.name, named[1]!.name] })
                }
              }}
            >
              <Cards dashboard={dashboard} context={context} />
            </DragDropProvider>
          )}
        </main>
        <NameDialog
          request={naming}
          pending={writing}
          onClose={() => setNaming(null)}
          onName={(name) => {
            const request = naming
            setNaming(null)
            if (request === null || rows === null) return
            if (request.kind === 'epic') {
              void write(rowsAt(rows, request.ids).map((row) => ({ row, epic: name })))
              return
            }
            // A rename moves whoever is in the epic now, since the files may
            // have changed while the dialog was open.
            if (name === request.epic) return
            void write(rows.filter((row) => !row.main && row.epic === request.epic).map((row) => ({ row, epic: name })))
          }}
        />
      </div>
    </TooltipProvider>
  )
}

/**
 * The strip and the cards, inside the drag, where what is held and what it is
 * over are known: the card it would land in is outlined, and the pointer
 * carries the card with the words of what dropping it there would do.
 */
function Cards({ dashboard, context }: { dashboard: Dashboard; context: DragContext }) {
  const { source, target } = useDragOperation()
  const dragged = draggedOf(source?.id)
  const over = targetOf(target?.id)
  const outcome = dragged === null ? null : dropOutcome({ rows: context.rows, dragged, target: over })
  const landingOn = outcome === null || over === null ? null : targetId(over)
  const held: DragContext = { ...context, landingOn }
  return (
    <>
      <MainStrip mains={dashboard.mains} context={context} />
      <CardSpace context={held}>
        <div className="worktree-cards">
          {dashboard.cards.map((card) =>
            card.kind === 'epic'
              ? <EpicCard key={`epic:${card.name}`} card={card} context={held} />
              : <LooseCard key={card.row.path} card={card} context={held} />
          )}
        </div>
      </CardSpace>
      {/* Dropped, the card is drawn where the drop put it, so nothing flies back first. */}
      <DragOverlay dropAnimation={null}>
        {(carried) => (
          <Held
            dragged={draggedOf(carried.id)}
            dashboard={dashboard}
            context={context}
            words={outcome === null ? null : outcomeWords({ outcome, rows: context.rows })}
          />
        )}
      </DragOverlay>
    </>
  )
}

/** The card the pointer carries: the worktree's row, or the whole epic, as each is drawn. */
function Held({ dragged, dashboard, context, words }: {
  dragged: Dragged | null
  dashboard: Dashboard
  context: DragContext
  words: string | null
}) {
  if (dragged === null) return null
  if (dragged.kind === 'epic') {
    const card = dashboard.cards.find((candidate) => candidate.kind === 'epic' && candidate.name === dragged.name)
    return card?.kind === 'epic' ? <HeldPreview held={{ kind: 'epic', card }} words={words} context={context} /> : null
  }
  const row = context.rows.find((candidate) => candidate.path === dragged.path)
  return row === undefined ? null : <HeldPreview held={{ kind: 'row', row }} words={words} context={context} />
}

/** The shape the cards will take, so the first paint is not a single slab. */
function LoadingCards() {
  return (
    <div className="worktree-cards">
      {skeletonCards.map((card) => <Skeleton key={card} className="h-24 rounded-xl" />)}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="py-20 text-center text-sm text-muted-foreground">
      <p>No worktrees yet.</p>
      <p className="mt-2">
        Run <code className="rounded bg-muted px-1.5 py-0.5 font-mono">session open</code> in a worktree to add it.
      </p>
    </div>
  )
}
