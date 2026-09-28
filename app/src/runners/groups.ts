import { isBatchedStage } from '../../contract'
import { idOf, nodeOf } from '../levels'
import type { Path, Runner, SurfaceApi, Target } from '../substrate/seam'
import type { Place } from '../tree-types'
import type { Tree } from '../tree'
import type { RunnerContext } from './shared'
import { nodeAt, writeTo } from './shared'

/** What a group's commands do: take its cards out of it, rename it where it stands, and queue it as a batch. */

/** The place of the board a focus is on, for the path a write lands a card at. */
const boardPlace = (tree: Tree, focus: Path): Extract<Place, { kind: 'board' | 'union' }> => {
  const stage = focus.findIndex((id) => nodeOf(id)?.kind === 'stage')
  const owner = nodeOf(focus[stage - 1] ?? '')
  if (owner?.kind === 'epic') return { kind: 'union', filter: { kind: 'epic', name: owner.name } }
  if (owner?.kind === 'project') return { kind: 'union', filter: { kind: 'project', path: owner.key } }
  const row = owner?.kind === 'worktree' ? tree.rowAt(owner.path) : null
  return { kind: 'board', key: row?.key ?? '' }
}

/** The ids of a group's items, as its node's children name them. */
const itemsOf = ({ tree }: RunnerContext, target: Target) =>
  tree.kids(target.path).flatMap((id) => {
    const item = nodeOf(id)
    return item?.kind === 'item' ? [item.id] : []
  })

/** Why a group command cannot write: a group no longer drawn, a view with no board, or another write under way. */
const refusedWrite = (context: RunnerContext, target: Target): string | null => {
  if (nodeAt({ target, kind: 'group' }) === null) return 'No such group'
  if (context.input.write === null) return 'Groups change on a board'
  return context.writing ? context.noWrite : null
}

/** The group, its board, and the write, when the command can act. */
const writing = (context: RunnerContext, target: Target) => {
  const node = nodeAt({ target, kind: 'group' })
  const write = context.input.write
  const board = node === null ? null : writeTo({ tree: context.tree, key: node.key })
  return node === null || write === null || board === null ? null : { node, write, board }
}

const ungroup = (context: RunnerContext): Runner => ({
  when: (target) => {
    const node = nodeAt({ target, kind: 'group' })
    if (node !== null && isBatchedStage(node.stage)) {
      return node.stage === 'Queue' ? 'A queued item leaves its batch only by leaving Queue' : 'Execute is frozen; its batch stays as it started'
    }
    return refusedWrite(context, target) ?? true
  },
  run: async (target, surface) => {
    const at = writing(context, target)
    if (at === null) return
    const ids = itemsOf(context, target)
    await context.writeOnce(surface, () => at.write(at.board, '/api/ungroup', { ids }), () => landOnFirst(context, surface, { node: at.node, ids }))
  },
})

/** The focus, once a group is taken apart, on its first card where it now stands in no group. */
const landOnFirst = (context: RunnerContext, surface: SurfaceApi, group: { readonly node: { readonly key: string; readonly stage: 'Triage' | 'Design' | 'Batch' | 'Queue' | 'Execute' }; readonly ids: readonly string[] }) => {
  const { tree } = context
  const first = group.ids[0]
  const board = tree.boardPath(boardPlace(tree, surface.focus), group.node.key)
  if (first === undefined || board === null) return
  const { key, stage } = group.node
  surface.setFocus([
    ...board,
    idOf({ kind: 'stage', stage }),
    ...(tree.isUnion(board) ? [idOf({ kind: 'part', key, stage })] : []),
    idOf({ kind: 'item', key, id: first }),
  ])
}

const rename = (context: RunnerContext): Runner => ({
  when: (target) => (nodeAt({ target, kind: 'group' })?.stage === 'Execute' ? 'Execute is frozen; its batch keeps its name' : refusedWrite(context, target) ?? true),
  run: (target, surface) => {
    const at = writing(context, target)
    if (at === null) return
    const { node, write, board } = at
    surface.askName({
      title: `Rename the ${node.stage === 'Queue' ? 'batch' : 'group'} ${node.name}`,
      meaning: `It keeps its place in ${node.stage}; a name the stage already has is refused.`,
      value: node.name,
      placeholder: 'A name for the group',
      confirm: (name) =>
        name === node.name
          ? Promise.resolve(null)
          : context.writeOnce(surface, () => write(board, '/api/rename-group', { stage: node.stage, from: node.name, to: name }), () =>
            surface.setFocus(target.path.map((id) => (id === target.id ? idOf({ ...node, name }) : id)))),
    })
  },
})

const queue = (context: RunnerContext): Runner => ({
  when: (target) => (nodeAt({ target, kind: 'group' })?.stage === 'Batch' ? refusedWrite(context, target) ?? true : 'A group is queued as a batch from Batch'),
  run: (target, surface) => {
    const at = writing(context, target)
    if (at === null) return
    const ids = itemsOf(context, target)
    surface.askName({
      title: `Queue the group ${at.node.name} as a batch`,
      meaning: 'Its items wait in Queue as one named batch, and the group goes with them.',
      value: at.node.name,
      placeholder: 'What outcome unites this work?',
      confirm: (name) => context.writeOnce(surface, () => at.write(at.board, '/api/batch', { ids, name })),
    })
  },
})

export const groupRunners = (context: RunnerContext): Record<string, Runner> => ({
  'group.ungroup': ungroup(context),
  'group.rename': rename(context),
  'group.queue': queue(context),
})
