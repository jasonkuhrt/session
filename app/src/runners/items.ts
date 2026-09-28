import type { Stage } from '../../contract'
import { stageNames } from '../../contract'
import { lanesOf, laneItems } from '../lib/lanes'
import { moveAvailability } from '../lib/workflow'
import { idOf, nodeOf } from '../levels'
import type { Path, Runner, SurfaceApi, Target } from '../substrate/seam'
import { itemToolRunners } from './item-tools'
import type { RunnerContext } from './shared'
import { nodeAt, writeTo } from './shared'

/** What an item's commands do: open its page, carry it to another stage, and complete it. */

/** An item target as its session holds it: its node, the item, its stage, and its worktree's lanes; null for one no stage holds. */
const itemAt = ({ context, target }: { readonly context: RunnerContext; readonly target: Target }) => {
  const node = nodeAt({ target, kind: 'item' })
  if (node === null) return null
  const lanes = lanesOf(context.input.data.sessions.get(node.key)?.stages ?? [])
  for (const lane of lanes) {
    const item = laneItems(lane).find((candidate) => candidate.id === node.id)
    if (item !== undefined) return { node, item, stage: lane.stage, lanes }
  }
  return null
}

/** The item's path once it stands in another stage: its board's, its part's on a union, and its page's section when it is on its page. */
const movedPath = ({ tree }: RunnerContext, target: Target, move: { readonly focus: Path; readonly stage: Stage }): Path | null => {
  const node = nodeAt({ target, kind: 'item' })
  const stageAt = target.path.findIndex((id) => nodeOf(id)?.kind === 'stage')
  if (node === null || stageAt === -1) return null
  const board = target.path.slice(0, stageAt)
  return [
    ...board,
    idOf({ kind: 'stage', stage: move.stage }),
    ...(tree.isUnion(board) ? [idOf({ kind: 'part', key: node.key, stage: move.stage })] : []),
    target.id,
    ...move.focus.slice(target.path.length),
  ]
}

/** Moves an item to another stage of its own worktree, the focus following it there. */
const moveTo = async (context: RunnerContext, surface: SurfaceApi, move: { readonly target: Target; readonly to: Stage }) => {
  const at = itemAt({ context, target: move.target })
  const write = context.input.write
  const board = at === null ? null : writeTo({ tree: context.tree, key: at.node.key })
  if (at === null || write === null || board === null) return
  await context.writeOnce(surface, () => write(board, '/api/move', { id: at.item.id, to: move.to }), () => {
    const path = movedPath(context, move.target, { focus: surface.focus, stage: move.to })
    if (path !== null) surface.setFocus(path)
  })
}

const step = (context: RunnerContext, by: 1 | -1): Runner => ({
  when: (target) => {
    const at = itemAt({ context, target })
    if (at === null) return 'An item no stage holds does not move'
    if (context.input.write === null) return 'Items move on a board'
    const to = stageNames[stageNames.indexOf(at.stage) + by]
    if (to === undefined) return by === 1 ? 'Execute is the last stage' : 'Triage is the first stage'
    const availability = moveAvailability(at.item, at.stage, to)
    if (!availability.enabled) return availability.reason ?? `It cannot go to ${to}`
    return context.writing ? context.noWrite : true
  },
  run: async (target, surface) => {
    const at = itemAt({ context, target })
    const to = at === null ? undefined : stageNames[stageNames.indexOf(at.stage) + by]
    if (to !== undefined) await moveTo(context, surface, { target, to })
  },
})

const toStage = (context: RunnerContext): Runner => ({
  when: (target) => {
    const at = itemAt({ context, target })
    if (at === null) return 'An item no stage holds does not move'
    if (context.input.write === null) return 'Items move on a board'
    if (stageNames.some((stage) => moveAvailability(at.item, at.stage, stage).enabled)) return true
    return moveAvailability(at.item, at.stage, 'Triage').reason ?? 'It can go to no other stage'
  },
  run: (target, surface) => {
    const at = itemAt({ context, target })
    if (at === null) return
    surface.choose({
      prompt: `Move ${at.item.id} from ${at.stage} to`,
      choices: stageNames.filter((stage) => moveAvailability(at.item, at.stage, stage).enabled).map((stage) => ({
        key: stage,
        name: stage,
        on: `from ${at.stage}`,
        run: () => moveTo(context, surface, { target, to: stage }),
      })),
    })
  },
})

const open = ({ tree }: RunnerContext): Runner => ({
  when: (target, focus) => {
    const node = nodeAt({ target, kind: 'item' })
    if (node === null || tree.itemOf(node.key, node.id) === null) return 'No such item'
    return focus.length > target.path.length ? 'This is its page' : true
  },
  run: (target, surface) => {
    const child = surface.recall(target.path, tree.kids(target.path))
    if (child !== null) surface.setFocus([...target.path, child])
  },
})

/** Completes an item after a one-line confirm, the focus moving to its neighbour on the board. */
const complete = (context: RunnerContext): Runner => ({
  when: (target) => {
    if (itemAt({ context, target })?.stage !== 'Execute') return 'Only an item in Execute is completed'
    if (context.input.write === null) return 'Items are completed on a board'
    return context.writing ? context.noWrite : true
  },
  run: (target, surface) => {
    const at = itemAt({ context, target })
    const write = context.input.write
    const board = at === null ? null : writeTo({ tree: context.tree, key: at.node.key })
    if (at === null || write === null || board === null) return
    const siblings = context.tree.kids(target.path.slice(0, -1))
    const index = siblings.indexOf(target.id)
    const neighbour = siblings[index + 1] ?? siblings[index - 1]
    const landed = () => {
      surface.flash(`Filed ${at.item.id} as done`)
      if (surface.focus.length > target.path.length) return
      surface.setFocus(neighbour === undefined ? target.path.slice(0, -1) : [...target.path.slice(0, -1), neighbour])
    }
    surface.choose({
      prompt: `Complete ${at.item.id}?`,
      choices: [{
        key: 'complete',
        name: `Complete ${at.item.title}`,
        on: 'it leaves Execute and is filed under archive/ as done',
        run: () => context.writeOnce(surface, () => write(board, '/api/complete', { id: at.item.id }), landed),
      }],
    })
  },
})

export const itemRunners = (context: RunnerContext): Record<string, Runner> => ({
  'item.open': open(context),
  'item.previous': step(context, -1),
  'item.next': step(context, 1),
  'item.stage': toStage(context),
  'item.complete': complete(context),
  ...itemToolRunners(context),
})
