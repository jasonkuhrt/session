import type { Repository, WorktreeSummary } from '../../contract'
import { stageNames } from '../../contract'
import { isLive } from './agents'
import { hour } from './format'
import { rankedFirst } from './order'

/**
 * How the index draws the worktrees it lists: a stack of sections, one per
 * project, each headed by what heads it and holding the project's cards, one
 * per epic with its worktrees inside and one per worktree in none, and one
 * more for the epics whose worktrees belong to more than one project, all of
 * them ordered alike. A project is a repository, what Git names for every
 * worktree of it, or a folder outside Git, and an epic is only the name its
 * worktrees' files share, so everything here is derived from the rows on every
 * read: no section and no fold is kept anywhere, and the one order kept is the
 * rank each worktree's own file holds, which places a main worktree's project
 * among the projects and any other worktree within its epic.
 */

/** Nothing live and nothing for this long makes a worktree quiet, drawn dim and last: the bound the index's activity bands used. */
const quietAfter = 5 * 24 * hour

/** Whether an agent is live in a worktree, as its pills say: a Claude Code session with a process, or a Codex thread an app holds. */
const hasLiveAgent = (row: WorktreeSummary) =>
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

/** Something the index orders: what is happening in it, and the name that settles a tie. */
type Ranked = { readonly standing: Standing; readonly name: string }

/**
 * What is happening first: anything not quiet before anything quiet, a live
 * agent before none, then the newest moment first. A name settles a tie, so
 * two reads of the same rows always draw the same order.
 */
const busierFirst = (left: Ranked, right: Ranked) => {
  if (left.standing.quiet !== right.standing.quiet) return left.standing.quiet ? 1 : -1
  if (left.standing.live !== right.standing.live) return left.standing.live ? -1 : 1
  if (left.standing.latest !== right.standing.latest) {
    if (left.standing.latest === null) return 1
    if (right.standing.latest === null) return -1
    return right.standing.latest - left.standing.latest
  }
  return left.name.localeCompare(right.name)
}

/** An epic's card: its name and its worktrees, the ranked ones first, then the busiest. */
export type EpicCardShape = {
  readonly kind: 'epic'
  readonly name: string
  readonly rows: readonly WorktreeSummary[]
  readonly quiet: boolean
}

/** A card: an epic and its worktrees, or one worktree in no epic. */
export type IndexCard = EpicCardShape | { readonly kind: 'loose'; readonly row: WorktreeSummary; readonly quiet: boolean }

/**
 * What heads a project's section: its main worktree's row while it has a
 * session; the repository as Git names it, when its main worktree has none,
 * so its linked worktrees still have a home; the repository by its Git
 * directory, when Git lists that where a main worktree would be; or a folder
 * outside Git, which is a project of its own.
 */
export type SectionHead =
  | { readonly kind: 'tracked'; readonly row: WorktreeSummary }
  | { readonly kind: 'untracked'; readonly repository: Repository }
  | { readonly kind: 'bare'; readonly repository: Repository }
  | { readonly kind: 'folder'; readonly path: string }

/**
 * One project's section, a repository's or a folder's outside Git: its head,
 * then its cards, busiest first. It is as busy as every worktree of the
 * project, wherever that is drawn, so a repository whose worktrees are all in
 * epics across projects is as live as they are.
 */
export type ProjectSection = {
  readonly kind: 'project'
  /** What tells it from every other section: the path of what Git lists first for its repository, or the folder's own outside Git. */
  readonly key: string
  /** The name its head carries: the repository's, or the folder's, with its parent folder's before it when another section has the same one. */
  readonly name: string
  readonly head: SectionHead
  readonly cards: readonly IndexCard[]
  readonly quiet: boolean
}

/** The section of the epics across projects, by a key no path can be, and the name that settles its ties. */
const acrossKey = 'across'
export const acrossName = 'Across projects'

