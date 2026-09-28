import { IndexApi } from '../lib/api'
import { sectionRowOf } from '../lib/dashboard'
import { landingAt, sectionsList } from '../lib/order'
import { idOf, rootId } from '../levels'
import type { Runner, SurfaceApi, Target } from '../substrate/seam'
import type { RunnerContext } from './shared'
import { focused, nodeAt, onBoardOf, openBoard, place, reasonOf } from './shared'

/** What the commands of a project and of an epic do: open their boards and ledgers, carry a project, rename an epic. */

const ledgerOf = (target: Target, surface: SurfaceApi) =>
  surface.setFocus([...target.path, idOf({ kind: 'record', page: 'ledger', path: '' })])

/** Places the focused project one step down the index, `by` 1, or up it, by its main worktree's rank. */
const carryProject = async ({ context, target, surface, by }: {
  readonly context: RunnerContext
  readonly target: Target
  readonly surface: SurfaceApi
  readonly by: 1 | -1
}) => {
  const { tree } = context
  const node = nodeAt({ target, kind: 'project' })
  const entries = tree.dashboard.sections
  const held = entries.find((section) => section.key === node?.key)
  const main = held === undefined ? null : sectionRowOf(held)
  if (held === undefined || main === null) return
  const slot = entries.indexOf(held) + by
  if (slot < 0 || slot >= entries.length) {
    surface.flash(`${tree.label(target.path)} is already ${by === 1 ? 'last' : 'first'}`)
    return
  }
  const landing = landingAt({
    list: sectionsList,
    entries,
    held,
    slot,
    idOf: (section) => section.key,
    pathOf: (section) => sectionRowOf(section)?.path ?? null,
    rankOf: (section) => sectionRowOf(section)?.rank ?? null,
    nameOf: (section) => (section.kind === 'across' ? 'Across projects' : section.name),
  })
  if (landing === null) {
    const past = entries[slot]
    const name = past === undefined ? 'the next project' : past.kind === 'across' ? 'Across projects' : past.name
    surface.flash(`${tree.label(target.path)} cannot go past ${name}, which has no main worktree’s session to keep a place in`)
    return
  }
  await context.writeOnce(surface, () => place({ context, write: { path: main.path, before: landing.before, after: landing.after } }))
}

const carry = (context: RunnerContext, by: 1 | -1): Runner => ({
  when: (target, focus) => {
    if (!focused({ target, focus })) return 'Carry moves the focused project, on the index'
    const node = nodeAt({ target, kind: 'project' })
    const section = node === null ? null : context.tree.sectionOf(node.key)
    if (section === null) return 'No such project'
    if (sectionRowOf(section) === null) {
      return `${context.tree.label(target.path)} has no main worktree’s session to keep a place in, so it stands after the projects placed by hand`
    }
    return context.writing ? context.noWrite : true
  },
  run: (target, surface) => carryProject({ context, target, surface, by }),
})

const openProject = ({ tree }: RunnerContext): Runner => ({
  when: (target, focus) => {
    const node = nodeAt({ target, kind: 'project' })
    if (node === null) return 'No such project'
    if (node.key === 'across') return 'Across projects has no board of its own: each epic in it has one'
    return onBoardOf({ tree, focus, id: target.id }) ? `This is the board of ${tree.label(target.path)}` : true
  },
  run: (target, surface) => {
    const section = tree.sectionOf(nodeAt({ target, kind: 'project' })?.key ?? '')
    const head = tree.headRow(section)
    // A project of one worktree, its head, is that worktree's board.
    if (section?.kind === 'project' && section.cards.length === 0 && head !== null && head.conflict === null) {
      openBoard({ board: tree.worktreePath(head), surface })
      return
    }
    openBoard({ board: target.path, surface })
  },
})

export const projectRunners = (context: RunnerContext): Record<string, Runner> => ({
  'project.open': openProject(context),
  'project.down': carry(context, 1),
  'project.up': carry(context, -1),
  'project.ledger': {
    when: (target) => (nodeAt({ target, kind: 'project' })?.key === 'across' ? 'Across projects has no ledger of its own: each epic in it has one' : true),
    run: ledgerOf,
  },
})

/**
 * Renames an epic through the daemon, which moves whoever is in it, then
 * reads the rows again. From the epic's own board or ledger, whose address
 * names the old name, the view moves to the new name first, in place of its
 * history entry, and the rows are read once it is there, so no frame reads an
 * epic nothing names; on the index the focus follows the epic once the rows
 * have it.
 */
const renameEpic = ({ context, surface, from, to }: {
  readonly context: RunnerContext
  readonly surface: SurfaceApi
  readonly from: string
  readonly to: string
}) => {
  const was = idOf({ kind: 'epic', name: from })
  const now = idOf({ kind: 'epic', name: to })
  const inside = surface.focus.indexOf(was) !== -1 && surface.focus.indexOf(was) < surface.focus.length - 1
  return context.writeOnce(surface, async () => {
    try {
      await IndexApi.renameEpic({ from, to })
      if (inside) await surface.relocate(surface.focus.map((id) => (id === was ? now : id)))
      await context.input.readRows()
      return null
    } catch (error) {
      return reasonOf({ error, fallback: 'The rename could not be written' })
    }
  }, () => {
    const home = context.tree.epicHome(from)
    if (!inside && home !== null) surface.setFocus([rootId, idOf({ kind: 'project', key: home.key }), now])
  })
}

export const epicRunners = (context: RunnerContext): Record<string, Runner> => ({
  'epic.open': {
    when: (target, focus) => (onBoardOf({ tree: context.tree, focus, id: target.id }) ? `This is the board of ${context.tree.label(target.path)}` : true),
    run: (target, surface) => openBoard({ board: target.path, surface }),
  },
  'epic.rename': {
    when: () => (context.writing ? context.noWrite : true),
    run: (target, surface) => {
      const from = nodeAt({ target, kind: 'epic' })?.name
      if (from === undefined) return
      surface.askName({
        title: `Rename the epic ${from}`,
        meaning: 'Every worktree in it takes the new name, in the order it stands. A name another epic already has merges the two.',
        value: from,
        placeholder: 'What do these worktrees serve together?',
        confirm: (to) => (to === from ? Promise.resolve(null) : renameEpic({ context, surface, from, to })),
      })
    },
  },
  'epic.ledger': { run: ledgerOf },
})
