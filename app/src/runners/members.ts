import type { WorktreeSummary } from '../../contract'
import { IndexApi } from '../lib/api'
import { epicList, landingAt } from '../lib/order'
import { idOf, nodeOf } from '../levels'
import type { Runner, SurfaceApi, Target } from '../substrate/seam'
import type { RunnerContext } from './shared'
import { focused, place, plural, reasonOf, rowOfTarget } from './shared'

/**
 * What a worktree's commands about its epic do: join an epic, new or
 * existing, leave its epic, and take a place within it. Each takes the
 * marked worktrees when there are any, else the focused one, as the drops
 * they stand for take the worktrees dropped.
 */

/** The worktrees a command about epics takes: the marked ones, else the focused one. */
const chosen = ({ tree }: RunnerContext, target: Target, surface: SurfaceApi) => {
  const marked = [...surface.marks].flatMap((id) => {
    const node = nodeOf(id)
    const row = node?.kind === 'worktree' ? tree.rowAt(node.path) : null
    return row === null || row.main || !row.resolved ? [] : [row]
  })
  const row = rowOfTarget({ tree, target })
  return marked.length > 0 ? marked : row === null ? [] : [row]
}

/** Puts worktrees in an epic, or in none, one request each, against the epic each was drawn in, then reads the rows again. */
const setEpic = (context: RunnerContext, surface: SurfaceApi, change: { readonly rows: readonly WorktreeSummary[]; readonly epic: string | null }) => {
  const { rows, epic } = change
  const count = plural({ count: rows.length, one: 'worktree' })
  return context.writeOnce(surface, async () => {
    const results = await Promise.allSettled(rows.map((row) => IndexApi.setEpic({ path: row.path, epic, from: row.epic })))
    await context.input.readRows()
    const refused = results.flatMap((result) =>
      result.status === 'rejected' ? [reasonOf({ error: result.reason, fallback: 'The epic could not be written' })] : []
    )
    return refused.length === 0 ? null : [...new Set(refused)].join(' ')
  }, () => {
    surface.unmark(rows.map((row) => idOf({ kind: 'worktree', path: row.path })))
    surface.flash(epic === null ? `${count} left ${rows.length === 1 ? 'its epic' : 'their epics'}` : `${count} in ${epic}`)
  })
}

const join = (context: RunnerContext): Runner => ({
  when: (target) => {
    const row = rowOfTarget({ tree: context.tree, target })
    if (row === null || !row.resolved) return 'A path Git did not answer for is in no epic'
    if (row.main) return 'A main worktree is never in an epic'
    return context.writing ? context.noWrite : true
  },
  run: (target, surface) => {
    const rows = chosen(context, target, surface)
    const names = [...new Set(context.input.data.rows.flatMap((row) => (row.main || row.epic === null ? [] : [row.epic])))]
    surface.askName({
      title: rows.length === 1 ? `Put ${rows[0]?.name ?? 'the worktree'} in an epic` : `Put ${plural({ count: rows.length, one: 'worktree' })} in an epic`,
      meaning: names.length === 0
        ? 'A new epic of this name is made. A worktree is in one epic at most, so it leaves any other.'
        : `The epics there are: ${names.join(', ')}. A name no epic has makes a new one. A worktree is in one epic at most.`,
      value: '',
      placeholder: 'What do these worktrees serve together?',
      confirm: (name) => setEpic(context, surface, { rows, epic: name }),
    })
  },
})

const leave = (context: RunnerContext): Runner => ({
  when: (target) => {
    const row = rowOfTarget({ tree: context.tree, target })
    if (row === null || row.epic === null || row.main) return `${row?.name ?? 'It'} is in no epic`
    return context.writing ? context.noWrite : true
  },
  run: async (target, surface) => {
    await setEpic(context, surface, { rows: chosen(context, target, surface).filter((row) => row.epic !== null), epic: null })
  },
})

/** Places the focused worktree one step down its epic, `by` 1, or up it. */
const carryWorktree = async (context: RunnerContext, surface: SurfaceApi, move: { readonly target: Target; readonly by: 1 | -1 }) => {
  const row = rowOfTarget({ tree: context.tree, target: move.target })
  const card = row?.epic === null || row?.epic === undefined ? null : context.tree.epicCard(row.epic)
  if (row === null || card === null) return
  const entries = card.rows
  const held = entries.find((entry) => entry.path === row.path)
  if (held === undefined) return
  const slot = entries.indexOf(held) + move.by
  if (slot < 0 || slot >= entries.length) {
    surface.flash(`${row.name} is already ${move.by === 1 ? 'last' : 'first'} in ${card.name}`)
    return
  }
  const landing = landingAt({
    list: epicList(card.name),
    entries,
    held,
    slot,
    idOf: (entry) => entry.path,
    pathOf: (entry) => entry.path,
    rankOf: (entry) => entry.rank,
    nameOf: (entry) => entry.name,
  })
  if (landing !== null) await context.writeOnce(surface, () => place({ context, write: { path: row.path, before: landing.before, after: landing.after } }))
}

const carry = (context: RunnerContext, by: 1 | -1): Runner => ({
  when: (target, focus) => {
    if (!focused({ target, focus })) return 'Carry moves the focused worktree, on the index'
    const row = rowOfTarget({ tree: context.tree, target })
    if (row === null || !row.resolved) return 'A path Git did not answer for has no place to take'
    if (row.main) return 'A main worktree places its project: carry the project'
    if (row.epic === null) return `${row.name} is in no epic, so it stands by what is happening in it; join an epic to place it`
    return context.writing ? context.noWrite : true
  },
  run: (target, surface) => carryWorktree(context, surface, { target, by }),
})

export const memberRunners = (context: RunnerContext): Record<string, Runner> => ({
  'worktree.join': join(context),
  'worktree.leave': leave(context),
  'worktree.down': carry(context, 1),
  'worktree.up': carry(context, -1),
})