/** The epics whose worktrees belong to more than one project, in a section of their own, as busy as their worktrees. */
export type AcrossSection = {
  readonly kind: 'across'
  readonly key: typeof acrossKey
  readonly cards: readonly EpicCardShape[]
  readonly quiet: boolean
}

/** The index as it is drawn: its sections, busiest first, the epics across projects ranked with the projects. */
export type Dashboard = { readonly sections: ReadonlyArray<ProjectSection | AcrossSection> }

/** The section a worktree is drawn in when it is in no epic, and returns to when it leaves one: its repository's, or its own outside Git. */
export const sectionKeyOf = (row: WorktreeSummary) => row.repository?.path ?? row.path

/**
 * The main worktree whose rank places a section among the others: the one
 * heading it, while it has a session. No other section has a file of its own
 * to keep a place in, so it stands after the ranked ones, by what is
 * happening in it.
 */
export const sectionRowOf = (section: ProjectSection | AcrossSection): WorktreeSummary | null =>
  section.kind === 'project' && section.head.kind === 'tracked' ? section.head.row : null

/**
 * The stack's order: the sections a main worktree placed by hand heads, by
 * rank, and then the rest, busiest first, their keys settling a tie.
 */
const stackOrder = rankedFirst<Ranked & { readonly section: ProjectSection | AcrossSection }>({
  rankOf: (entry) => ({ rank: sectionRowOf(entry.section)?.rank ?? null, path: entry.section.key }),
  otherwise: (left, right) => busierFirst(left, right) || left.section.key.localeCompare(right.section.key),
})

/** What heads a project's section until its main worktree's row is found, if it has one. */
const headOf = (row: WorktreeSummary): SectionHead => {
  if (row.repository === null) return { kind: 'folder', path: row.path }
  return row.repository.bare ? { kind: 'bare', repository: row.repository } : { kind: 'untracked', repository: row.repository }
}

/** A section as it fills: its head so far, its cards with what orders them, and every worktree of the project, which say how busy it is. */
type Filling = {
  readonly key: string
  readonly name: string
  head: SectionHead
  readonly cards: Array<Ranked & { readonly card: IndexCard }>
  readonly members: WorktreeSummary[]
}

/** The folder a path sits in, by its name; empty at the root. */
const parentName = (path: string) => path.split('/').at(-2) ?? ''

/**
 * The names the heads carry: a project's own, or, where two sections would
 * carry the same, each with its parent folder's name before it, as a linked
 * worktree is named whose folder shares its main worktree's name.
 */
function namesOf(projects: readonly Filling[]): ReadonlyMap<string, string> {
  const shared = new Map<string, number>()
  for (const project of projects) shared.set(project.name, (shared.get(project.name) ?? 0) + 1)
  return new Map(projects.map((project) => {
    const parent = parentName(project.key)
    return [project.key, (shared.get(project.name) ?? 0) > 1 && parent !== '' ? `${parent}/${project.name}` : project.name]
  }))
}

/**
 * The epics by name, each with the worktrees in it: the ones placed by hand
 * first, in their rank's order, then the rest, busiest first. A main worktree
 * is never in an epic, so its file is not read as putting it in one.
 */
function epicsOf(rows: readonly WorktreeSummary[], now: number): Array<Ranked & { readonly card: EpicCardShape }> {
  const members = new Map<string, WorktreeSummary[]>()
  for (const row of rows) {
    if (!row.main && row.epic !== null) members.set(row.epic, [...(members.get(row.epic) ?? []), row])
  }
  const rowOrder = rankedFirst<WorktreeSummary>({
    rankOf: (row) => row,
    otherwise: (left, right) =>
      busierFirst({ standing: standingOf([left], now), name: left.name }, { standing: standingOf([right], now), name: right.name }),
  })
  return [...members].map(([name, epicRows]) => {
    const standing = standingOf(epicRows, now)
    return { card: { kind: 'epic', name, rows: epicRows.toSorted(rowOrder), quiet: standing.quiet }, standing, name }
  })
}

