import { DragDropProvider, DragOverlay, useDragOperation } from '@dnd-kit/react'
import * as React from 'react'

import type { PullRequestReports, WorktreeSummary } from '../contract'
import type { EpicNameRequest } from './components/session-dialogs'
import { NameDialog } from './components/session-dialogs'
import { SettingsMenu } from './components/settings-menu'
import { Alert, AlertDescription } from './components/ui/alert'
import { Skeleton } from './components/ui/skeleton'
import { TooltipProvider } from './components/ui/tooltip'
import { useCapabilities } from './components/worktree-actions'
import type { DragContext } from './components/worktree-cards'
import { CardSpace, EpicCard, HeldPreview, LooseCard, NewEpicTarget } from './components/worktree-cards'
import { MainStrip } from './components/worktree-row'
import { IndexApi } from './lib/api'
import { useNow } from './lib/clock'
import { dragSensors } from './lib/drag'
import type { Dashboard, Dragged, DropOutcome } from './lib/epics'
import { dashboardOf, draggedOf, dropOutcome, outcomeWords, stageRangeOf, targetId, targetOf, withEpics } from './lib/epics'
import { useTrackedWorktrees } from './lib/tracked-worktrees'

const skeletonCards = [1, 2, 3, 4, 5, 6]

/** One line for the whole page: a source that failed, failed for every row. */
const agentNotices = (rows: readonly WorktreeSummary[] | null) =>
  [...new Set(rows?.flatMap((row) => row.agents.notices) ?? [])]

/**
 * One worktree's new epic, as a write sends it: the worktree by its path, the
 * epic to put it in, and the epic the page had read for it when the change was
 * asked for, which the daemon refuses the write against if the file has moved.
 */
type EpicChange = { readonly path: string; readonly epic: string | null; readonly from: string | null }

/**
 * What the page draws while a card is held: the rows, the pull requests and the
 * clock as they were when it was picked up. A read already under way can land
 * while it is held, and nothing it brings is drawn until the card is let go.
 */
type Snapshot = {
  readonly at: number
  readonly rows: readonly WorktreeSummary[] | null
  readonly pullRequests: PullRequestReports
}

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : 'The daemon did not answer.')

/** The worktrees a drop names, as the rows it read them from. */
const rowsAt = (rows: readonly WorktreeSummary[], paths: readonly string[]) =>
  paths.flatMap((path) => rows.filter((row) => row.path === path))

/** What a drop writes: every worktree it names, put in its epic or in none, against the epic drawn for it when it was dropped. */
const changesOf = (outcome: Exclude<DropOutcome, { kind: 'make' }>, rows: readonly WorktreeSummary[]): EpicChange[] =>
  outcome.kind === 'join'
    ? rowsAt(rows, outcome.paths).map((row) => ({ path: row.path, epic: outcome.epic, from: row.epic }))
    : rowsAt(rows, [outcome.path]).map((row) => ({ path: row.path, epic: null, from: row.epic }))

/**
 * The dialog a new epic opens, for one worktree dropped on the `+` or two, one
 * on the other: the worktrees with the epics drawn for them at the drop, which
 * the write is made against; null when a row it names is no longer drawn.
 */
const newEpicRequest = (
  outcome: Extract<DropOutcome, { kind: 'make' }>,
  rows: readonly WorktreeSummary[],
): EpicNameRequest | null => {
  const named = rowsAt(rows, outcome.paths)
  return named.length === outcome.paths.length
    ? { kind: 'epic', ids: outcome.paths, names: named.map((row) => row.name), from: named.map((row) => row.epic) }
    : null
}

