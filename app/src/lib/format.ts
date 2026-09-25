/**
 * How a value is rendered for a person to read. The index and the board share
 * these so the same value never reads two ways on two surfaces.
 */

const minute = 60_000

/** One hour in milliseconds: what the age labels and the index's freshness bands both count in. */
export const hour = 60 * minute

const day = 24 * hour
const week = 7 * day

/**
 * How long something has held the way it is, as a bare duration: the row says
 * what state it is in, and this says how long it has been in it. Days keep
 * counting past a week, because `9 d` is the fact a reader needs where a date
 * would make them do the subtraction.
 */
export function since(iso: string, now: number): string {
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return iso
  const age = Math.max(now - at, 0)
  if (age < minute) return '<1 min'
  if (age < hour) return `${Math.floor(age / minute)} min`
  if (age < day) return `${Math.floor(age / hour)} h`
  return `${Math.floor(age / day)} d`
}

const monthDay = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })
const monthDayYear = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

/**
 * An age, because a session list is about what moved recently: `just now`,
 * `5 min ago`, `3 h ago`, `2 d ago`, then the calendar date, carrying the year
 * only when it is not this one. The caller passes one `now` for the whole
 * render so every row agrees with every other and with the bands they sit in.
 */
export function relativeTime(iso: string, now: number): string {
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return iso
  // A stamp ahead of the clock is not older than now; it just happened.
  const age = Math.max(now - at, 0)
  if (age < minute) return 'just now'
  if (age < hour) return `${Math.floor(age / minute)} min ago`
  if (age < day) return `${Math.floor(age / hour)} h ago`
  if (age < week) return `${Math.floor(age / day)} d ago`
  const stamp = new Date(at)
  return stamp.getFullYear() === new Date(now).getFullYear()
    ? monthDay.format(stamp)
    : monthDayYear.format(stamp)
}

/**
 * A count of tokens at a glance: `950`, `128k`, `1.2M`. A context is read in
 * hundreds of thousands, so the digits every reply changes are left to the tip,
 * which carries the exact count.
 */
export function tokenCount(tokens: number): string {
  if (tokens < 1000) return String(Math.round(tokens))
  const thousands = Math.round(tokens / 1000)
  return thousands < 1000 ? `${thousands}k` : `${(tokens / 1_000_000).toFixed(1)}M`
}

/** The exact local date and time, for the hover behind an age. */
export function absoluteTime(iso: string): string {
  const at = Date.parse(iso)
  return Number.isNaN(at) ? iso : new Date(at).toLocaleString()
}

/**
 * What a worktree has checked out, in Git's words: the branch, a detached
 * HEAD when Git has a commit checked out instead, and no branch outside Git.
 */
export const checkoutLabel = ({ branch, detached }: { readonly branch: string | null; readonly detached: boolean }) =>
  branch ?? (detached ? 'Detached HEAD' : 'No branch')
