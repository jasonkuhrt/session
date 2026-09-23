import * as React from 'react'

import type { Stage, WorktreeSummary } from '../contract'
import { stageNames } from '../contract'
import { ActivityCell } from './components/activity-cell'
import { Explained } from './components/agent-marks'
import { AgentsCell } from './components/agents-cell'
import { Copyable } from './components/copyable'
import { TerminalAction, useTerminalAvailable } from './components/terminal-action'
import { TrailerCount } from './components/trailer-problems'
import { Alert, AlertDescription } from './components/ui/alert'
import { Badge } from './components/ui/badge'
import { Skeleton } from './components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './components/ui/table'
import { TooltipProvider } from './components/ui/tooltip'
import { eventsUrl, IndexApi } from './lib/api'
import { useNow } from './lib/clock'
import { hour, parentPath } from './lib/format'
import { cn } from './lib/utils'
import { stageMeta } from './lib/workflow'

/**
 * Activity bands, in order; a row lands in the first band it fits. A worktree
 * where nothing has happened at all has no age, so it gets a band of its own
 * rather than being called old, and it is dimmed: there is nothing in it to
 * look at yet. The four are total over every row, the third taking every
 * remaining age.
 */
const bands = [
  { label: 'Active in the last 24 hours', holds: (age: number | null) => age !== null && age <= 24 * hour, muted: false },
  { label: 'Active in the last 5 days', holds: (age: number | null) => age !== null && age <= 5 * 24 * hour, muted: false },
  { label: 'Older', holds: (age: number | null) => age !== null, muted: false },
  { label: 'No activity', holds: (age: number | null) => age === null, muted: true },
] as const

/** Milliseconds since anything last happened here, or null when nothing has. */
const ageOf = (row: WorktreeSummary, now: number) =>
  row.activity === null ? null : now - Date.parse(row.activity.at)

/** Rows split by band, newest first inside each; empty bands are dropped. */
function bandRows(rows: readonly WorktreeSummary[], now: number) {
  const buckets = bands.map(band => ({ band, rows: [] as WorktreeSummary[] }))
  for (const row of rows) {
    const age = ageOf(row, now)
    buckets.find(candidate => candidate.band.holds(age))?.rows.push(row)
  }
  for (const bucket of buckets) {
    bucket.rows.sort((left, right) => {
      const [first, second] = [ageOf(left, now), ageOf(right, now)]
      // Within a band either both rows have an age or neither does.
      return first === null || second === null ? left.name.localeCompare(right.name) : first - second
    })
  }
  return buckets.filter(bucket => bucket.rows.length > 0)
}

const skeletonRows = [1, 2, 3, 4, 5]

/** One line for the whole page: a source that failed, failed for every row. */
const agentNotices = (rows: readonly WorktreeSummary[] | null) =>
  [...new Set(rows?.flatMap((row) => row.agents.notices) ?? [])]

/** What each column holds, said where its name is. */
const columnMeaning = {
  worktree: 'A Git worktree the daemon is tracking, and the directory it sits in; its name opens that worktree’s board, and the terminal beside it opens a terminal there in cmux.',
  branch: 'The Git branch checked out in that worktree.',
  agents: 'The agents live in that worktree right now: a Claude Code session with a running process, or a Codex thread an app holds. Sessions that are only resumable are on the worktree’s own board.',
  activity: 'The newest moment anything happened in this worktree: a Claude Code status change, a Codex thread update, or an item file written.',
}

/** A stage column says what the stage is for and what an empty cell means. */
const stageMeaning = (stage: Stage) =>
  `${stageMeta[stage].hint} An empty cell means there is nothing in it.`

export function WorktreeIndex() {
  const [rows, setRows] = React.useState<readonly WorktreeSummary[] | null>(null)
  const [notice, setNotice] = React.useState<string | null>(null)
  const now = useNow()
  const terminal = useTerminalAvailable()

  const load = React.useCallback(async (signal?: AbortSignal) => {
    try {
      const next = await IndexApi.read(signal)
      if (signal?.aborted) return
      setRows(next)
      setNotice(null)
    } catch (error) {
      if (!signal?.aborted) setNotice(error instanceof Error ? error.message : 'Could not load the sessions')
    }
  }, [])

  React.useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  // The daemon pushes `worktrees` when the set of tracked worktrees changes and
  // `agents` when a Claude session registry or Codex writer lock does; neither
  // carries a payload, so the index reads the rows again. A stream that dropped
  // and came back refetches too, since changes land while it is down and the
  // index otherwise never polls.
  React.useEffect(() => {
    const source = new EventSource(eventsUrl)
    const dropped = { value: false }
    const refetch = () => void load()
    source.addEventListener('agents', refetch)
    source.addEventListener('worktrees', refetch)
    source.addEventListener('error', () => { dropped.value = true })
    source.addEventListener('open', () => {
      if (!dropped.value) return
      dropped.value = false
      refetch()
    })
    return () => source.close()
  }, [load])

  const sourceNotices = agentNotices(rows)

  return (
    <TooltipProvider>
      <div className="min-h-dvh bg-background text-foreground">
        <title>Sessions</title>
        <header className="flex items-center gap-8 border-b px-6 py-5">
          <h1 className="font-medium">
            <Explained meaning="Every worktree the daemon is tracking, and what its session holds. A worktree joins this list when a session is created in it and leaves when that session is gone.">
              Sessions
            </Explained>
          </h1>
        </header>
        {notice ? (
          <Alert variant="destructive" className="mx-6 mt-4 w-auto">
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        ) : null}
        {sourceNotices.length === 0
          ? null
          : <p className="mx-6 mt-4 text-sm text-muted-foreground">{sourceNotices.join(' · ')}</p>}
        <main className="p-6">
          {rows === null ? <LoadingRows /> : rows.length === 0 ? <EmptyState /> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead><Explained meaning={columnMeaning.worktree}>Worktree</Explained></TableHead>
                  <TableHead><Explained meaning={columnMeaning.branch}>Branch</Explained></TableHead>
                  <TableHead><Explained meaning={columnMeaning.agents}>Agents</Explained></TableHead>
                  {stageNames.map(stage => (
                    <TableHead key={stage} className="text-right">
                      <Explained meaning={stageMeaning(stage)} className="inline-flex">
                        {stageMeta[stage].label}
                      </Explained>
                    </TableHead>
                  ))}
                  <TableHead><Explained meaning={columnMeaning.activity}>Activity</Explained></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bandRows(rows, now).map(entry => (
                  <React.Fragment key={entry.band.label}>
                    <TableRow className="hover:bg-transparent">
                      <TableCell
                        colSpan={9}
                        className={cn(
                          'bg-muted/40 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground',
                          entry.band.muted && 'opacity-60',
                        )}
                      >
                        {entry.band.label}
                        <span className="ml-2 tabular-nums tracking-normal text-muted-foreground/60">{entry.rows.length}</span>
                      </TableCell>
                    </TableRow>
                    {entry.rows.map(row => (
                      <Row key={row.path} row={row} now={now} muted={entry.band.muted} terminal={terminal} />
                    ))}
                  </React.Fragment>
                ))}
              </TableBody>
            </Table>
          )}
        </main>
      </div>
    </TooltipProvider>
  )
}

