/**
 * How a value is rendered for a person to read. The index and the board share
 * these so the same value never reads two ways on two surfaces.
 */

const minute = 60_000

/** One hour in milliseconds: what the age labels and the index's freshness bands both count in. */
export const hour = 60 * minute

const day = 24 * hour
const week = 7 * day

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

/** The exact local date and time, for the hover behind an age. */
export function absoluteTime(iso: string): string {
  const at = Date.parse(iso)
  return Number.isNaN(at) ? iso : new Date(at).toLocaleString()
}

/**
 * The directory a worktree sits in, elided from the front to its last two
 * segments. Enough to tell two worktrees of the same name apart without
 * spending a line on an absolute path; the full path stays on hover.
 */
export function parentPath(path: string): string {
  const segments = path.split('/').slice(0, -1).filter((segment) => segment !== '')
  if (segments.length === 0) return ''
  const tail = segments.slice(-2)
  return `${segments.length > tail.length ? '…/' : '/'}${tail.join('/')}`
}
