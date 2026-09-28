import type { Stage } from '../../contract'
import { laneItems, lanesOf } from '../lib/lanes'
import { idOf, nodeOf } from '../levels'
import type { Runner, SurfaceApi, Target } from '../substrate/seam'
import { groupRunners } from './groups'
import type { RunnerContext } from './shared'
import { nodeAt, plural, writeTo } from './shared'

/** What a lane's commands do: gather the marked cards into a group or a batch, and start the first batch. */

const stageOf = (target: Target): Stage | null => nodeAt({ target, kind: 'stage' })?.stage ?? null

/** The cards a lane command takes: the marks of this lane in one worktree, else the focused card, in the lane's order. */
const cardsIn = ({ input }: RunnerContext, stage: Stage, surface: SurfaceApi): { readonly key: string; readonly ids: readonly string[] } | string => {
  const laneOf = (key: string) => lanesOf(input.data.sessions.get(key)?.stages ?? []).find((candidate) => candidate.stage === stage)
  const marked = [...surface.marks].flatMap((id) => {
    const node = nodeOf(id)
    if (node?.kind !== 'item') return []
    const lane = laneOf(node.key)
    return lane !== undefined && laneItems(lane).some((item) => item.id === node.id) ? [node] : []
  })
  const focusNode = nodeOf(surface.focus.at(-1) ?? '')
  const inLane = focusNode?.kind === 'item' && surface.focus.includes(idOf({ kind: 'stage', stage }))
  const cards = marked.length > 0 ? marked : inLane && focusNode.kind === 'item' ? [focusNode] : []
  const keys = [...new Set(cards.map((card) => card.key))]
  if (cards.length === 0) return `Mark cards in ${stage} with Space, or focus one, first`
  if (keys.length > 1) return `The marks are in ${keys.length} worktrees; a group lives in one worktree’s lane`
  const key = keys[0] ?? ''
  const lane = laneOf(key)
  const order = lane === undefined ? [] : laneItems(lane).map((item) => item.id)
  return { key, ids: order.filter((id) => cards.some((card) => card.id === id)) }
}

/** Gathers the cards a lane command takes under a name asked for, into a group of the lane or a batch for Queue. */
const gather = (context: RunnerContext, surface: SurfaceApi, into: { readonly stage: Stage; readonly as: 'group' | 'batch' }) => {
  const write = context.input.write
  const cards = cardsIn(context, into.stage, surface)
  if (typeof cards === 'string') {
    surface.flash(cards)
    return
  }
  const board = writeTo({ tree: context.tree, key: cards.key })
  if (write === null || board === null) return
  const count = plural({ count: cards.ids.length, one: 'card' })
  surface.askName({
    title: into.as === 'group' ? `Gather ${count} of ${into.stage} under a name` : `Queue ${count} as a batch`,
    meaning: into.as === 'group' ? `A name ${into.stage} already has adds them to that group.` : 'They wait in Queue as one named batch, after the batches there.',
    value: '',
    placeholder: into.as === 'group' ? 'What do these items have in common?' : 'What outcome unites this work?',
    confirm: (name) =>
      context.writeOnce(surface, () => write(board, into.as === 'group' ? '/api/group' : '/api/batch', { ids: cards.ids, name }), () => surface.clearMarks()),
  })
}

const group = (context: RunnerContext): Runner => ({
  when: (target) => {
    const stage = stageOf(target)
    if (stage === null) return 'No such stage'
    if (context.input.write === null) return 'Groups are made on a board'
    if (stage === 'Queue') return 'In Queue a group is a batch, composed from Batch'
    if (stage === 'Execute') return 'Execute is frozen; its batch stays as it started'
    return context.writing ? context.noWrite : true
  },
  run: (target, surface) => {
    const stage = stageOf(target)
    if (stage !== null) gather(context, surface, { stage, as: 'group' })
  },
})

const batch = (context: RunnerContext): Runner => ({
  when: (target) => {
    if (stageOf(target) !== 'Batch') return 'A batch is queued from Batch'
    if (context.input.write === null) return 'Batches are queued on a board'
    return context.writing ? context.noWrite : true
  },
  run: (_target, surface) => gather(context, surface, { stage: 'Batch', as: 'batch' }),
})

/** The worktree whose batch starts: the one the focus is in, else the board's one worktree. */
const starter = ({ tree }: RunnerContext, target: Target, focus: readonly string[]) =>
  tree.keyIn(focus) ?? (tree.isUnion(target.path.slice(0, -1)) ? null : tree.keyIn(target.path))

const start = (context: RunnerContext): Runner => ({
  when: (target, focus) => {
    if (stageOf(target) !== 'Queue') return 'The first batch starts from Queue'
    if (context.input.write === null) return 'A batch is started on a board'
    const key = starter(context, target, focus)
    if (key === null) return 'Focus a worktree’s part of Queue to say whose batch starts'
    const session = context.input.data.sessions.get(key)
    const count = (stage: Stage) => session?.stages.find((candidate) => candidate.stage === stage)?.items.length ?? 0
    if (count('Queue') === 0) return 'Queue holds no batch to start'
    if (count('Execute') > 0) return 'Execute still holds a batch; complete its items first'
    return context.writing ? context.noWrite : true
  },
  run: async (target, surface) => {
    const key = starter(context, target, surface.focus)
    const board = key === null ? null : writeTo({ tree: context.tree, key })
    const write = context.input.write
    if (board !== null && write !== null) {
      await context.writeOnce(surface, () => write(board, '/api/start', {}), () => surface.flash('The first batch moved on to Execute'))
    }
  },
})

export const laneRunners = (context: RunnerContext): Record<string, Runner> => ({
  'stage.group': group(context),
  'stage.batch': batch(context),
  'stage.start': start(context),
  ...groupRunners(context),
})
