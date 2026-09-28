import { DaemonApi } from '../lib/api'
import { carried } from '../lib/carry'
import { lanesOf, laneItems } from '../lib/lanes'
import { idOf, nodeOf } from '../levels'
import type { Runner, SurfaceApi, Target } from '../substrate/seam'
import type { RunnerContext } from './shared'
import { copy, focused, nodeAt, reasonOf, writeTo } from './shared'

/** What else an item's commands do: carry it along its lane, open its file in Zed, and copy its id or its file. */

/** An item target as its session holds it, with its stage and its worktree's lanes; null for one no stage holds. */
const lanedItem = (context: RunnerContext, target: Target) => {
  const node = nodeAt({ target, kind: 'item' })
  if (node === null) return null
  const lanes = lanesOf(context.input.data.sessions.get(node.key)?.stages ?? [])
  const lane = lanes.find((candidate) => laneItems(candidate).some((item) => item.id === node.id))
  return lane === undefined ? null : { node, stage: lane.stage, lanes }
}

/** Carries the focused card one step along its lane, the focus following it into or out of its group. */
const carryAlong = async (context: RunnerContext, surface: SurfaceApi, move: { readonly target: Target; readonly by: 1 | -1 }) => {
  const at = lanedItem(context, move.target)
  const write = context.input.write
  const board = at === null ? null : writeTo({ tree: context.tree, key: at.node.key })
  if (at === null || write === null || board === null) return
  const placement = carried({ lanes: at.lanes, id: at.node.id, by: move.by })
  if (typeof placement === 'string') return
  await context.writeOnce(surface, () => write(board, '/api/move', { id: at.node.id, ...placement }), () => {
    const stageAt = move.target.path.findIndex((id) => nodeOf(id)?.kind === 'stage')
    const onBoard = move.target.path.slice(0, stageAt)
    const { key } = at.node
    surface.setFocus([
      ...onBoard,
      idOf({ kind: 'stage', stage: at.stage }),
      ...(context.tree.isUnion(onBoard) ? [idOf({ kind: 'part', key, stage: at.stage })] : []),
      ...(placement.group === null ? [] : [idOf({ kind: 'group', key, stage: at.stage, name: placement.group })]),
      move.target.id,
    ])
  })
}

const along = (context: RunnerContext, by: 1 | -1): Runner => ({
  when: (target, focus) => {
    if (!focused({ target, focus })) return 'Carry along its lane moves the focused card, on its board'
    const at = lanedItem(context, target)
    if (at === null) return 'An item no stage holds does not move'
    if (context.input.write === null) return 'Items move on a board'
    if (at.stage === 'Execute') return 'Execute is frozen; its cards leave only by being completed'
    const placement = carried({ lanes: at.lanes, id: at.node.id, by })
    if (typeof placement === 'string') return placement
    return context.writing ? context.noWrite : true
  },
  run: (target, surface) => carryAlong(context, surface, { target, by }),
})

/** The item's file, absolute, once its session has been read. */
const fileOf = ({ tree, input }: RunnerContext, target: Target) => {
  const node = nodeAt({ target, kind: 'item' })
  const item = node === null ? null : tree.itemOf(node.key, node.id)
  const directory = node === null ? undefined : input.data.sessions.get(node.key)?.directory
  return item === null || directory === undefined ? null : { item, file: `${directory}/${item.path}` }
}

const editor = (context: RunnerContext): Runner => ({
  when: (target) => {
    if (!context.input.capabilities.zed) return 'zed is not on the daemon’s PATH'
    return fileOf(context, target) === null ? 'The item’s session has not been read' : true
  },
  run: async (target, surface) => {
    const found = fileOf(context, target)
    const node = nodeAt({ target, kind: 'item' })
    const row = node === null ? null : context.tree.rowOfKey(node.key)
    if (found === null || row === null) return
    try {
      const result = await DaemonApi.zed({ path: row.path, file: found.item.path })
      surface.flash(result.ok ? `Opened ${found.item.id} in Zed` : result.line)
    } catch (error) {
      surface.flash(reasonOf({ error, fallback: 'The daemon could not be asked' }))
    }
  },
})

export const itemToolRunners = (context: RunnerContext): Record<string, Runner> => ({
  'item.down': along(context, 1),
  'item.up': along(context, -1),
  'item.editor': editor(context),
  'item.copyId': {
    run: async (target, surface) => {
      const node = nodeAt({ target, kind: 'item' })
      if (node !== null) await copy({ text: node.id, surface, what: 'the id' })
    },
  },
  'item.copyPath': {
    when: (target) => (fileOf(context, target) === null ? 'The item’s session has not been read' : true),
    run: async (target, surface) => {
      const found = fileOf(context, target)
      if (found !== null) await copy({ text: found.file, surface, what: 'the path' })
    },
  },
})
