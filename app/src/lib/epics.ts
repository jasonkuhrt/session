import type { WorktreeSummary } from '../../contract'

/**
 * How the index's drags change epics: what is held, what it is over, what
 * dropping it there would do and the words it carries saying so, and the
 * epics a write is putting worktrees in, drawn until it lands. An epic is
 * only the name its worktrees' files share, so nothing here is kept: every
 * outcome is read from the rows drawn when the card was dropped.
 */

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
 * Whether a row can be dragged: every worktree the index lists can, a row
 * the daemon does not serve included, since the epic route takes a worktree
 * by its path; a main worktree cannot, since it is never in an epic.
 */
export const movable = (row: WorktreeSummary) => !row.main

/** What is held: one worktree, by its row, or a whole epic, by its card's heading. */
export type Dragged = { readonly kind: 'row'; readonly path: string } | { readonly kind: 'epic'; readonly name: string }

/**
 * What a held thing is over: an epic's card, a card of one worktree in no
 * epic, the `+` drawn after its repository's cards while a worktree is held,
 * or the space between and below the cards.
 */
export type DropTarget =
  | { readonly kind: 'epic'; readonly name: string }
  | { readonly kind: 'loose'; readonly path: string }
  | { readonly kind: 'new' }
  | { readonly kind: 'space' }

/**
 * What a drop does: worktrees join an epic, one epic's worktrees all joining
 * another's when it is a whole card that was dropped; a worktree makes an
 * epic, with the worktree in no epic it was dropped on or alone on the `+`,
 * once it is named; or a worktree leaves its epic.
 */
export type DropOutcome =
  | { readonly kind: 'join'; readonly epic: string; readonly paths: readonly string[]; readonly merge: boolean }
  | { readonly kind: 'make'; readonly paths: readonly [string] | readonly [string, string] }
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
  if (target.kind === 'new') return { kind: 'make', paths: [row.path] }
  return row.epic === null ? null : { kind: 'leave', epic: row.epic, path: row.path }
}

/**
 * The words over a held card that would make a new epic: the worktree it would
 * be made with, when it is dropped on another, or the one it would be made of,
 * alone on the `+`.
 */
function newEpicWords({ outcome, rows }: {
  readonly outcome: Extract<DropOutcome, { kind: 'make' }>
  readonly rows: readonly WorktreeSummary[]
}) {
  const nameAt = (path: string) => rows.find((row) => row.path === path)?.name ?? 'this worktree'
  return outcome.paths.length === 1
    ? `New epic of ${nameAt(outcome.paths[0])}`
    : `New epic with ${nameAt(outcome.paths[1])}`
}

/** What a drop will do, in the few words the held card carries while it is over its target. */
export function outcomeWords({ outcome, rows }: { readonly outcome: DropOutcome; readonly rows: readonly WorktreeSummary[] }) {
  if (outcome.kind === 'join') return outcome.merge ? `Merge into “${outcome.epic}”` : `Join “${outcome.epic}”`
  if (outcome.kind === 'leave') return `Leave “${outcome.epic}”`
  return newEpicWords({ outcome, rows })
}

/**
 * The ids dnd-kit knows each thing by, made from what it is, so a drag's
 * source and target read back as what they stand for. A path or a name after
 * the first colon is kept whole, colons and all.
 */
export const draggedId = (dragged: Dragged) => (dragged.kind === 'row' ? `row:${dragged.path}` : `epic:${dragged.name}`)

export const targetId = (target: DropTarget) => {
  if (target.kind === 'space' || target.kind === 'new') return target.kind
  return target.kind === 'epic' ? `into:${target.name}` : `onto:${target.path}`
}

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
  if (id === 'new') return { kind: 'new' }
  const parts = splitId(id)
  if (parts?.[0] === 'into') return { kind: 'epic', name: parts[1] }
  return parts?.[0] === 'onto' ? { kind: 'loose', path: parts[1] } : null
}