/**
 * The name, over the directory it sits in; the whole path stays on hover. A
 * terminal there is one click away whenever the daemon can run cmux.
 */
function NameCell({ row, terminal }: { row: WorktreeSummary; terminal: boolean }) {
  const parent = parentPath(row.path)
  return (
    <TableCell title={row.path}>
      <span className="flex flex-wrap items-center gap-2">
        {row.conflict === null ? (
          <a
            className="rounded-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
            href={`/w/${row.key}/`}
          >
            {row.name}
          </a>
        ) : <span className="font-medium text-muted-foreground">{row.name}</span>}
        <TrailerCount problems={row.trailerProblems} />
        {terminal ? <TerminalAction path={row.path} name={row.name} size="icon-xs" /> : null}
      </span>
      {parent === '' ? null : (
        <span className="block">
          {/* The line is elided; what it copies is the whole path. */}
          <Copyable value={row.path}>
            <span className="text-xs text-muted-foreground">{parent}</span>
          </Copyable>
        </span>
      )}
    </TableCell>
  )
}

function Row({ row, now, muted, terminal }: { row: WorktreeSummary; now: number; muted: boolean; terminal: boolean }) {
  // Dimmed, not disabled: a session with nothing in it recedes, and its name is
  // still the link that opens its board.
  const dim = muted ? 'opacity-60' : undefined
  // A row the daemon cannot serve says so beside its name, and gives the whole
  // rest of the width to the reason rather than filing it under a column.
  if (row.conflict !== null) {
    return (
      <TableRow className={dim}>
        <NameCell row={row} terminal={terminal} />
        <TableCell colSpan={8} className="whitespace-normal wrap-anywhere">
          <span className="flex flex-wrap items-baseline gap-2">
            <Badge variant="destructive" title="Two tracked worktrees want the same address, so this one has no board.">
              Not served
            </Badge>
            <span className="text-muted-foreground">{row.conflict}</span>
          </span>
        </TableCell>
      </TableRow>
    )
  }

  return (
    <TableRow className={dim}>
      <NameCell row={row} terminal={terminal} />
      <TableCell className="text-muted-foreground">
        {row.branch === null
          ? <span title="This folder is not a Git worktree, so it has no branch.">No branch</span>
          : <Copyable value={row.branch}>{row.branch}</Copyable>}
      </TableCell>
      <TableCell><AgentsCell agents={row.agents} now={now} /></TableCell>
      {stageNames.map(stage => (
        <CountCell key={stage} stage={stage} count={row.counts[stage]} executing={row.executing} />
      ))}
      <TableCell className="text-muted-foreground">
        <ActivityCell activity={row.activity} now={now} />
      </TableCell>
    </TableRow>
  )
}

/**
 * How much is in one stage, and, in Execute, which batch it is. A count of zero
 * renders nothing at all: a column of zeroes is a column of nothing to do, and
 * the five of them read as a pipeline by what is actually in them.
 */
function CountCell({ stage, count, executing }: { stage: Stage; count: number; executing: string | null }) {
  const batch = stage === 'EXECUTE' ? executing : null
  return (
    <TableCell className="text-right">
      <span className="flex items-center justify-end gap-2">
        {batch === null ? null : (
          <Explained meaning="The batch in Execute.">
            <Badge variant="secondary">{batch}</Badge>
          </Explained>
        )}
        {count === 0 ? null : <span className="tabular-nums text-foreground">{count}</span>}
      </span>
    </TableCell>
  )
}

/** The shape the table will take, so the first paint is not a single slab. */
function LoadingRows() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-8" />
      {skeletonRows.map(row => <Skeleton key={row} className="h-10" />)}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="py-20 text-center text-sm text-muted-foreground">
      <p>No sessions yet.</p>
      <p className="mt-2">
        Run <code className="rounded bg-muted px-1.5 py-0.5 font-mono">session open</code> in a worktree to add it.
      </p>
    </div>
  )
}