/**
 * The stack for these rows. Every worktree is drawn once: a main worktree at
 * the head of its repository's section, whatever its file says; a worktree in
 * no epic as a card of its own in its project's section; and one in an epic
 * inside that epic's card, which stands in the section of the project all its
 * worktrees belong to, or in the section of the epics across projects when
 * they belong to more than one. A project is in the stack while any worktree
 * of it is listed, headed whether or not a session is there. The sections a
 * main worktree placed by hand heads come first, in their rank's order; every
 * other section, the one across projects included, is ordered after them as
 * the cards in a section are, busiest first, and a quiet one is dim, and last
 * unless it was placed.
 */
export function dashboardOf({ rows, now }: { readonly rows: readonly WorktreeSummary[]; readonly now: number }): Dashboard {
  const filling = new Map<string, Filling>()
  const projectOf = (row: WorktreeSummary): Filling => {
    const key = sectionKeyOf(row)
    const known = filling.get(key)
    if (known !== undefined) return known
    const project: Filling = { key, name: row.repository?.name ?? row.name, head: headOf(row), cards: [], members: [] }
    filling.set(key, project)
    return project
  }
  for (const row of rows) {
    const project = projectOf(row)
    project.members.push(row)
    // Git lists one main worktree per repository, so a second can only be a
    // path that was main when it was taken on; it is drawn, as a card.
    if (row.main && project.head.kind !== 'tracked') project.head = { kind: 'tracked', row }
    else if (row.main || row.epic === null) {
      const standing = standingOf([row], now)
      project.cards.push({ card: { kind: 'loose', row, quiet: standing.quiet }, standing, name: row.name })
    }
  }
  const across: Array<Ranked & { readonly card: EpicCardShape }> = []
  for (const epic of epicsOf(rows, now)) {
    const [first] = epic.card.rows
    const homes = new Set(epic.card.rows.map((row) => sectionKeyOf(row)))
    if (first === undefined || homes.size > 1) across.push(epic)
    else projectOf(first).cards.push(epic)
  }
  const names = namesOf([...filling.values()])
  const projects = [...filling.values()].map((project) => {
    const name = names.get(project.key) ?? project.name
    const standing = standingOf(project.members, now)
    const cards = project.cards.toSorted(busierFirst).map((entry) => entry.card)
    const section: ProjectSection = { kind: 'project', key: project.key, name, head: project.head, cards, quiet: standing.quiet }
    return { section, standing, name }
  })
  const acrossStanding = standingOf(across.flatMap((epic) => epic.card.rows), now)
  const acrossSection: AcrossSection = {
    kind: 'across',
    key: acrossKey,
    cards: across.toSorted(busierFirst).map((entry) => entry.card),
    quiet: acrossStanding.quiet,
  }
  const ranked = across.length === 0 ? projects : [...projects, { section: acrossSection, standing: acrossStanding, name: acrossName }]
  return {
    sections: ranked.toSorted(stackOrder).map((entry) => entry.section),
  }
}

/** Every epic's card on the page, wherever it stands. */
export const epicCardsOf = (dashboard: Dashboard): readonly EpicCardShape[] =>
  dashboard.sections.flatMap((section) =>
    section.kind === 'across' ? section.cards : section.cards.flatMap((card) => (card.kind === 'epic' ? [card] : []))
  )

/**
 * The fewest and the most items any stage drawn on the page holds. Every
 * glyph's bars are measured against this one range, so a bar's height means
 * the same on every card in one view.
 */
export type StageRange = { readonly least: number; readonly most: number }

/**
 * The range for the rows the page draws, read from them on every render and
 * kept nowhere. Only a row whose glyph is drawn counts: a row the daemon does
 * not serve has none.
 */
export function stageRangeOf(rows: readonly WorktreeSummary[]): StageRange {
  const counts = rows
    .filter((row) => row.conflict === null)
    .flatMap((row) => stageNames.map((stage) => row.counts[stage]))
  return counts.length === 0 ? { least: 0, most: 0 } : { least: Math.min(...counts), most: Math.max(...counts) }
}
