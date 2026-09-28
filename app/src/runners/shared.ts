import type { WorktreeSummary } from '../../contract'
import { stageNames } from '../../contract'
import { IndexApi } from '../lib/api'
import { boardOf } from '../lib/filter'
import type { Node } from '../levels'
import { idOf, nodeOf } from '../levels'
import type { SeamInput } from '../session-seam'
import { samePath } from '../substrate/path'
import type { Path, Recall, Runner, SurfaceApi, Target } from '../substrate/seam'
import type { Tree } from '../tree'

/**
 * What every runner of session's commands shares: what it reads, the view's
 * input and the tree of what the view drew, and the small ways it names,
 * copies, opens and places things.
 */

/** Everything a runner reads: the tree, the view's input, the focus, and the ways to move it and to write. */
export type RunnerContext = {
  readonly tree: Tree
  readonly input: SeamInput
  readonly focus: Path
  readonly writeOnce: (surface: SurfaceApi, write: () => Promise<string | null>, landed?: () => void) => Promise<string | null>
  readonly writing: boolean
  readonly noWrite: string
}

export const plural = ({ count, one }: { readonly count: number; readonly one: string }) => `${count} ${count === 1 ? one : `${one}s`}`

/** Copies a value, saying in the detail line what was copied, or that the clipboard refused it. */
export const copy = async ({ text, surface, what }: { readonly text: string; readonly surface: SurfaceApi; readonly what: string }) => {
  try {
    await navigator.clipboard.writeText(text)
    surface.flash(`Copied ${what}: ${text}`)
  } catch {
    surface.flash(`The clipboard refused the copy of ${what}.`)
  }
}

export const reasonOf = ({ error, fallback }: { readonly error: unknown; readonly fallback: string }) =>
  error instanceof Error ? error.message : fallback

/** A target's node, which a runner of its scope expects. */
export const nodeAt = <K extends Node['kind']>({ target, kind }: { readonly target: Target; readonly kind: K }): Extract<Node, { kind: K }> | null => {
  const node = nodeOf(target.id)
  return node?.kind === kind ? (node as Extract<Node, { kind: K }>) : null
}

/** Whether the target is the focus itself rather than a node above it. */
export const focused = ({ target, focus }: { readonly target: Target; readonly focus: Path }) => samePath({ left: target.path, right: focus })

/** The stage ids, which a board's focus goes into at the one last focused. */
const stageIds = stageNames.map((stage) => idOf({ kind: 'stage', stage }))

/** A board's focus as it opens: the stage last focused there, else the first. */
export const boardFocus = ({ board, recall }: { readonly board: Path; readonly recall: Recall }): Path =>
  [...board, recall(board, stageIds) ?? stageIds[0] ?? '']

/**
 * A command that opens another page: where it takes the focus, which running
 * it goes to and a node whose Enter it is links to, and whether it can.
 */
export const opening = ({ when, to }: { readonly when: Runner['when']; readonly to: NonNullable<Runner['to']> }): Runner => ({
  when,
  to,
  run: (target, surface) => {
    const path = to(target, surface.recall)
    if (path !== null) surface.setFocus(path)
  },
})

/** Whether the view is a board of this node already. */
export const onBoardOf = ({ tree, focus, id }: { readonly tree: Tree; readonly focus: Path; readonly id: string }) =>
  tree.viewOf(focus) === `board:${id}`

/** A placement among siblings written with the order route, then the rows read again, as a drop is. */
export const place = async ({ context, write }: {
  readonly context: RunnerContext
  readonly write: { readonly path: string; readonly before: string | null; readonly after: readonly string[] }
}) => {
  try {
    await IndexApi.setOrder(write)
    await context.input.readRows()
    return null
  } catch (error) {
    await context.input.readRows()
    return reasonOf({ error, fallback: 'The order could not be written' })
  }
}

/** The row of a worktree target: a worktree on the index, or a worktree's part of a lane on an epic's or a project's board. */
export const rowOfTarget = ({ tree, target }: { readonly tree: Tree; readonly target: Target }): WorktreeSummary | null => {
  const node = nodeOf(target.id)
  if (node?.kind === 'worktree') return tree.rowAt(node.path)
  if (node?.kind === 'part') return tree.rowOfKey(node.key)
  return null
}

/** Why a worktree cannot act beyond its folder: Git did not answer for it, or it is not served. */
export const unserved = (row: WorktreeSummary | null): string | null => {
  if (row === null) return 'No such worktree'
  if (!row.resolved) return `Git did not answer for ${row.path}: ${row.conflict ?? 'it gave no reason'}`
  return row.conflict === null ? null : `${row.name} is not served: ${row.conflict}`
}

/** The board a worktree's writes go to, by the key it is served under. */
export const writeTo = ({ tree, key }: { readonly tree: Tree; readonly key: string }) => {
  const row = tree.rowOfKey(key)
  return row === null ? null : boardOf(row)
}
