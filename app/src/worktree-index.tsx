import { DragDropProvider } from '@dnd-kit/react'
import { getRouteApi } from '@tanstack/react-router'
import * as React from 'react'

import type { EpicWrite, PullRequestReports, WorktreeSummary } from '../contract'
import { IndexOutline } from './components/index-outline'
import type { OutlineContext } from './components/index-outline-parts'
import type { Signals } from './components/marks'
import { Skeleton } from './components/ui/skeleton'
import { TooltipProvider } from './components/ui/tooltip'
import { useCapabilities } from './lib/capabilities'
import { IndexApi } from './lib/api'
import { useNow } from './lib/clock'
import type { Dashboard } from './lib/dashboard'
import { dashboardOf, stageRangeOf } from './lib/dashboard'
import { dragSensors, holdingOf, pointerOf, sameHolding } from './lib/drag'
import type { DropOutcome, EpicWriting, Holding } from './lib/epics'
import { dropOutcome, withEpics } from './lib/epics'
import type { Placement } from './lib/order'
import { withPlacement } from './lib/order'
import { useTrackedWorktrees } from './lib/tracked-worktrees'
import { useSessionSeam } from './session-seam'
import { Surface } from './substrate/surface'
import { useSurface } from './substrate/surface-context'

/**
 * What the page draws while a row is held: the rows, the pull requests and the
 * clock as they were when it was picked up. A read already under way can land
 * while it is held, and nothing it brings is drawn until the row is let go.
 */
type Snapshot = {
  readonly at: number
  readonly rows: readonly WorktreeSummary[] | null
  readonly pullRequests: PullRequestReports
}

const route = getRouteApi('/')

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : 'The daemon did not answer.')

/** The worktrees a drop names, as the rows it read them from. */
const rowsAt = (rows: readonly WorktreeSummary[], paths: readonly string[]) =>
  paths.flatMap((path) => rows.filter((row) => row.path === path))

/** What a drop writes: every worktree it names, put in its epic or in none, against the epic drawn for it when it was dropped. */
const changesOf = (outcome: Extract<DropOutcome, { kind: 'join' | 'leave' }>, rows: readonly WorktreeSummary[]): EpicWrite[] =>
  outcome.kind === 'join'
    ? rowsAt(rows, outcome.paths).map((row) => ({ path: row.path, epic: outcome.epic, from: row.epic }))
    : rowsAt(rows, [outcome.path]).map((row) => ({ path: row.path, epic: null, from: row.epic }))

/** A worktree's signals on the index: its row's agents and trailers, and gh's last answer for its branch. */
const signalsFrom = (pullRequests: PullRequestReports, failures: readonly string[]) => (row: WorktreeSummary): Signals => ({
  agents: row.agents,
  pullRequest: pullRequests[row.path] ?? null,
  issues: null,
  trailers: row.trailerProblems,
  failures,
  row,
})

/**
 * The index at `/`: every tracked worktree as an outline of projects, epics
 * and worktrees, under the path line and over the detail line. Its reads and
 * its stream are the index's, and a drag or a write holds its events until it
 * ends, as they always have.
 */
export function WorktreeIndex() {
  const { focus: leaf } = route.useSearch()
  const [writing, setWriting] = React.useState(false)
  const [writes, setWrites] = React.useState<ReadonlyMap<string, EpicWriting>>(new Map())
  const [placing, setPlacing] = React.useState<Placement | null>(null)
  const [holding, setHolding] = React.useState<Holding | null>(null)
  const latestHolding = React.useRef<Holding | null>(null)
  const hold = (next: Holding | null) => {
    if (sameHolding({ left: latestHolding.current, right: next })) return
    latestHolding.current = next
    setHolding(next)
  }
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
  const failures = pullRequestsNotice === null ? [] : [pullRequestsNotice]
  const signalsOf = signalsFrom(pullRequests, failures)

  /**
   * Make a drop's write and draw what it is to do until the rows read
   * afterwards, which are what the page shows from then on, whatever landed;
   * what the daemon refused is said in the detail line, in its own words.
   */
  const commit = async (
    draw: { readonly epics: ReadonlyMap<string, EpicWriting>; readonly placing: Placement | null },
    request: () => Promise<readonly string[]>,
  ): Promise<string | null> => {
    setWriting(true)
    setWrites(draw.epics)
    setPlacing(draw.placing)
    const refusals = await request()
    await reload()
    setWrites(new Map())
    setPlacing(null)
    setWriting(false)
    return refusals.length === 0 ? null : [...new Set(refusals)].join(' ')
  }

  const { seam } = useSessionSeam({
    place: { kind: 'index' },
    leaf,
    data: { rows: drawnRows, now, sessions: new Map(), archived: null, entries: new Map(), signalsOf },
    ready: dashboard !== null,
    held: snapshot !== null,
    capabilities,
    write: null,
    pending: writing,
    readRows: reload,
    focusAgent: IndexApi.focus,
    page: null,
    rules: null,
  })

  const context: OutlineContext = {
    rows: drawnRows,
    signalsOf,
    now,
    stageRange: stageRangeOf(drawnRows),
    writing,
    landingOn: null,
    marker: null,
  }

  return (
    <TooltipProvider>
      <Surface seam={seam}>
        <title>Worktrees</title>
        {notice === null ? null : <p className="mb-4 text-sm text-destructive">{notice}</p>}
        <div className="mx-auto w-full max-w-3xl">
          {dashboard === null || rows === null ? <LoadingRows /> : rows.length === 0 ? <EmptyState /> : (
            <IndexDrag
              rows={rows}
              dashboard={dashboard}
              listed={listed}
              readPullRequests={readPullRequests}
              clock={clock}
              onSnapshot={setSnapshot}
              hold={hold}
              commit={commit}
            >
              <IndexOutline dashboard={dashboard} context={context} holding={holding} />
            </IndexDrag>
          )}
        </div>
      </Surface>
    </TooltipProvider>
  )
}

