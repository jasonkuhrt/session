import type { Item, Stage, WorktreeSummary } from '../contract'
import { stageDirectory, stageNames } from '../contract'
import { worktreeFacts } from './components/marks'
import { acrossName, sectionKeyOf } from './lib/dashboard'
import { indexMeaning } from './lib/index-meanings'
import { laneItems, lanesOf } from './lib/lanes'
import { groupMeta, stageHint } from './lib/workflow'
import { idOf, nodeOf, rootId } from './levels'
import type { Fact, Path } from './substrate/seam'
import type { Lookup } from './tree-lookup'
import { isUnion } from './tree-lookup'
import type { Entry } from './tree-types'

/** The facts of the focused node, for the detail line, by what it is. */

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`

/** The directory an item's file is in, under the session: its stage's, or its group's. */
const directoryOf = (item: Item) => item.path.split('/').slice(0, -1).join('/')

export function makeFacts({ lookup, words }: {
  readonly lookup: Lookup
  readonly words: {
    readonly label: (path: Path) => string
    readonly meaningOf: (path: Path) => string
    readonly entriesOf: (owner: string) => readonly Entry[]
  }
}) {
  const { data, rows, sessions, rowAt, rowOfKey, sectionOf, epicHome, epicCard, headRow, keyIn, unionRows, itemOf } = lookup
  const { label, meaningOf, entriesOf } = words
  const facts = (path: Path): readonly Fact[] => {
    const id = path.at(-1) ?? ''
    const node = nodeOf(id)
    if (node === null) return []
    switch (node.kind) {
      case 'all': {
        return [{ key: 'all', text: plural(rows.length, 'worktree'), meaning: indexMeaning }]
      }
      case 'project': {
        return projectFacts(node.key)
      }
      case 'epic': {
        return epicFacts(node.name)
      }
      case 'worktree': {
        const row = rowAt(node.path)
        if (row === null) return [{ key: 'path', text: node.path, meaning: 'Where the worktree is.' }]
        if (!row.resolved) {
          return [
            { key: 'path', text: row.path, meaning: 'A path the daemon holds that Git did not answer for.' },
            { key: 'line', text: <span className="text-destructive">{row.conflict ?? 'Git gave no reason.'}</span>, meaning: 'Git’s own line.' },
            { key: 'again', text: 'asked again at every take-on and rescan', meaning: 'The daemon keeps the path and asks Git about it again.' },
          ]
        }
        return worktreeFactsOf(row)
      }
      case 'stage': {
        const board = path.slice(0, -1)
        const directory = `${stageDirectory(node.stage)}/`
        if (isUnion(board)) {
          const members = unionRows(board)
          const count = members.reduce((sum, row) => sum + (findLaneCount(row.key, node.stage)), 0)
          return [
            { key: 'stage', text: node.stage, meaning: stageHint[node.stage] },
            { key: 'count', text: `${plural(count, 'item')} across ${plural(members.length, 'worktree')}`, meaning: 'How many items this lane holds on the board.' },
            { key: 'directory', text: directory, meaning: 'The stage’s directory in each session.' },
          ]
        }
        const key = keyIn(board)
        const lane = key === null ? undefined : lanesOf(sessions.get(key)?.stages ?? []).find((candidate) => candidate.stage === node.stage)
        const groups = lane?.entries.filter((entry) => entry.kind === 'group').length ?? 0
        const batched = node.stage === 'Queue' || node.stage === 'Execute'
        return [
          { key: 'stage', text: node.stage, meaning: stageHint[node.stage] },
          {
            key: 'count',
            text: `${plural(lane === undefined ? 0 : laneItems(lane).length, 'item')}${groups === 0 ? '' : `, ${plural(groups, batched ? 'batch' : 'group', batched ? 'batches' : 'groups')}`}`,
            meaning: 'How many items and groups this lane holds.',
          },
          { key: 'directory', text: directory, meaning: 'The stage’s directory in the session.' },
        ]
      }
      case 'part': {
        const row = rowOfKey(node.key)
        return [
          { key: 'part', text: `${label(path)} in ${node.stage}`, meaning: meaningOf(path) },
          { key: 'count', text: plural(findLaneCount(node.key, node.stage), 'item'), meaning: 'How many items the worktree has in this lane.' },
          ...(row === null ? [] : worktreeFactsOf(row).slice(1)),
        ]
      }
      case 'group': {
        const lane = lanesOf(sessions.get(node.key)?.stages ?? []).find((candidate) => candidate.stage === node.stage)
        const group = lane?.entries.find((entry) => entry.kind === 'group' && entry.name === node.name)
        const items = group?.kind === 'group' ? group.items : []
        const first = items[0]
        return [
          { key: 'group', text: node.name, meaning: groupMeta[node.stage].heading },
          { key: 'count', text: plural(items.length, 'item'), meaning: 'How many items the group holds.' },
          ...(first === undefined ? [] : [{ key: 'directory', text: `${directoryOf(first)}/`, meaning: 'The group’s directory in the session.' }]),
        ]
      }
      case 'item': {
        const item = itemOf(node.key, node.id)
        if (item === null) return [{ key: 'id', text: node.id, meaning: 'The item’s id.' }]
        return [
          { key: 'id', text: node.id, meaning: 'The item’s id, the same in every stage.' },
          { key: 'path', text: item.path, meaning: 'The item’s file, under the session.' },
          ...(item.summary === '' ? [] : [{ key: 'summary', text: item.summary, meaning: 'The start of the item’s first paragraph.' }]),
        ]
      }
      case 'section': {
        const owner = path.at(-2) ?? ''
        const entry = entriesOf(owner).find((candidate) => candidate.at === node.at)
        return [
          { key: 'heading', text: entry?.heading ?? node.at, meaning: meaningOf(path) },
          ...(entry?.facts ?? []),
        ]
      }
      case 'record': {
        const entries = data.entries.get(id) ?? []
        return [
          { key: 'page', text: label(path), meaning: meaningOf(path) },
          ...(node.page === 'file' ? [] : [{ key: 'count', text: plural(entries.length, 'entry', 'entries'), meaning: 'How many entries the page lists.' }]),
        ]
      }
    }
  }

  const findLaneCount = (key: string, stage: Stage) =>
    sessions.get(key)?.stages.find((candidate) => candidate.stage === stage)?.items.length ??
      rowOfKey(key)?.counts[stage] ?? 0

  const worktreeFactsOf = (row: WorktreeSummary): Fact[] => worktreeFacts({ name: row.name, signals: data.signalsOf(row), now: data.now })

  const projectFacts = (key: string): Fact[] => {
    const section = sectionOf(key)
    if (section === null) return [{ key: 'project', text: key, meaning: 'The project.' }]
    if (section.kind === 'across') {
      return [
        { key: 'name', text: acrossName, meaning: meaningOf([rootId, idOf({ kind: 'project', key })]) },
        { key: 'epics', text: plural(section.cards.length, 'epic'), meaning: 'How many epics span more than one project.' },
      ]
    }
    const count = rows.filter((row) => row.resolved && sectionKeyOf(row) === key).length
    const head = headRow(section)
    const word = section.head.kind === 'tracked'
      ? 'main worktree'
      : section.head.kind === 'untracked'
      ? 'Not tracked'
      : section.head.kind === 'bare'
      ? 'Git directory'
      : 'Outside Git'
    return [
      { key: 'name', text: section.name, meaning: key },
      { key: 'head', text: word, meaning: 'What heads the project.' },
      { key: 'count', text: plural(count, 'worktree'), meaning: 'How many worktrees of the project the daemon tracks.' },
      ...(head === null ? [] : worktreeFactsOf(head).slice(1)),
    ]
  }

  const epicFacts = (name: string): Fact[] => {
    const card = epicCard(name)
    const members = card?.rows ?? []
    const home = epicHome(name)
    const open = members.reduce((sum, row) => sum + stageNames.reduce((count, stage) => count + row.counts[stage], 0), 0)
    const live = members.flatMap((row) => row.agents.claude.filter((session) => session.pid !== null))
    return [
      { key: 'name', text: name, meaning: `The epic “${name}”.` },
      {
        key: 'count',
        text: `${plural(members.length, 'worktree')}${home === null || home.kind === 'across' ? ' across projects' : ` in ${home.name}`}`,
        meaning: 'The worktrees whose sessions name the epic.',
      },
      { key: 'open', text: plural(open, 'open item'), meaning: 'Every item in the epic’s sessions.' },
      { key: 'live', text: plural(live.length, 'live agent'), meaning: 'Claude Code sessions with a process in the epic’s worktrees.' },
    ]
  }

  return facts
}
