import { acrossName, epicCardsOf } from './lib/dashboard'
import { checkoutLabel } from './lib/format'
import { indexMeaning } from './lib/index-meanings'
import { laneItems, lanesOf } from './lib/lanes'
import { listingMeta, unionLedgerMeaning } from './lib/listings'
import { groupMeta, stageHint } from './lib/workflow'
import { Marks } from './components/marks'
import { idOf, nodeOf, rootId } from './levels'
import type { WorktreeSummary } from '../contract'
import type { GoTo, Path, Target } from './substrate/seam'
import { makeFacts } from './tree-facts'
import type { Lookup } from './tree-lookup'
import { kindOf } from './tree-lookup'
import type { Entry } from './tree-types'
import { bodyAt } from './tree-types'

/** How the tree's nodes read: their words, the sentences behind them, their steps of the path line, their facts, and the go-to. */

const nameOfRow = (row: { readonly name: string } | null, fallback: string) => row?.name ?? fallback

export function makeWords({ lookup, structure }: {
  readonly lookup: Lookup
  readonly structure: { readonly normalize: (path: Path) => Path }
}) {
  const { data, rows, sessions, dashboard, rowAt, rowOfKey, sectionOf, epicHome, headRow, worktreePath, itemPath, itemOf, sectionsOfItem } = lookup
  const { normalize } = structure

  /** The words a node reads as, where it is. */
  const label = (path: Path): string => {
    const id = path.at(-1) ?? ''
    const node = nodeOf(id)
    if (node === null) return id
    switch (node.kind) {
      case 'all': {
        return 'All'
      }
      case 'project': {
        const section = sectionOf(node.key)
        if (section === null) return node.key.split('/').at(-1) ?? node.key
        return section.kind === 'across' ? acrossName : section.name
      }
      case 'epic': {
        return node.name
      }
      case 'worktree': {
        // The main worktree under its project is named for what it is there, since the project already carries its name.
        const row = rowAt(node.path)
        return row?.main === true && path.length === 3 ? 'main' : nameOfRow(row, node.path)
      }
      case 'stage': {
        return node.stage
      }
      case 'part': {
        return nameOfRow(rowOfKey(node.key), node.key)
      }
      case 'group': {
        return node.name
      }
      case 'item': {
        return node.id
      }
      case 'section': {
        const owner = path.at(-2) ?? ''
        const entry = entriesOf(owner).find((candidate) => candidate.at === node.at)
        return entry?.heading ?? node.at
      }
      case 'record': {
        return node.page === 'file' ? node.path.split('/').at(-1) ?? node.path : listingMeta[node.page].label
      }
    }
  }

  /** The entries a page draws inside a node: an item's sections, or a record's entries, as the page gave them. */
  const entriesOf = (owner: string): readonly Entry[] => {
    const given = data.entries.get(owner)
    if (given !== undefined) return given
    const node = nodeOf(owner)
    if (node?.kind !== 'item') return []
    const item = itemOf(node.key, node.id)
    if (item === null) return []
    const sections = sectionsOfItem(node.key, node.id)
    return sections.length === 0
      ? [{ at: bodyAt, heading: item.title, facts: [] }]
      : sections.map((section) => ({ at: section.at, heading: section.heading, facts: [] }))
  }

  const signalsOfRow = (row: WorktreeSummary | null) => (row === null ? null : data.signalsOf(row))

  const crumb = (path: Path, _index: number, drawn: boolean) => {
    const id = path.at(-1) ?? ''
    const node = nodeOf(id)
    const text = label(path)
    const meaning = meaningOf(path)
    if (drawn || node === null) return { text, meaning, literal: node?.kind === 'item' }
    const row = node.kind === 'worktree'
      ? rowAt(node.path)
      : node.kind === 'part'
      ? rowOfKey(node.key)
      : node.kind === 'project'
      ? headRow(sectionOf(node.key))
      : null
    const signals = signalsOfRow(row)
    return { text, meaning, literal: node.kind === 'item', marks: signals === null ? undefined : <Marks signals={signals} now={data.now} /> }
  }

  /** The sentence behind a node's words. */
  const meaningOf = (path: Path): string => {
    const node = nodeOf(path.at(-1) ?? '')
    if (node === null) return ''
    switch (node.kind) {
      case 'all': {
        return indexMeaning
      }
      case 'project': {
        return node.key === 'across' ? 'The epics whose worktrees belong to more than one project.' : `The project at ${node.key}.`
      }
      case 'epic': {
        return `The epic “${node.name}”: the worktrees whose sessions name it.`
      }
      case 'worktree': {
        return node.path
      }
      case 'stage': {
        return stageHint[node.stage]
      }
      case 'part': {
        return `${label(path)}’s part of ${node.stage}.`
      }
      case 'group': {
        return groupMeta[node.stage].heading
      }
      case 'item': {
        return itemOf(node.key, node.id)?.title ?? node.id
      }
      case 'section': {
        return `A section of ${label(path.slice(0, -1))}.`
      }
      case 'record': {
        if (node.page === 'file') return `The file ${node.path}, rendered from the session as it is on disk.`
        return path.length > 3 && kindOf(path.at(-2) ?? '') !== 'worktree' ? unionLedgerMeaning : listingMeta[node.page].meaning
      }
    }
  }

  const facts = makeFacts({ lookup, words: { label, meaningOf, entriesOf } })

  const targetName = (target: Target) => {
    const node = nodeOf(target.id)
    if (node === null) return target.id
    switch (node.kind) {
      case 'stage': {
        return `${node.stage} of ${label(target.path.slice(0, -1))}`
      }
      case 'part': {
        return `${label(target.path)} in ${node.stage}`
      }
      case 'group': {
        return `the group ${node.name}`
      }
      case 'item': {
        const item = itemOf(node.key, node.id)
        return item === null ? node.id : `${node.id} ${item.title}`
      }
      case 'epic': {
        return `the epic ${node.name}`
      }
      default: {
        return label(target.path)
      }
    }
  }

  /** Every project, epic and worktree there is, and every item of the sessions read: the palette's go-to. */
  const goTo = (): GoTo[] => {
    const places: GoTo[] = []
    for (const section of dashboard.sections) {
      if (section.kind === 'project') places.push({ name: section.name, on: 'project', path: [rootId, idOf({ kind: 'project', key: section.key })] })
    }
    for (const card of epicCardsOf(dashboard)) {
      const home = epicHome(card.name)
      if (home !== null) {
        places.push({
          name: card.name,
          on: home.kind === 'across' ? 'epic across projects' : `epic in ${home.name}`,
          path: [rootId, idOf({ kind: 'project', key: home.key }), idOf({ kind: 'epic', name: card.name })],
        })
      }
    }
    for (const row of rows) {
      const at = normalize(worktreePath(row))
      // A worktree that heads its project's section is the project's own node, already listed.
      if (row.resolved && at.length > 2) places.push({ name: row.name, on: `worktree, ${checkoutLabel({ branch: row.branch, detached: row.detached })}`, path: at })
    }
    for (const [key, session] of sessions) {
      const row = rowOfKey(key)
      if (row === null) continue
      const board = worktreePath(row)
      for (const lane of lanesOf(session.stages)) {
        for (const item of laneItems(lane)) {
          const at = itemPath(board, key, item.id)
          if (at !== null) places.push({ name: item.title, id: item.id, on: `${row.name}, ${lane.stage}`, path: at })
        }
      }
    }
    return places
  }

  return { label, crumb, facts, targetName, goTo }
}
