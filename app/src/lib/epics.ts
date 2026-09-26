import type { WorktreeSummary } from '../../contract'
import type { AcrossSection, Dashboard, ProjectSection } from './dashboard'
import { acrossName, epicCardsOf, sectionRowOf } from './dashboard'
import type { Marker } from './order'
import { epicList, landingAt, sectionsList } from './order'

/**
 * How the index's drags change epics and order: what is held, what it is over,
 * what dropping it there would do and the words it carries saying so, and the
 * epics a write is putting worktrees in, drawn until it lands. An epic is only
 * the name its worktrees' files share, and an order only the ranks their files
 * hold, so nothing here is kept: every outcome is read from the rows drawn
 * when the card was dropped.
 */

/**
 * A write under way: the epic a worktree is to be in, null for none, and
 * whether it keeps its rank there, which only a rename to a name no other
 * epic has does.
 */
export type EpicWriting = { readonly epic: string | null; readonly keepsRank: boolean }

/**
 * The rows with the epics a write is putting them in, drawn while it is
 * written, as a board draws a move until it lands, so nothing jumps back
 * before the daemon's answer does. A worktree that is not a main one loses
 * its rank with the move unless it keeps it, as the engine takes it away.
 */
export function withEpics({ rows, epics }: {
  readonly rows: readonly WorktreeSummary[]
  /** Each worktree being written, by its path. */
  readonly epics: ReadonlyMap<string, EpicWriting>
}): readonly WorktreeSummary[] {
  if (epics.size === 0) return rows
  return rows.map((row) => {
    const write = epics.get(row.path)
    if (write === undefined) return row
    return { ...row, epic: write.epic, rank: row.main || write.keepsRank ? row.rank : null }
  })
}

/**
 * Whether a row can be dragged: every worktree the index lists can, a row
 * the daemon does not serve included, since the epic route takes a worktree
 * by its path; a main worktree cannot, since it is never in an epic.
 */
export const movable = (row: WorktreeSummary) => !row.main

/**
 * What is held: one worktree, by its row; a whole epic, by its card's
 * heading; or a project, by its head, which is its main worktree's row.
 */
export type Dragged =
  | { readonly kind: 'row'; readonly path: string }
  | { readonly kind: 'epic'; readonly name: string }
  | { readonly kind: 'head'; readonly path: string }

/**
 * What a held thing is over: an epic's card, a worktree's row inside one, a
 * card of one worktree in no epic, the `+` drawn after its repository's cards
 * while a worktree is held, the space between and below the cards, or, while
 * a project is held, a project's section, the one across projects included.
 */
export type DropTarget =
  | { readonly kind: 'epic'; readonly name: string }
  | { readonly kind: 'member'; readonly path: string }
  | { readonly kind: 'loose'; readonly path: string }
  | { readonly kind: 'section'; readonly key: string }
  | { readonly kind: 'new' }
  | { readonly kind: 'space' }

/** What is held, what it is over, and whether the pointer is below the middle of what it is over. */
export type Holding = { readonly dragged: Dragged; readonly target: DropTarget | null; readonly below: boolean }

/**
 * What a drop does: worktrees join an epic, one epic's worktrees all joining
 * another's when it is a whole card that was dropped; a worktree makes an
 * epic, with the worktree in no epic it was dropped on or alone on the `+`,
 * once it is named; a worktree leaves its epic; or a worktree takes a place
 * among its siblings, before the one named or last among the ranked, with the
 * line that shows where and the words that say it.
 */
export type DropOutcome =
  | { readonly kind: 'join'; readonly epic: string; readonly paths: readonly string[]; readonly merge: boolean }
  | { readonly kind: 'make'; readonly paths: readonly [string] | readonly [string, string] }
  | { readonly kind: 'leave'; readonly epic: string; readonly path: string }
  | {
    readonly kind: 'order'
    readonly path: string
    readonly before: string | null
    readonly after: readonly string[]
    readonly marker: Marker
    readonly words: string
  }

/** The epic a card or a row inside one stands for, as drawn. */
function epicAt(rows: readonly WorktreeSummary[], target: DropTarget): string | null {
  if (target.kind === 'epic') return target.name
  if (target.kind !== 'member') return null
  const row = rows.find((candidate) => candidate.path === target.path)
  return row === undefined || row.main ? null : row.epic
}

/** Where a held section lands, over another by its upper or lower half, as the sections are drawn. */
function sectionLanding({ dashboard, path, key, below }: {
  readonly dashboard: Dashboard
  readonly path: string
  readonly key: string
  readonly below: boolean
}): DropOutcome | null {
  const entries = dashboard.sections
  const held = entries.find((section) => sectionRowOf(section)?.path === path)
  const over = entries.find((section) => section.key === key)
  if (held === undefined || over === undefined || over === held) return null
  const others = entries.filter((section) => section !== held)
  const landing = landingAt<ProjectSection | AcrossSection>({
    list: sectionsList,
    entries,
    held,
    slot: others.indexOf(over) + (below ? 1 : 0),
    idOf: (section) => section.key,
    pathOf: (section) => sectionRowOf(section)?.path ?? null,
    rankOf: (section) => sectionRowOf(section)?.rank ?? null,
    nameOf: (section) => (section.kind === 'across' ? acrossName : section.name),
  })
  return landing === null ? null : { kind: 'order', path, ...landing }
}

