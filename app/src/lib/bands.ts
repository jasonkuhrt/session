import type { WorktreeSummary } from '../../contract'
import { hour } from './format'

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

/** The index's rows split by band, newest first inside each; empty bands are dropped. */
export function bandRows({ rows, now }: { readonly rows: readonly WorktreeSummary[]; readonly now: number }) {
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
