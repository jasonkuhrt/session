import { RefreshCw } from 'lucide-react'
import * as React from 'react'

import type { WorktreeSummary } from '../contract'
import { stageNames } from '../contract'
import { Badge } from './components/ui/badge'
import { Button } from './components/ui/button'
import { Skeleton } from './components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './components/ui/table'
import { IndexApi } from './lib/api'
import { stageMeta } from './lib/workflow'

const changedAt = (iso: string | null) => (iso === null ? '—' : new Date(iso).toLocaleString())

const hour = 3_600_000

/** Freshness bands, in order; a row lands in the first band it fits. */
const bands = [
  { label: 'Changed in the last 24 hours', within: 24 * hour },
  { label: 'Changed in the last 5 days', within: 5 * 24 * hour },
  { label: 'Older', within: Number.POSITIVE_INFINITY },
] as const

const ageOf = (row: WorktreeSummary, now: number) =>
  row.lastChange === null ? Number.POSITIVE_INFINITY : now - Date.parse(row.lastChange)

/** Rows split by band, newest first inside each; empty bands are dropped. */
function bandRows(rows: readonly WorktreeSummary[]) {
  const now = Date.now()
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

export function WorktreeIndex() {
  const [rows, setRows] = React.useState<readonly WorktreeSummary[] | null>(null)
  const [notice, setNotice] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)

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
      <header className="flex items-center gap-8 border-b px-6 py-5">
        <h1 className="font-medium">Sessions</h1>
        <Button variant="outline" size="sm" className="ml-auto" disabled={pending} onClick={refresh}>
          <RefreshCw /> {pending ? 'Refreshing…' : 'Refresh'}
        </Button>
      </header>
      {notice ? (
        <p role="alert" className="mx-6 mt-4 rounded-lg border border-destructive bg-muted p-3 text-sm">{notice}</p>
      ) : null}
      <main className="p-6">
        {rows === null ? <Skeleton className="h-40" /> : rows.length === 0 ? <EmptyState /> : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Session</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead>Running</TableHead>
                {stageNames.map(stage => (
                  <TableHead key={stage} className="text-right">{stageMeta[stage].label}</TableHead>
                ))}
                <TableHead>Last change</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bandRows(rows).map(entry => (
                <React.Fragment key={entry.band.label}>
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={9} className="bg-muted/40 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {entry.band.label} · {entry.rows.length}
                    </TableCell>
                  </TableRow>
                  {entry.rows.map(row => <Row key={row.path} row={row} />)}
                </React.Fragment>
              ))}
            </TableBody>
          </Table>
        )}
      </main>
    </div>
  )
}

function Row({ row }: { row: WorktreeSummary }) {
  if (row.conflict !== null) {
    return (
      <TableRow>
        <TableCell className="text-muted-foreground">{row.name}</TableCell>
        <TableCell colSpan={7} className="whitespace-normal text-muted-foreground">{row.conflict}</TableCell>
        <TableCell title={row.path} className="text-muted-foreground">Not served</TableCell>
      </TableRow>
    )
  }

  return (
    <TableRow>
      <TableCell title={row.path}>
        <a className="font-medium underline-offset-4 hover:underline" href={`/w/${row.key}/`}>{row.name}</a>
      </TableCell>
      <TableCell className="text-muted-foreground">{row.branch ?? 'No branch'}</TableCell>
      <TableCell>
        {row.running === null
          ? <span className="text-muted-foreground">Idle</span>
          : <Badge variant="secondary">{row.running.batch} · {row.running.items}</Badge>}
      </TableCell>
      {stageNames.map(stage => (
        <TableCell key={stage} className="text-right tabular-nums text-muted-foreground">
          {row.counts[stage]}
        </TableCell>
      ))}
      <TableCell className="text-muted-foreground">{changedAt(row.lastChange)}</TableCell>
    </TableRow>
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
