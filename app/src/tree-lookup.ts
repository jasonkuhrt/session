import type { Item, Session, WorktreeSummary } from '../contract'
import type { AcrossSection, Dashboard, ProjectSection } from './lib/dashboard'
import { dashboardOf, epicCardsOf, sectionKeyOf } from './lib/dashboard'
import type { UnionFilter } from './lib/filter'
import { keyTaken, unionOf } from './lib/filter'
import type { Lane } from './lib/lanes'
import { laneItems, lanesOf } from './lib/lanes'
import type { Section } from './lib/sections'
import { sectionsOf } from './lib/sections'
import { idOf, nodeOf, rootId } from './levels'
import type { Path } from './substrate/seam'
import type { Place, TreeData } from './tree-types'

/**
 * What the tree looks things up by: the rows, their sections and epics, the
 * paths a worktree and an item stand at, and the items of the sessions read.
 */

export const kindOf = (id: string) => nodeOf(id)?.kind ?? null

/** Whether a board path is a union's: an epic's or a project's, whose lanes hold each worktree's part. */
export const isUnion = (board: Path) => kindOf(board.at(-1) ?? '') !== 'worktree'

/** An item as a session holds it, with its stage and its lane. */
type Filed = { readonly item: Item; readonly stage: Lane['stage']; readonly lane: Lane }

/** A session's items by id, each where it is first filed, in the order the lanes draw them. */
const filedIn = (session: Session | undefined): ReadonlyMap<string, Filed> => {
  const filed = new Map<string, Filed>()
  for (const lane of lanesOf(session?.stages ?? [])) {
    for (const item of laneItems(lane)) if (!filed.has(item.id)) filed.set(item.id, { item, stage: lane.stage, lane })
  }
  return filed
}

/**
 * An item's sections, parsed once for as long as the item is the one read:
 * every card's node asks for its page's sections as it draws, and parsing
 * Markdown each time would make a move on a full board wait for all of them.
 */
const parsed = new WeakMap<Item, readonly Section[]>()
const sectionsOfItemRead = (item: Item): readonly Section[] => {
  const known = parsed.get(item)
  if (known !== undefined) return known
  const sections = sectionsOf(item.body)
  parsed.set(item, sections)
  return sections
}

/** The rows by where they are and by the key a board serves each under. */
const rowLookups = (rows: TreeData['rows']) => ({
  rowAt: (path: string) => rows.find((row) => row.path === path) ?? null,
  /** The row a board serves under a key: never the later of two rows that share one. */
  rowOfKey: (key: string) => rows.find((row) => row.key === key && !keyTaken({ row, rows })) ?? null,
})

/** The index's sections and epics, and the row a project's head stands for. */
const sectionLookups = ({ dashboard, rowAt }: { readonly dashboard: Dashboard; readonly rowAt: (path: string) => WorktreeSummary | null }) => ({
  sectionOf: (key: string) => dashboard.sections.find((section) => section.key === key) ?? null,
  /** The section an epic's card stands in: its project's, or the one across projects. */
  epicHome: (name: string) =>
    dashboard.sections.find((section) =>
      section.kind === 'across'
        ? section.cards.some((card) => card.name === name)
        : section.cards.some((card) => card.kind === 'epic' && card.name === name)
    ) ?? null,
  epicCard: (name: string) => epicCardsOf(dashboard).find((card) => card.name === name) ?? null,
  /** The row a project's head stands for: its main worktree's, or the folder outside Git it is. */
  headRow: (section: ProjectSection | AcrossSection | null): WorktreeSummary | null => {
    if (section === null || section.kind === 'across') return null
    if (section.head.kind === 'tracked') return section.head.row
    return section.head.kind === 'folder' ? rowAt(section.head.path) : null
  },
})

type Rows = ReturnType<typeof rowLookups>
type Sections = ReturnType<typeof sectionLookups>