export function WorktreeIndex() {
  const [writing, setWriting] = React.useState(false)
  /** The epic each worktree being written is to be in, drawn until the daemon's answer replaces it. */
  const [writes, setWrites] = React.useState<ReadonlyMap<string, string | null>>(new Map())
  const [failure, setFailure] = React.useState<string | null>(null)
  const [naming, setNaming] = React.useState<EpicNameRequest | null>(null)
  // What was drawn when a card was picked up, drawn for as long as it is held,
  // so no card moves under the pointer: a pushed read waits for the drop, and
  // one already under way at pickup lands unseen until then.
  const [snapshot, setSnapshot] = React.useState<Snapshot | null>(null)
  const busy = snapshot !== null || writing
  const { rows: listed, notice, pullRequests: readPullRequests, pullRequestsNotice, reload } = useTrackedWorktrees({ held: busy })
  const clock = useNow()
  const now = snapshot?.at ?? clock
  const pullRequests = snapshot?.pullRequests ?? readPullRequests
  const capabilities = useCapabilities()
  const drawn = snapshot === null ? listed : snapshot.rows
  const rows = drawn === null ? null : withEpics({ rows: drawn, epics: writes })
  const drawnRows = rows ?? []
  const dashboard = rows === null ? null : dashboardOf({ rows, now })
  const sourceNotices = [...agentNotices(rows), ...(pullRequestsNotice === null ? [] : [pullRequestsNotice])]

  /**
   * Put worktrees in epics, one request per worktree, since each worktree's
   * file is its own, each carrying the epic the page had read for it when the
   * change was asked for, so a file changed since is refused rather than
   * overwritten; and draw them there until the rows read afterwards, which are
   * what the page shows from then on, whatever landed. That read is made
   * whether or not reads are held, and it lands, since nothing is held then.
   */
  const write = async (changes: readonly EpicChange[]) => {
    if (changes.length === 0) return
    setWriting(true)
    setFailure(null)
    setWrites(new Map(changes.map((change) => [change.path, change.epic])))
    const results = await Promise.allSettled(changes.map((change) => IndexApi.setEpic(change)))
    const refusals = [...new Set(results.flatMap((result) => (result.status === 'rejected' ? [reasonOf(result.reason)] : [])))]
    await reload()
    setWrites(new Map())
    setFailure(refusals.length === 0 ? null : refusals.join(' '))
    setWriting(false)
  }

  const context: DragContext = {
    pullRequests,
    now,
    capabilities,
    stageRange: stageRangeOf(drawnRows),
    rows: drawnRows,
    writing,
    landingOn: null,
    onRename: (card) => setNaming({ kind: 'rename', ids: card.rows.map((row) => row.path), epic: card.name }),
  }

  return (
    <TooltipProvider>
      <div className="flex min-h-dvh flex-col bg-background text-foreground">
        <title>Worktrees</title>
        {/* No heading: every card says what it is and how it moves from where
            it is, and the tab carries the page's name. */}
        <header className="flex items-center gap-8 border-b px-6 py-5">
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
              onDragStart={() => setSnapshot({ at: clock, rows: listed, pullRequests: readPullRequests })}
              onDragEnd={(event) => {
                // The drop is read from what was drawn, which is what it was
                // made on, and the epics drawn then are what it writes against.
                setSnapshot(null)
                const dragged = draggedOf(event.operation.source?.id)
                const outcome = event.canceled || dragged === null
                  ? null
                  : dropOutcome({ rows, dragged, target: targetOf(event.operation.target?.id) })
                if (outcome === null) return
                if (outcome.kind === 'make') setNaming(newEpicRequest(outcome, rows))
                else void write(changesOf(outcome, rows))
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
            // A new epic's worktrees, one dropped on the `+` or two, one
            // dropped on the other, are written against the epics drawn at
            // the drop, so a join that lands while the dialog is open is
            // refused rather than overwritten.
            if (request.kind === 'epic') {
              void write(request.ids.map((path, index) => ({ path, epic: name, from: request.from[index] ?? null })))
              return
            }
            // A rename moves whoever is in the epic now, since the files may
            // have changed while the dialog was open.
            if (name === request.epic) return
            void write(
              rows.filter((row) => !row.main && row.epic === request.epic).map((row) => ({ path: row.path, epic: name, from: row.epic })),
            )
          }}
        />
      </div>
    </TooltipProvider>
  )
}

/**
 * The strip and the cards, inside the drag, where what is held and what it is
 * over are known: the card it would land in is outlined, and the pointer
 * carries the card with the words of what dropping it there would do. While a
 * worktree is held, a `+` after the cards takes it into an epic of its own.
 */
function Cards({ dashboard, context }: { dashboard: Dashboard; context: DragContext }) {
  const { source, target } = useDragOperation()
  const dragged = draggedOf(source?.id)
  const over = targetOf(target?.id)
  const outcome = dragged === null ? null : dropOutcome({ rows: context.rows, dragged, target: over })
  const landingOn = outcome === null || over === null ? null : targetId(over)
  const held: DragContext = { ...context, landingOn }
  const heldRow = dragged?.kind === 'row' ? context.rows.find((row) => row.path === dragged.path) ?? null : null
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
          {heldRow === null ? null : <NewEpicTarget name={heldRow.name} context={held} />}
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
