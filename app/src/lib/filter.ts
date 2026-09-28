import type { WorktreeSummary } from '../../contract'
import type { ProjectSection } from './dashboard'
import { dashboardOf, sectionKeyOf } from './dashboard'
import { rankedFirst } from './order'

/**
 * What an epic's board and a project's show: the worktrees the filter names,
 * read from the facts the daemon serves on every row of the index, `epic`,
 * `main` and `repository`, and nothing stored of its own. An epic's names the
 * linked worktrees whose sessions name it; a project's names its
 * repository's worktrees, by the path the index heads its section with, or
 * the one folder outside Git that is a project of its own. Either board is a
 * union: the lanes of every worktree in view, each under its worktree's name.
 */
export type UnionFilter = { readonly kind: 'epic'; readonly name: string } | { readonly kind: 'project'; readonly path: string }

/** The board a row's worktree is served under: its key under `/w/`, which every write to its session goes to. */
export const boardOf = (row: Pick<WorktreeSummary, 'key'>) => `/w/${row.key}`

/**
 * Whether a row's key reaches another worktree's board: the daemon serves a
 * key to the worktree that claimed it first, and lists a later worktree of
 * the same name with the conflict that says so, whose key then reaches the
 * first one's board. That is the one row a union does not read. Any other
 * conflict, a session or a Git the daemon cannot read, leaves the board at the
 * row's own key, where whatever can be read still is.
 */
export const keyTaken = ({ row, rows }: { readonly row: WorktreeSummary; readonly rows: readonly WorktreeSummary[] }) =>
  row.conflict !== null && rows.some((other) => other.path !== row.path && other.key === row.key)

/**
 * Whether a row is in the union a filter names: a linked worktree whose
 * session names the epic, since a main worktree is never in one, or any
 * worktree of the project. A row Git could not answer for names no project and
 * no epic, so it is in none.
 */
const inUnion = (filter: UnionFilter, row: WorktreeSummary) =>
  row.resolved && (filter.kind === 'epic' ? !row.main && row.epic === filter.name : sectionKeyOf(row) === filter.path)

const byName = (left: WorktreeSummary, right: WorktreeSummary) => left.name.localeCompare(right.name)

/** An epic's worktrees as its card on the index places them by hand, the ranked ones first, then the rest by name. */
const epicOrder = rankedFirst<WorktreeSummary>({ rankOf: (row) => row, otherwise: byName })

/** A project's worktrees: its main worktree first, as it heads the project on the index, then the rest by name. */
const projectOrder = (left: WorktreeSummary, right: WorktreeSummary) =>
  left.main === right.main ? byName(left, right) : left.main ? -1 : 1

/**
 * A union as its board draws it: the name its header carries, and the
 * worktrees in view in the order every lane and the ledger stand them in.
 * What is happening in them does not order them, as it orders the index: a
 * write on the board is itself activity, and would move every lane's
 * worktrees under the card just put down.
 */
type Union = {
  /** The epic's own name, or the name the index heads the project's section with. */
  readonly name: string
  /** Every worktree in view, served or not: one the daemon does not serve says why instead of drawing lanes. */
  readonly rows: readonly WorktreeSummary[]
}

/** The name the index heads a project's section with, which tells two projects of one name apart. */
const projectName = ({ rows, path, now }: { readonly rows: readonly WorktreeSummary[]; readonly path: string; readonly now: number }) =>
  dashboardOf({ rows, now }).sections.find((section): section is ProjectSection => section.kind === 'project' && section.key === path)
    ?.name ?? path

/**
 * Whether any tracked worktree is in the union a filter names: what makes its
 * address a page, and the one test by which `unionOf` finds no union, so the
 * route, which asks it before the page mounts, and the page, which asks
 * `unionOf` of every answer of the rows it reads, never disagree about an
 * address.
 */
export const hasMembers = ({ filter, rows }: { readonly filter: UnionFilter; readonly rows: readonly WorktreeSummary[] }) =>
  rows.some((row) => inUnion(filter, row))

/** The union a filter names among these rows, or null when no tracked worktree is in it, which is an address nothing serves. */
export function unionOf({ filter, rows, now }: {
  readonly filter: UnionFilter
  readonly rows: readonly WorktreeSummary[]
  readonly now: number
}): Union | null {
  if (!hasMembers({ filter, rows })) return null
  const members = rows.filter((row) => inUnion(filter, row))
  return filter.kind === 'epic'
    ? { name: filter.name, rows: members.toSorted(epicOrder) }
    : { name: projectName({ rows, path: filter.path, now }), rows: members.toSorted(projectOrder) }
}
