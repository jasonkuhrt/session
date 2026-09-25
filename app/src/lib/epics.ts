import type { WorktreeSummary } from '../../contract'
import { isLive } from './agents'
import { hour } from './format'

/**
 * How the index draws the worktrees it lists: the main worktrees pinned in a
 * strip, and below them cards, one per epic with its worktrees inside and one
 * per worktree in none, ordered by what is happening in them. An epic is only
 * the name its worktrees' files share, so it exists while one names it, and
 * everything here is derived from the rows on every read: no order and no fold
 * is kept anywhere.
 */

/** Nothing live and nothing for this long makes a worktree quiet, drawn dim and last: the bound the index's activity bands used. */
const quietAfter = 5 * 24 * hour

/** Whether an agent is live in a worktree, as its pills say: a Claude Code session with a process, or a Codex thread an app holds. */
export const hasLiveAgent = (row: WorktreeSummary) =>
  row.agents.claude.some(isLive) || row.agents.codex.some((thread) => thread.loaded === true)

/** When anything last happened in a worktree, in epoch milliseconds; null when nothing has. */
const activityAt = (row: WorktreeSummary): number | null => {
  if (row.activity === null) return null
  const at = Date.parse(row.activity.at)
  return Number.isNaN(at) ? null : at
}

/** What is happening in some worktrees together: whether any has a live agent, the newest moment, and whether that makes them quiet. */
type Standing = { readonly live: boolean; readonly latest: number | null; readonly quiet: boolean }

const standingOf = (rows: readonly WorktreeSummary[], now: number): Standing => {
  const live = rows.some((row) => hasLiveAgent(row))
  const moments = rows.flatMap((row) => {
    const at = activityAt(row)
    return at === null ? [] : [at]
  })
  const latest = moments.length === 0 ? null : Math.max(...moments)
  return { live, latest, quiet: !live && (latest === null || now - latest > quietAfter) }
}

/**
 * What is happening first: anything not quiet before anything quiet, a live
 * agent before none, then the newest moment first. A name settles a tie, so
 * two reads of the same rows always draw the same order.
 */
const busierFirst = (
  left: { readonly standing: Standing; readonly name: string },
  right: { readonly standing: Standing; readonly name: string },
) => {
  if (left.standing.quiet !== right.standing.quiet) return left.standing.quiet ? 1 : -1
  if (left.standing.live !== right.standing.live) return left.standing.live ? -1 : 1
  if (left.standing.latest !== right.standing.latest) {
    if (left.standing.latest === null) return 1
    if (right.standing.latest === null) return -1
    return right.standing.latest - left.standing.latest
  }
  return left.name.localeCompare(right.name)
}

/** A main worktree as the strip draws it. */
export type MainTile = { readonly row: WorktreeSummary; readonly quiet: boolean }

/** A card below the strip: an epic and its worktrees, busiest first, or one worktree in no epic. */
export type IndexCard =
  | { readonly kind: 'epic'; readonly name: string; readonly rows: readonly WorktreeSummary[]; readonly quiet: boolean }
  | { readonly kind: 'loose'; readonly row: WorktreeSummary; readonly quiet: boolean }

/** The index as it is drawn. */
export type Dashboard = { readonly mains: readonly MainTile[]; readonly cards: readonly IndexCard[] }

/**
 * The strip and the cards for these rows. A main worktree is never in an
 * epic, so it goes in the strip whatever its file says, by name, since the
 * strip stays put; every other worktree goes in its epic's card, or in a card
 * of its own.
 */
export function dashboardOf({ rows, now }: { readonly rows: readonly WorktreeSummary[]; readonly now: number }): Dashboard {
  const mains = rows
    .filter((row) => row.main)
    .toSorted((left, right) => left.name.localeCompare(right.name))
    .map((row) => ({ row, quiet: standingOf([row], now).quiet }))
  const members = new Map<string, WorktreeSummary[]>()
  const loose: WorktreeSummary[] = []
  for (const row of rows) {
    if (row.main) continue
    if (row.epic === null) loose.push(row)
    else members.set(row.epic, [...(members.get(row.epic) ?? []), row])
  }
  const rowOrder = (left: WorktreeSummary, right: WorktreeSummary) =>
    busierFirst({ standing: standingOf([left], now), name: left.name }, { standing: standingOf([right], now), name: right.name })
  const epics = [...members].map(([name, epicRows]) => {
    const standing = standingOf(epicRows, now)
    const card: IndexCard = { kind: 'epic', name, rows: epicRows.toSorted(rowOrder), quiet: standing.quiet }
    return { card, standing, name }
  })
  const singles = loose.map((row) => {
    const standing = standingOf([row], now)
    const card: IndexCard = { kind: 'loose', row, quiet: standing.quiet }
    return { card, standing, name: row.name }
  })
  return { mains, cards: [...epics, ...singles].toSorted(busierFirst).map((entry) => entry.card) }
}

/**
 * The rows with the epics a write is putting them in, drawn while it is
 * written, as a board draws a move until it lands, so nothing jumps back
 * before the daemon's answer does.
 */
