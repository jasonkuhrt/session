import type { WorktreeSummary } from '../../contract'
import { boardPath, epicPath, projectPath } from './base'
import type { ProjectSection } from './dashboard'
import { dashboardOf, sectionKeyOf } from './dashboard'
import { rankedFirst } from './order'

/**
 * What a board shows: the worktrees a filter names, read from the facts the
 * daemon serves on every row of the index, `epic`, `main` and `repository`,
 * and nothing stored of its own. A worktree's filter names that worktree, by
 * its name, as `/w/<key>/` carries it; an epic's names the linked worktrees
 * whose sessions name it; a project's names its repository's worktrees, by
 * the path the index heads its section with, or the one folder outside Git
 * that is a project of its own. An epic's board and a project's are a union:
 * the lanes of every worktree in view, each under its worktree's name.
 */
export type Filter =
  | { readonly kind: 'worktree'; readonly name: string }
  | { readonly kind: 'epic'; readonly name: string }
  | { readonly kind: 'project'; readonly path: string }

/** A filter whose board is a union of worktrees' lanes: an epic's, or a project's. */
export type UnionFilter = Exclude<Filter, { readonly kind: 'worktree' }>

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

/** Where a filter's board is: at this prefix with a trailing slash, and its ledger at `ledger` under it. */
export const filterPath = (filter: Filter) => {
  if (filter.kind === 'worktree') return boardPath(filter.name)
  return filter.kind === 'epic' ? epicPath(filter.name) : projectPath(filter.path)
}

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
 * address a page, which the route asks before the page mounts.
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

/**
 * Every filter a board can switch to, as the picker lists them: each worktree
 * the daemon serves, since a row it refuses to serve is not somewhere to go;
 * each epic some tracked worktree names; and each project the index heads a
 * section for. An epic or a project is listed with how many worktrees are in
 * it, served or not, as its board draws them.
 */
export type FilterOption =
  | ({ readonly kind: 'worktree' } & Pick<WorktreeSummary, 'name' | 'path' | 'branch' | 'detached'>)
  | { readonly kind: 'epic'; readonly name: NonNullable<WorktreeSummary['epic']>; readonly count: number }
  | { readonly kind: 'project'; readonly name: ProjectSection['name']; readonly path: ProjectSection['key']; readonly count: number }

/** The filter an option switches to. */
export const filterOf = (option: FilterOption): Filter =>
  option.kind === 'project' ? { kind: 'project', path: option.path } : { kind: option.kind, name: option.name }

/** What tells one filter from every other: its kind and the name or path it goes by. */
export const filterId = (filter: Filter) => `${filter.kind}:${filter.kind === 'project' ? filter.path : filter.name}`

/** Options of one kind by name, as the list gives them. */
const byOptionName = <A extends { readonly name: string }>(options: readonly A[]) =>
  options.toSorted((left, right) => left.name.localeCompare(right.name))

/** The options for these rows, each kind by name. */
export function filterOptions({ rows, now }: { readonly rows: readonly WorktreeSummary[]; readonly now: number }) {
  const count = (filter: UnionFilter) => rows.filter((row) => inUnion(filter, row)).length
  const worktrees = rows
    .filter((row) => row.conflict === null)
    .map((row) => ({ kind: 'worktree', name: row.name, path: row.path, branch: row.branch, detached: row.detached }) as const)
  const epics = [...new Set(rows.flatMap((row) => (row.resolved && !row.main && row.epic !== null ? [row.epic] : [])))]
    .map((name) => ({ kind: 'epic', name, count: count({ kind: 'epic', name }) }) as const)
  const projects = dashboardOf({ rows, now }).sections.flatMap((section) =>
    section.kind === 'project'
      ? [{ kind: 'project', name: section.name, path: section.key, count: count({ kind: 'project', path: section.key }) } as const]
      : []
  )
  return { worktrees: byOptionName(worktrees), epics: byOptionName(epics), projects: byOptionName(projects) }
}
