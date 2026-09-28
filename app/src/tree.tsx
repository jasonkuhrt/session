import { stageNames } from '../contract'
import type { Lane } from './lib/lanes'
import { lanesOf } from './lib/lanes'
import type { Node } from './levels'
import { idOf, nodeOf, rootId } from './levels'
import type { Path } from './substrate/seam'
import { isUnion, kindOf, makeLookup } from './tree-lookup'
import type { Place, TreeData } from './tree-types'
import { bodyAt } from './tree-types'
import { makeWords } from './tree-words'

/**
 * Session's tree, as the substrate asks for it: what each node is, what is
 * inside it, what it stands for, which view draws it, and how its step of the
 * path line and its facts read. Everything is read from the rows the index
 * serves and the sessions and pages a view has read, and nothing is kept: a
 * view builds it again from what it drew.
 */

/** The node of each entry a lane draws: a group, or an item in none. */
const laneKids = (key: string, lane: Lane | undefined) =>
  (lane?.entries ?? []).map((entry) =>
    entry.kind === 'group'
      ? idOf({ kind: 'group', key, stage: lane?.stage ?? 'Triage', name: entry.name })
      : idOf({ kind: 'item', key, id: entry.item.id })
  )

/** Which view draws a path: an item's page, a record's page, a board, or the index; two paths with one key are one view. */
const viewOf = (path: Path): string => {
  const at = (kind: Node['kind']) => path.findLastIndex((id) => kindOf(id) === kind)
  const section = at('section')
  const record = at('record')
  const item = at('item')
  const stage = path.findIndex((id) => kindOf(id) === 'stage')
  if (section !== -1 && item === section - 1) {
    return `item:${path[item] ?? ''}:${stage === -1 ? 'archived' : kindOf(path[stage - 1] ?? '') ?? ''}`
  }
  if (record !== -1) return `record:${path[record] ?? ''}:${path[record - 1] ?? ''}`
  if (stage !== -1) return `board:${path[stage - 1] ?? ''}`
  if (item !== -1) return `board:${path[item - 1] ?? ''}`
  return 'index'
}

