import type { Repository, WorktreeSummary } from '../../contract'
import { stageNames } from '../../contract'
import { isLive } from './agents'
import { hour } from './format'

/**
 * How the index draws the worktrees it lists: a stack of sections, one per
 * repository, each headed by its main worktree and holding that repository's
 * cards, one per epic with its worktrees inside and one per worktree in none,
 * and above them the epics whose worktrees belong to more than one repository.
 * A repository is what Git names for every worktree of it, and an epic is only
 * the name its worktrees' files share, so everything here is derived from the
 * rows on every read: no section, no order and no fold is kept anywhere.
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

/** An epic's card: its name and its worktrees, busiest first. */
export type EpicCardShape = {
  readonly kind: 'epic'
  readonly name: string
  readonly rows: readonly WorktreeSummary[]
  readonly quiet: boolean
}

/** A card: an epic and its worktrees, or one worktree in no epic. */
export type IndexCard = EpicCardShape | { readonly kind: 'loose'; readonly row: WorktreeSummary; readonly quiet: boolean }

/**
 * What heads a repository's section: its main worktree's row while it has a
 * session, or else the repository as Git names it, which the daemon does not
 * track, so its linked worktrees still have a home.
 */
export type SectionHead =
  | { readonly kind: 'tracked'; readonly row: WorktreeSummary }
  | { readonly kind: 'untracked'; readonly repository: Repository }

/**
 * One repository's section: its head, then its cards, busiest first. A folder
 * outside Git belongs to no repository and has a section of its own, with no
 * main worktree to head it.
 */
export type RepositorySection = {
  /** What tells it from every other section: its main worktree's path, or the folder's own outside Git. */
  readonly key: string
  readonly name: string
  readonly head: SectionHead | null
  readonly cards: readonly IndexCard[]
  readonly quiet: boolean
}

/** The index as it is drawn: the epics across repositories, then a section per repository, busiest first. */
export type Dashboard = {
  readonly across: readonly EpicCardShape[]
  readonly sections: readonly RepositorySection[]
}

/** The section a worktree is drawn in when it is in no epic, and returns to when it leaves one: its repository's, or its own outside Git. */
export const sectionKeyOf = (row: WorktreeSummary) => row.repository?.path ?? row.path

/** A section as it fills: its head so far, its cards with what orders them, and the rows drawn in it, which say how busy it is. */
type Filling = {
  readonly key: string
  readonly name: string
  head: SectionHead | null
  readonly cards: Array<Ranked & { readonly card: IndexCard }>
  readonly rows: WorktreeSummary[]
}

/**
 * The epics by name, each with the worktrees in it, busiest first. A main
 * worktree is never in an epic, so its file is not read as putting it in one.
 */
function epicsOf(rows: readonly WorktreeSummary[], now: number): Array<Ranked & { readonly card: EpicCardShape }> {
  const members = new Map<string, WorktreeSummary[]>()
  for (const row of rows) {
    if (!row.main && row.epic !== null) members.set(row.epic, [...(members.get(row.epic) ?? []), row])
  }
  const rowOrder = (left: WorktreeSummary, right: WorktreeSummary) =>
    busierFirst({ standing: standingOf([left], now), name: left.name }, { standing: standingOf([right], now), name: right.name })
  return [...members].map(([name, epicRows]) => {
    const standing = standingOf(epicRows, now)
    return { card: { kind: 'epic', name, rows: epicRows.toSorted(rowOrder), quiet: standing.quiet }, standing, name }
  })
}

/**
 * The stack for these rows. Every worktree is drawn once: a main worktree at
 * the head of its repository's section, whatever its file says; a worktree in
 * no epic as a card of its own in its repository's section; and one in an
 * epic inside that epic's card, which stands in the section of the repository
 * all its worktrees belong to, or above the sections when they belong to more
 * than one. A repository is in the stack while any worktree of it is listed,
 * headed by its main worktree whether or not that has a session. The sections
 * are ordered as the cards in them are, busiest first.
 */
export function dashboardOf({ rows, now }: { readonly rows: readonly WorktreeSummary[]; readonly now: number }): Dashboard {
  const filling = new Map<string, Filling>()
  const sectionOf = (row: WorktreeSummary): Filling => {
    const key = sectionKeyOf(row)
    const known = filling.get(key)
    if (known !== undefined) return known
    const head: SectionHead | null = row.repository === null ? null : { kind: 'untracked', repository: row.repository }
    const section: Filling = { key, name: row.repository?.name ?? row.name, head, cards: [], rows: [] }
    filling.set(key, section)
    return section
  }
  for (const row of rows) {
    const section = sectionOf(row)
    // Git lists one main worktree per repository, so a second can only be a
    // path that was main when it was taken on; it is drawn, as a card.
    if (row.main && section.head?.kind !== 'tracked') {
      section.head = { kind: 'tracked', row }
      section.rows.push(row)
    } else if (row.main || row.epic === null) {
      const standing = standingOf([row], now)
      section.cards.push({ card: { kind: 'loose', row, quiet: standing.quiet }, standing, name: row.name })
      section.rows.push(row)
    }
  }
  const across: Array<Ranked & { readonly card: EpicCardShape }> = []
  for (const epic of epicsOf(rows, now)) {
    const [first] = epic.card.rows
    const homes = new Set(epic.card.rows.map((row) => sectionKeyOf(row)))
    if (first === undefined || homes.size > 1) {
      across.push(epic)
      continue
    }
    const section = sectionOf(first)
    section.cards.push(epic)
    section.rows.push(...epic.card.rows)
  }
  const sections = [...filling.values()].map((section) => ({ section, standing: standingOf(section.rows, now), name: section.name }))
  return {
    across: across.toSorted(busierFirst).map((entry) => entry.card),
    sections: sections
      .toSorted((left, right) => busierFirst(left, right) || left.section.key.localeCompare(right.section.key))
      .map(({ section, standing }) => ({
        key: section.key,
        name: section.name,
        head: section.head,
        cards: section.cards.toSorted(busierFirst).map((entry) => entry.card),
        quiet: standing.quiet,
      })),
  }
}

/** Every epic's card on the page, wherever it stands. */
export const epicCardsOf = (dashboard: Dashboard): readonly EpicCardShape[] => [
  ...dashboard.across,
  ...dashboard.sections.flatMap((section) => section.cards.flatMap((card) => (card.kind === 'epic' ? [card] : []))),
]

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