/** Where a worktree is on the index, and where a board is: a worktree's, an epic's or a project's. */
const pathLookups = ({ rowOfKey, epicHome }: Pick<Rows, 'rowOfKey'> & Pick<Sections, 'epicHome'>) => {
  /** Where a worktree is on the index: under its epic, or its project, and a path Git refused under nothing. */
  const worktreePath = (row: WorktreeSummary): Path => {
    const worktree = idOf({ kind: 'worktree', path: row.path })
    if (!row.resolved) return [rootId, worktree]
    const home = !row.main && row.epic !== null ? epicHome(row.epic) : null
    if (home !== null && row.epic !== null) {
      return [rootId, idOf({ kind: 'project', key: home.key }), idOf({ kind: 'epic', name: row.epic }), worktree]
    }
    return [rootId, idOf({ kind: 'project', key: sectionKeyOf(row) }), worktree]
  }
  /** The filter of the board an item's page was opened from: the epic's or the project's of its worktree. */
  const viaFilter = (place: Extract<Place, { kind: 'item' }>, key: string): UnionFilter | null => {
    const row = rowOfKey(key)
    if (row === null) return null
    if (place.via === 'epic') return row.epic === null ? null : { kind: 'epic', name: row.epic }
    return { kind: 'project', path: sectionKeyOf(row) }
  }
  /** The board a node before a stage is: a worktree's, an epic's or a project's. */
  const boardPath = (place: Extract<Place, { kind: 'board' | 'union' | 'item' }>, key: string): Path | null => {
    if (place.kind === 'board' || (place.kind === 'item' && place.via === null)) {
      const row = rowOfKey(key)
      return row === null ? null : worktreePath(row)
    }
    const filter = place.kind === 'union' ? place.filter : viaFilter(place, key)
    if (filter === null) return null
    if (filter.kind === 'project') return [rootId, idOf({ kind: 'project', key: filter.path })]
    const home = epicHome(filter.name)
    return home === null ? null : [rootId, idOf({ kind: 'project', key: home.key }), idOf({ kind: 'epic', name: filter.name })]
  }
  return { worktreePath, boardPath }
}

/** The items of the sessions read, where each is on a board, and the worktree a path is in. */
const itemLookups = (data: TreeData, { rowAt }: Pick<Rows, 'rowAt'>) => {
  const { sessions } = data
  // Each session's items are indexed once for the tree, when it is first asked about.
  const indexed = new Map<string, ReadonlyMap<string, Filed>>()
  const findItem = (key: string, id: string): Filed | null => {
    const known = indexed.get(key) ?? filedIn(sessions.get(key))
    indexed.set(key, known)
    return known.get(id) ?? null
  }
  const itemOf = (key: string, id: string): Item | null =>
    findItem(key, id)?.item ?? (data.archived?.key === key && data.archived.item.id === id ? data.archived.item : null)
  return {
    itemOf,
    sectionsOfItem: (key: string, id: string): readonly Section[] => {
      const item = itemOf(key, id)
      return item === null ? [] : sectionsOfItemRead(item)
    },
    /** Where an item is on a board: its stage, its worktree's part on a union, its group, and itself; null when no stage holds it. */
    itemPath: (board: Path, key: string, id: string): Path | null => {
      const found = findItem(key, id)
      if (found === null) return null
      const { item, stage } = found
      return [
        ...board,
        idOf({ kind: 'stage', stage }),
        ...(isUnion(board) ? [idOf({ kind: 'part', key, stage })] : []),
        ...(item.group === null ? [] : [idOf({ kind: 'group', key, stage, name: item.group })]),
        idOf({ kind: 'item', key, id }),
      ]
    },
    /** The key of the worktree a path is in, by the nearest node that names one; null above every worktree. */
    keyIn: (path: Path): string | null => {
      for (const id of path.toReversed()) {
        const node = nodeOf(id)
        if (node?.kind === 'item' || node?.kind === 'part' || node?.kind === 'group') return node.key
        if (node?.kind === 'worktree') return rowAt(node.path)?.key ?? null
      }
      return null
    },
  }
}

/** The members of a union board, in the order its rows stand, the ones it serves. */
const unionRowsOf = (data: TreeData) => (board: Path): readonly WorktreeSummary[] => {
  const node = nodeOf(board.at(-1) ?? '')
  const filter: UnionFilter | null = node?.kind === 'epic'
    ? { kind: 'epic', name: node.name }
    : node?.kind === 'project'
    ? { kind: 'project', path: node.key }
    : null
  if (filter === null) return []
  return (unionOf({ filter, rows: data.rows, now: data.now })?.rows ?? []).filter((row) => !keyTaken({ row, rows: data.rows }))
}

export function makeLookup(data: TreeData) {
  const dashboard: Dashboard = dashboardOf({ rows: data.rows, now: data.now })
  const rows = rowLookups(data.rows)
  const sections = sectionLookups({ dashboard, rowAt: rows.rowAt })
  return {
    data,
    rows: data.rows,
    sessions: data.sessions,
    dashboard,
    isUnion,
    unionRows: unionRowsOf(data),
    ...rows,
    ...sections,
    ...pathLookups({ rowOfKey: rows.rowOfKey, epicHome: sections.epicHome }),
    ...itemLookups(data, rows),
  }
}

export type Lookup = ReturnType<typeof makeLookup>