export function makeTree(data: TreeData) {
  const lookup = makeLookup(data)
  const { rows, sessions, dashboard, rowAt, sectionOf, epicHome, epicCard, headRow, worktreePath, boardPath, itemPath, keyIn, unionRows, itemOf, sectionsOfItem, rowOfKey } = lookup
  const kids = (path: Path): readonly string[] => {
    const id = path.at(-1) ?? ''
    const node = nodeOf(id)
    if (node === null) return []
    switch (node.kind) {
      case 'all': {
        return [
          ...dashboard.sections.map((section) => idOf({ kind: 'project', key: section.key })),
          ...rows.filter((row) => !row.resolved).map((row) => idOf({ kind: 'worktree', path: row.path })),
        ]
      }
      case 'project': {
        const section = sectionOf(node.key)
        if (section === null) return []
        if (section.kind === 'across') return section.cards.map((card) => idOf({ kind: 'epic', name: card.name }))
        const head = headRow(section)
        return section.cards.flatMap((card) => {
          if (card.kind === 'epic') return [idOf({ kind: 'epic', name: card.name })]
          return card.row.path === head?.path ? [] : [idOf({ kind: 'worktree', path: card.row.path })]
        })
      }
      case 'epic': {
        return (epicCard(node.name)?.rows ?? []).map((row) => idOf({ kind: 'worktree', path: row.path }))
      }
      case 'worktree': {
        const row = rowAt(node.path)
        return row === null || row.conflict !== null ? [] : stageNames.map((stage) => idOf({ kind: 'stage', stage }))
      }
      case 'stage': {
        const board = path.slice(0, -1)
        if (isUnion(board)) return unionRows(board).map((row) => idOf({ kind: 'part', key: row.key, stage: node.stage }))
        const key = keyIn(board)
        if (key === null) return []
        return laneKids(key, lanesOf(sessions.get(key)?.stages ?? []).find((lane) => lane.stage === node.stage))
      }
      case 'part': {
        return laneKids(node.key, lanesOf(sessions.get(node.key)?.stages ?? []).find((lane) => lane.stage === node.stage))
      }
      case 'group': {
        const lane = lanesOf(sessions.get(node.key)?.stages ?? []).find((candidate) => candidate.stage === node.stage)
        const group = lane?.entries.find((entry) => entry.kind === 'group' && entry.name === node.name)
        return group?.kind === 'group' ? group.items.map((item) => idOf({ kind: 'item', key: node.key, id: item.id })) : []
      }
      case 'item': {
        if (itemOf(node.key, node.id) === null) return []
        const sections = sectionsOfItem(node.key, node.id)
        return sections.length === 0
          ? [idOf({ kind: 'section', at: bodyAt })]
          : sections.map((section) => idOf({ kind: 'section', at: section.at }))
      }
      case 'record': {
        return (data.entries.get(id) ?? []).map((entry) => idOf({ kind: 'section', at: entry.at }))
      }
      case 'section': {
        return []
      }
    }
  }

  const standsFor = (path: Path): readonly Path[] => {
    const node = nodeOf(path.at(-1) ?? '')
    if (node?.kind !== 'project') return []
    const head = headRow(sectionOf(node.key))
    return head === null || !head.resolved ? [] : [[...path, idOf({ kind: 'worktree', path: head.path })]]
  }

  /** On the index a project's head is drawn as the project's row, so the worktree it heads is named as the project. */
  const normalize = (path: Path): Path => {
    if (path.length !== 3) return path
    const [, project = '', worktree = ''] = path
    const stands = standsFor([rootId, project])
    return stands.some((standing) => standing[2] === worktree) ? [rootId, project] : path
  }


  /** A page's focus: the page itself or the section or entry the address names, else its first, else the page. */
  const into = (at: Path, node: Node | null, leaf: string | undefined): Path => {
    if (leaf !== undefined && leaf === at.at(-1)) return at
    const inside = kids(at)
    const chosen = node?.kind === 'section' && leaf !== undefined && inside.includes(leaf) ? leaf : inside[0]
    return chosen === undefined ? at : [...at, chosen]
  }

  /** The focus a view is at, from its address and what it has read: the leaf the address names, where it is now. */
  const focusOf = (place: Place, leaf: string | undefined): Path => {
    const node = leaf === undefined ? null : nodeOf(leaf)
    switch (place.kind) {
      case 'index': {
        if (node?.kind === 'project' && sectionOf(node.key) !== null) return [rootId, leaf ?? '']
        if (node?.kind === 'epic') {
          const home = epicHome(node.name)
          if (home !== null) return [rootId, idOf({ kind: 'project', key: home.key }), leaf ?? '']
        }
        if (node?.kind === 'worktree') {
          const row = rowAt(node.path)
          if (row !== null) return normalize(worktreePath(row))
        }
        const first = kids([rootId])[0]
        return first === undefined ? [rootId] : [rootId, first]
      }
      case 'board':
      case 'union': {
        const board = boardPath(place, place.kind === 'board' ? place.key : '')
        if (board === null) return [rootId]
        return focusOnBoard(board, node, leaf) ?? [...board, idOf({ kind: 'stage', stage: 'Triage' })]
      }
      case 'item': {
        const board = boardPath(place, place.key)
        const own = boardPath({ ...place, via: null }, place.key)
        // An item no stage holds, as an archived one, is under its worktree alone.
        const at = (board === null ? null : itemPath(board, place.key, place.id)) ??
          (own === null ? null : [...own, idOf({ kind: 'item', key: place.key, id: place.id })])
        return at === null ? [rootId] : into(at, node, leaf)
      }
      case 'listing':
      case 'file': {
        const row = rowOfKey(place.key)
        if (row === null) return [rootId]
        const record = idOf({ kind: 'record', page: place.kind === 'file' ? 'file' : place.page, path: place.kind === 'file' ? place.path : '' })
        return into([...worktreePath(row), record], node, leaf)
      }
      case 'union-ledger': {
        const owner = place.filter.kind === 'project'
          ? [rootId, idOf({ kind: 'project', key: place.filter.path })]
          : (() => {
            const home = epicHome(place.filter.name)
            return home === null ? null : [rootId, idOf({ kind: 'project', key: home.key }), idOf({ kind: 'epic', name: place.filter.name })]
          })()
        return owner === null ? [rootId] : into([...owner, idOf({ kind: 'record', page: 'ledger', path: '' })], node, leaf)
      }
    }
  }

  /** A leaf the address names on a board, where it is on the board now; null when it names nothing there. */
  const focusOnBoard = (board: Path, node: Node | null, leaf: string | undefined): Path | null => {
    if (node === null || leaf === undefined) return null
    const union = isUnion(board)
    switch (node.kind) {
      case 'stage': {
        return [...board, leaf]
      }
      case 'part': {
        return union ? [...board, idOf({ kind: 'stage', stage: node.stage }), leaf] : null
      }
      case 'group': {
        const lane = lanesOf(sessions.get(node.key)?.stages ?? []).find((candidate) => candidate.stage === node.stage)
        if (!lane?.entries.some((entry) => entry.kind === 'group' && entry.name === node.name)) return null
        return [
          ...board,
          idOf({ kind: 'stage', stage: node.stage }),
          ...(union ? [idOf({ kind: 'part', key: node.key, stage: node.stage })] : []),
          leaf,
        ]
      }
      case 'item': {
        return itemPath(board, node.key, node.id)
      }
      default: {
        return null
      }
    }
  }

  const structure = { kids, standsFor, normalize, viewOf, focusOf }
  return { ...lookup, ...structure, ...makeWords({ lookup, structure }) }
}

export type Tree = ReturnType<typeof makeTree>