/**
 * Where a worktree held inside its own epic's card lands: over another of its
 * worktrees by its upper or lower half, and over the card's heading first.
 */
function memberLanding({ dashboard, row, epic, target, below }: {
  readonly dashboard: Dashboard
  readonly row: WorktreeSummary
  readonly epic: string
  readonly target: DropTarget
  readonly below: boolean
}): DropOutcome | null {
  const entries = epicCardsOf(dashboard).find((card) => card.name === epic)?.rows ?? []
  const held = entries.find((entry) => entry.path === row.path)
  if (held === undefined || (target.kind === 'member' && target.path === row.path)) return null
  const others = entries.filter((entry) => entry !== held)
  const over = target.kind === 'member' ? others.findIndex((entry) => entry.path === target.path) : -1
  const landing = landingAt({
    list: epicList(epic),
    entries,
    held,
    slot: over === -1 ? 0 : over + (below ? 1 : 0),
    idOf: (entry) => entry.path,
    pathOf: (entry) => entry.path,
    rankOf: (entry) => entry.rank,
    nameOf: (entry) => entry.name,
  })
  return landing === null ? null : { kind: 'order', path: row.path, ...landing }
}

/**
 * What dropping this here would do, or null when it would change nothing: a
 * worktree onto its own card, a place it already has, an epic onto itself, a
 * project onto itself or into the place it already has, or a worktree in no
 * epic onto the space it is already in. A worktree held within its own
 * epic's card takes a place among its worktrees; anywhere else it keeps the
 * meaning a drop has always had.
 */
export function dropOutcome({ rows, dashboard, holding }: {
  readonly rows: readonly WorktreeSummary[]
  readonly dashboard: Dashboard
  readonly holding: Holding
}): DropOutcome | null {
  const { dragged, target, below } = holding
  if (target === null) return null
  if (dragged.kind === 'head') {
    return target.kind === 'section' ? sectionLanding({ dashboard, path: dragged.path, key: target.key, below }) : null
  }
  const into = epicAt(rows, target)
  if (dragged.kind === 'epic') {
    if (into === null || into === dragged.name) return null
    const paths = rows.filter((row) => !row.main && row.epic === dragged.name).map((row) => row.path)
    return paths.length === 0 ? null : { kind: 'join', epic: into, paths, merge: true }
  }
  const row = rows.find((candidate) => candidate.path === dragged.path)
  if (row === undefined || target.kind === 'section') return null
  if (into !== null) {
    return row.epic === into
      ? memberLanding({ dashboard, row, epic: into, target, below })
      : { kind: 'join', epic: into, paths: [row.path], merge: false }
  }
  if (target.kind === 'loose') return target.path === row.path ? null : { kind: 'make', paths: [row.path, target.path] }
  if (target.kind === 'new') return { kind: 'make', paths: [row.path] }
  return row.epic === null ? null : { kind: 'leave', epic: row.epic, path: row.path }
}

/**
 * The target a drop outlines, the card or the space it would land in, by its
 * id; null for a placement, which draws a line where it lands instead.
 */
export function outlinedBy({ outcome, target }: { readonly outcome: DropOutcome; readonly target: DropTarget }): string | null {
  if (outcome.kind === 'order') return null
  // A worktree dropped on a row inside another epic's card joins that card's epic, so the card is what is outlined.
  return outcome.kind === 'join' ? targetId({ kind: 'epic', name: outcome.epic }) : targetId(target)
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
  if (outcome.kind === 'order') return outcome.words
  return newEpicWords({ outcome, rows })
}

/**
 * The ids dnd-kit knows each thing by, made from what it is, so a drag's
 * source and target read back as what they stand for. A path or a name after
 * the first colon is kept whole, colons and all.
 */
export const draggedId = (dragged: Dragged) => (dragged.kind === 'epic' ? `epic:${dragged.name}` : `${dragged.kind}:${dragged.path}`)

export const targetId = (target: DropTarget) => {
  switch (target.kind) {
    case 'space':
    case 'new': {
      return target.kind
    }
    case 'epic': {
      return `into:${target.name}`
    }
    case 'section': {
      return `section:${target.key}`
    }
    case 'member': {
      return `member:${target.path}`
    }
    case 'loose': {
      return `onto:${target.path}`
    }
  }
}

const splitId = (id: unknown): readonly [string, string] | null => {
  if (typeof id !== 'string') return null
  const colon = id.indexOf(':')
  return colon === -1 ? null : [id.slice(0, colon), id.slice(colon + 1)]
}

export function draggedOf(id: unknown): Dragged | null {
  const parts = splitId(id)
  if (parts?.[0] === 'row') return { kind: 'row', path: parts[1] }
  if (parts?.[0] === 'head') return { kind: 'head', path: parts[1] }
  return parts?.[0] === 'epic' ? { kind: 'epic', name: parts[1] } : null
}

export function targetOf(id: unknown): DropTarget | null {
  if (id === 'space') return { kind: 'space' }
  if (id === 'new') return { kind: 'new' }
  const parts = splitId(id)
  switch (parts?.[0]) {
    case 'into': {
      return { kind: 'epic', name: parts[1] }
    }
    case 'member': {
      return { kind: 'member', path: parts[1] }
    }
    case 'section': {
      return { kind: 'section', key: parts[1] }
    }
    case 'onto': {
      return { kind: 'loose', path: parts[1] }
    }
    default: {
      return null
    }
  }
}
