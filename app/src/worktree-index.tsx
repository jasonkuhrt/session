import { DragDropProvider } from '@dnd-kit/react'
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
import { WorktreeStack } from './components/worktree-stack'
import { IndexApi } from './lib/api'
import { useNow } from './lib/clock'
import { dashboardOf, stageRangeOf } from './lib/dashboard'
import { dragSensors, holdingOf, pointerOf, sameHolding } from './lib/drag'
import type { DropOutcome, EpicWriting, Holding } from './lib/epics'
import { dropOutcome, withEpics } from './lib/epics'
import type { Placement } from './lib/order'
import { withPlacement } from './lib/order'
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

/** A refused write as the list of sentences a write answers with. */
const refused = (error: unknown) => [reasonOf(error)]

/** The worktrees a drop names, as the rows it read them from. */
const rowsAt = (rows: readonly WorktreeSummary[], paths: readonly string[]) =>
  paths.flatMap((path) => rows.filter((row) => row.path === path))

/** What a drop writes: every worktree it names, put in its epic or in none, against the epic drawn for it when it was dropped. */
const changesOf = (outcome: Extract<DropOutcome, { kind: 'join' | 'leave' }>, rows: readonly WorktreeSummary[]): EpicChange[] =>
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
  const [writes, setWrites] = React.useState<ReadonlyMap<string, EpicWriting>>(new Map())
  /** The place a worktree being placed is to take, drawn until the daemon's answer replaces it. */
  const [placing, setPlacing] = React.useState<Placement | null>(null)
  // What is held and where, drawn as it changes: a move that changes neither
  // what it is over nor which half draws nothing new.
  const [holding, setHolding] = React.useState<Holding | null>(null)
  const latestHolding = React.useRef<Holding | null>(null)
  const hold = (next: Holding | null) => {
    if (sameHolding({ left: latestHolding.current, right: next })) return
    latestHolding.current = next
    setHolding(next)
  }
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
  const rows = drawn === null ? null : withPlacement({ rows: withEpics({ rows: drawn, epics: writes }), placement: placing })
  const drawnRows = rows ?? []
  const dashboard = rows === null ? null : dashboardOf({ rows, now })
  const sourceNotices = [...agentNotices(rows), ...(pullRequestsNotice === null ? [] : [pullRequestsNotice])]

  /**
   * Make a write and draw what it is to do until the rows read afterwards,
   * which are what the page shows from then on, whatever landed; that read is
   * made whether or not reads are held, and it lands, since nothing is held
   * then. What the daemon refused shows above the cards in its own words.
   */
  const commit = async (
    draw: { readonly epics: ReadonlyMap<string, EpicWriting>; readonly placing: Placement | null },
    request: () => Promise<readonly string[]>,
  ) => {
    setWriting(true)
    setFailure(null)
    setWrites(draw.epics)
    setPlacing(draw.placing)
    const refusals = await request()
    await reload()
    setWrites(new Map())
    setPlacing(null)
    setFailure(refusals.length === 0 ? null : [...new Set(refusals)].join(' '))
    setWriting(false)
  }
  /**
   * Put worktrees in epics, one request per worktree, since each worktree's
   * file is its own, each carrying the epic the page had read for it when the
   * change was asked for, so a file changed since is refused rather than
   * overwritten. A worktree that is not a main one loses its rank with it.
   */
  const write = (changes: readonly EpicChange[]) =>
    changes.length === 0 ? Promise.resolve() : commit(
      { epics: new Map(changes.map((change) => [change.path, { epic: change.epic, keepsRank: false }])), placing: null },
      async () => {
        const results = await Promise.allSettled(changes.map((change) => IndexApi.setEpic(change)))
        return results.flatMap((result) => (result.status === 'rejected' ? refused(result.reason) : []))
      },
    )

  /** Place a worktree among its siblings, one request, since the engine ranks and renumbers whatever the place needs. */
  const place = (placement: Placement) =>
    commit({ epics: new Map(), placing: placement }, () => IndexApi.setOrder(placement).then(() => [], refused))

  /**
   * Rename an epic, one request: the daemon moves whoever is in it and tells
   * from the worktrees it tracks whether the name was another epic's, which
   * the page does not guess at, so nothing moves until the rows read after it
   * land.
   */
  const rename = (from: string, to: string) =>
    commit({ epics: new Map(), placing: null }, () => IndexApi.renameEpic({ from, to }).then(() => [], refused))

  const context: DragContext = {
    pullRequests,
    now,
    capabilities,
    stageRange: stageRangeOf(drawnRows),
    rows: drawnRows,
    writing,
    landingOn: null,
    marker: null,
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
              onDragStart={(event) => {
                setSnapshot({ at: clock, rows: listed, pullRequests: readPullRequests })
                hold(holdingOf({ operation: event.operation }))
              }}
              onDragOver={(event) => hold(holdingOf({ operation: event.operation }))}
              onDragMove={(event) => hold(holdingOf({ operation: event.operation, pointer: pointerOf(event) }))}
              onDragEnd={(event) => {
                // The drop is read from what was drawn, which is what it was
                // made on, and the epics and ranks drawn then are what it
                // writes against.
                setSnapshot(null)
                hold(null)
                const held = event.canceled ? null : holdingOf({ operation: event.operation })
                const outcome = held === null ? null : dropOutcome({ rows, dashboard, holding: held })
                if (outcome === null) return
                if (outcome.kind === 'make') setNaming(newEpicRequest(outcome, rows))
                else if (outcome.kind === 'order') void place({ path: outcome.path, before: outcome.before, after: outcome.after })
                else void write(changesOf(outcome, rows))
              }}
            >
              <WorktreeStack dashboard={dashboard} context={context} holding={holding} />
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
            // A rename moves whoever is in the epic when the daemon writes it,
            // since the files may have changed while the dialog was open.
            if (name !== request.epic) void rename(request.epic, name)
          }}
        />
      </div>
    </TooltipProvider>
  )
}

/** The shape a repository's section will take, its head over its cards, so the first paint is not a single slab. */
function LoadingCards() {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-11 rounded-md" />
      <div className="worktree-cards">
        {skeletonCards.map((card) => <Skeleton key={card} className="h-24 rounded-xl" />)}
      </div>
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