/**
 * The index's drag, inside the surface, so a new epic's name is asked for in
 * the surface's name dialog and a refusal said in its detail line, as the
 * commands the drops stand for ask and say them.
 */
function IndexDrag({ rows, dashboard, listed, readPullRequests, clock, onSnapshot, hold, commit, children }: {
  rows: readonly WorktreeSummary[]
  dashboard: Dashboard
  listed: readonly WorktreeSummary[] | null
  readPullRequests: PullRequestReports
  clock: number
  onSnapshot: (snapshot: Snapshot | null) => void
  hold: (holding: Holding | null) => void
  commit: (
    draw: { readonly epics: ReadonlyMap<string, EpicWriting>; readonly placing: Placement | null },
    request: () => Promise<readonly string[]>,
  ) => Promise<string | null>
  children: React.ReactNode
}) {
  const surface = useSurface()
  const said = (refused: string | null) => {
    if (refused !== null) surface.flash(refused)
  }
  const write = (changes: readonly EpicWrite[]) =>
    changes.length === 0 ? Promise.resolve(null) : commit(
      { epics: new Map(changes.map((change) => [change.path, { epic: change.epic, keepsRank: false }])), placing: null },
      async () => {
        const results = await Promise.allSettled(changes.map((change) => IndexApi.setEpic(change)))
        return results.flatMap((result) => (result.status === 'rejected' ? [reasonOf(result.reason)] : []))
      },
    )
  const place = (placement: Placement) =>
    commit({ epics: new Map(), placing: placement }, () => IndexApi.setOrder(placement).then(() => [], (error: unknown) => [reasonOf(error)]))
  return (
    <DragDropProvider
      sensors={dragSensors}
      onDragStart={(event) => {
        onSnapshot({ at: clock, rows: listed, pullRequests: readPullRequests })
        hold(holdingOf({ operation: event.operation }))
      }}
      onDragOver={(event) => hold(holdingOf({ operation: event.operation }))}
      onDragMove={(event) => hold(holdingOf({ operation: event.operation, pointer: pointerOf(event) }))}
      onDragEnd={(event) => {
        // The drop is read from what was drawn, which is what it was made on.
        onSnapshot(null)
        hold(null)
        const held = event.canceled ? null : holdingOf({ operation: event.operation })
        const outcome = held === null ? null : dropOutcome({ rows, dashboard, holding: held })
        if (outcome === null) return
        if (outcome.kind === 'order') {
          void place({ path: outcome.path, before: outcome.before, after: outcome.after }).then(said)
          return
        }
        if (outcome.kind !== 'make') {
          void write(changesOf(outcome, rows)).then(said)
          return
        }
        // A new epic's worktrees, one dropped on the `+` or two, one on the
        // other, are written against the epics drawn at the drop.
        const named = rowsAt(rows, outcome.paths)
        if (named.length !== outcome.paths.length) return
        surface.askName({
          title: named.length === 1 ? `Make an epic of ${named[0]?.name ?? 'the worktree'}` : `Make an epic of ${named.map((row) => row.name).join(' and ')}`,
          meaning: 'They will be in one epic under this name. A name another epic already has puts them in that one.',
          value: '',
          placeholder: 'What do these worktrees serve together?',
          confirm: (name) => write(named.map((row) => ({ path: row.path, epic: name, from: row.epic }))),
        })
      }}
    >
      {children}
    </DragDropProvider>
  )
}

/** The shape the outline will take, so the first paint is not a single slab. */
function LoadingRows() {
  return (
    <div className="flex flex-col gap-2">
      {[1, 2, 3, 4, 5, 6].map((row) => <Skeleton key={row} className="h-7 rounded-md" />)}
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
