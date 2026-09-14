import { RefreshCw } from 'lucide-react'
import * as React from 'react'

import type { WorktreeSummary } from '../contract'
import { stageNames } from '../contract'
import { Badge } from './components/ui/badge'
import { Button } from './components/ui/button'
import { Skeleton } from './components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './components/ui/table'
import { IndexApi } from './lib/api'
import { absoluteTime, hour, parentPath, relativeTime } from './lib/format'
import { cn } from './lib/utils'
import { stageMeta } from './lib/workflow'

/** Freshness bands, in order; a row lands in the first band it fits. */
const bands = [
  { label: 'Changed in the last 24 hours', within: 24 * hour },
  { label: 'Changed in the last 5 days', within: 5 * 24 * hour },
  { label: 'Older', within: Number.POSITIVE_INFINITY },
] as const

const ageOf = (row: WorktreeSummary, now: number) =>
  row.lastChange === null ? Number.POSITIVE_INFINITY : now - Date.parse(row.lastChange)

/** Rows split by band, newest first inside each; empty bands are dropped. */
function bandRows(rows: readonly WorktreeSummary[], now: number) {
  const buckets = bands.map(band => ({ band, rows: [] as WorktreeSummary[] }))
  for (const row of rows) {
    const age = ageOf(row, now)
    // The last band is unbounded, so every row lands somewhere.
    const bucket = buckets.find(candidate => age <= candidate.band.within) ?? buckets.at(-1)
    bucket?.rows.push(row)
  }
  for (const bucket of buckets) bucket.rows.sort((left, right) => ageOf(left, now) - ageOf(right, now))
  return buckets.filter(bucket => bucket.rows.length > 0)
}

/**
 * One clock for the page, moved once a minute. The ages in the rows and the
 * bands they are grouped under are read off the same value, so they can never
 * disagree about which side of a boundary a row is on.
 */
function useNow() {
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}

const skeletonRows = [1, 2, 3, 4, 5]

export function WorktreeIndex() {
  const [rows, setRows] = React.useState<readonly WorktreeSummary[] | null>(null)
  const [notice, setNotice] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)
  const now = useNow()

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

  const refresh = async () => {
    setPending(true)
    setNotice(null)
    try {
      await IndexApi.refresh()
      await load()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The refresh failed')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <title>Sessions</title>
      <header className="flex items-center gap-8 border-b px-6 py-5">
        <h1 className="font-medium">Sessions</h1>
        <Button variant="outline" size="sm" className="ml-auto" disabled={pending} onClick={refresh}>
          <RefreshCw className={cn(pending && 'animate-spin')} /> {pending ? 'Refreshing…' : 'Refresh'}
        </Button>
      </header>
      {notice ? (
        <p role="alert" className="mx-6 mt-4 rounded-lg border border-destructive bg-muted p-3 text-sm">{notice}</p>
      ) : null}
      <main className="p-6">
        {rows === null ? <LoadingRows /> : rows.length === 0 ? <EmptyState /> : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Worktree</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead>Running</TableHead>
                {stageNames.map(stage => (
                  <TableHead key={stage} className="text-right">{stageMeta[stage].label}</TableHead>
                ))}
                <TableHead>Last change</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bandRows(rows, now).map(entry => (
                <React.Fragment key={entry.band.label}>
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={9} className="bg-muted/40 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {entry.band.label}
                      <span className="ml-2 tabular-nums tracking-normal text-muted-foreground/60">{entry.rows.length}</span>
                    </TableCell>
                  </TableRow>
                  {entry.rows.map(row => <Row key={row.path} row={row} now={now} />)}
                </React.Fragment>
              ))}
            </TableBody>
          </Table>
        )}
      </main>
    </div>
  )
}

/** The name, over the directory it sits in; the whole path stays on hover. */
function NameCell({ row }: { row: WorktreeSummary }) {
  const parent = parentPath(row.path)
  return (
    <TableCell title={row.path}>
      {row.conflict === null ? (
        <a
          className="rounded-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          href={`/w/${row.key}/`}
        >
          {row.name}
        </a>
      ) : <span className="font-medium text-muted-foreground">{row.name}</span>}
      {parent === '' ? null : <span className="block text-xs text-muted-foreground">{parent}</span>}
    </TableCell>
  )
}

function Row({ row, now }: { row: WorktreeSummary; now: number }) {
  // A row the daemon cannot serve says so beside its name, and gives the whole
  // rest of the width to the reason rather than filing it under a column.
  if (row.conflict !== null) {
    return (
      <TableRow>
        <NameCell row={row} />
        <TableCell colSpan={8} className="whitespace-normal wrap-anywhere">
          <span className="flex flex-wrap items-baseline gap-2">
            <Badge variant="destructive">Not served</Badge>
            <span className="text-muted-foreground">{row.conflict}</span>
          </span>
        </TableCell>
      </TableRow>
    )
  }

  return (
    <TableRow>
      <NameCell row={row} />
      <TableCell className="text-muted-foreground">{row.branch ?? 'No branch'}</TableCell>
      <TableCell>
        {row.running === null ? <span className="text-muted-foreground">—</span> : (
          <span className="flex items-center gap-2">
            <Badge variant="secondary">{row.running.batch}</Badge>
            <span className="text-xs text-muted-foreground">
              {row.running.items} {row.running.items === 1 ? 'item' : 'items'}
            </span>
          </span>
        )}
      </TableCell>
      {stageNames.map(stage => (
        <TableCell
          key={stage}
          className={cn('text-right tabular-nums', row.counts[stage] === 0 ? 'text-muted-foreground/40' : 'text-foreground')}
        >
          {row.counts[stage]}
        </TableCell>
      ))}
      <TableCell className="text-muted-foreground">
        {row.lastChange === null
          ? '—'
          : <span title={absoluteTime(row.lastChange)}>{relativeTime(row.lastChange, now)}</span>}
      </TableCell>
    </TableRow>
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