export function withEpics({ rows, epics }: {
  readonly rows: readonly WorktreeSummary[]
  /** The epic each worktree being written is to be in, by its path; null for none. */
  readonly epics: ReadonlyMap<string, string | null>
}): readonly WorktreeSummary[] {
  if (epics.size === 0) return rows
  const drawn: WorktreeSummary[] = []
  for (const row of rows) drawn.push(epics.has(row.path) ? { ...row, epic: epics.get(row.path) ?? null } : row)
  return drawn
}

/**
 * Whether the index can write a row's epic. The route takes the key a row is
 * listed under, and only the worktree that owns the key answers to it, so a
 * row not served because another row holds its key has none of its own to be
 * reached by. Any other row can be, one not served for another reason too.
 */
export const reachable = ({ row, rows }: { readonly row: WorktreeSummary; readonly rows: readonly WorktreeSummary[] }) =>
  row.conflict === null || !rows.some((other) => other.path !== row.path && other.key === row.key)

/** Whether a row can be dragged: a main worktree is never in an epic, so it stays pinned. */
export const movable = ({ row, rows }: { readonly row: WorktreeSummary; readonly rows: readonly WorktreeSummary[] }) =>
  !row.main && reachable({ row, rows })

/** What is held: one worktree, by its row, or a whole epic, by its card's heading. */
export type Dragged = { readonly kind: 'row'; readonly path: string } | { readonly kind: 'epic'; readonly name: string }

/** What a held thing is over: an epic's card, a card of one worktree in no epic, or the space between and below the cards. */
export type DropTarget =
  | { readonly kind: 'epic'; readonly name: string }
  | { readonly kind: 'loose'; readonly path: string }
  | { readonly kind: 'space' }

/**
 * What a drop does: worktrees join an epic, one epic's worktrees all joining
 * another's when it is a whole card that was dropped; two worktrees in no
 * epic make one, once it is named; or a worktree leaves its epic.
 */
export type DropOutcome =
  | { readonly kind: 'join'; readonly epic: string; readonly paths: readonly string[]; readonly merge: boolean }
  | { readonly kind: 'make'; readonly paths: readonly [string, string] }
  | { readonly kind: 'leave'; readonly epic: string; readonly path: string }

/**
 * What dropping this here would do, or null when it would change nothing: a
 * worktree onto its own epic or its own card, an epic onto itself, or a
 * worktree in no epic onto the space it is already in.
 */
export function dropOutcome({ rows, dragged, target }: {
  readonly rows: readonly WorktreeSummary[]
  readonly dragged: Dragged
  readonly target: DropTarget | null
}): DropOutcome | null {
  if (target === null) return null
  if (dragged.kind === 'epic') {
    if (target.kind !== 'epic' || target.name === dragged.name) return null
    const paths = rows.filter((row) => !row.main && row.epic === dragged.name).map((row) => row.path)
    return paths.length === 0 ? null : { kind: 'join', epic: target.name, paths, merge: true }
  }
  const row = rows.find((candidate) => candidate.path === dragged.path)
  if (row === undefined) return null
  if (target.kind === 'epic') {
    return row.epic === target.name ? null : { kind: 'join', epic: target.name, paths: [row.path], merge: false }
  }
  if (target.kind === 'loose') return target.path === row.path ? null : { kind: 'make', paths: [row.path, target.path] }
  return row.epic === null ? null : { kind: 'leave', epic: row.epic, path: row.path }
}

/** What a drop will do, in the few words the held card carries while it is over its target. */
export function outcomeWords({ outcome, rows }: { readonly outcome: DropOutcome; readonly rows: readonly WorktreeSummary[] }) {
  if (outcome.kind === 'join') return outcome.merge ? `Merge into “${outcome.epic}”` : `Join “${outcome.epic}”`
  if (outcome.kind === 'leave') return `Leave “${outcome.epic}”`
  const other = rows.find((row) => row.path === outcome.paths[1])
  return `New epic with ${other?.name ?? 'this worktree'}`
}

/**
 * The ids dnd-kit knows each thing by, made from what it is, so a drag's
 * source and target read back as what they stand for. A path or a name after
 * the first colon is kept whole, colons and all.
 */
export const draggedId = (dragged: Dragged) => (dragged.kind === 'row' ? `row:${dragged.path}` : `epic:${dragged.name}`)

export const targetId = (target: DropTarget) =>
  target.kind === 'space' ? 'space' : target.kind === 'epic' ? `into:${target.name}` : `onto:${target.path}`

const splitId = (id: unknown): readonly [string, string] | null => {
  if (typeof id !== 'string') return null
  const colon = id.indexOf(':')
  return colon === -1 ? null : [id.slice(0, colon), id.slice(colon + 1)]
}

export function draggedOf(id: unknown): Dragged | null {
  const parts = splitId(id)
  if (parts?.[0] === 'row') return { kind: 'row', path: parts[1] }
  return parts?.[0] === 'epic' ? { kind: 'epic', name: parts[1] } : null
}

export function targetOf(id: unknown): DropTarget | null {
  if (id === 'space') return { kind: 'space' }
  const parts = splitId(id)
  if (parts?.[0] === 'into') return { kind: 'epic', name: parts[1] }
  return parts?.[0] === 'onto' ? { kind: 'loose', path: parts[1] } : null
}
