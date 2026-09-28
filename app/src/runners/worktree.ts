import type { OpenResult } from '../../contract'
import { DaemonApi } from '../lib/api'
import { openOnce } from '../lib/open-once'
import { idOf } from '../levels'
import type { Runner, Target } from '../substrate/seam'
import { agentsRunner } from './agents'
import { memberRunners } from './members'
import type { RunnerContext } from './shared'
import { copy, onBoardOf, openBoard, reasonOf, rowOfTarget, unserved } from './shared'

/** What a worktree's commands do, wherever the worktree is on the focus path: its board, its tools, its links and its pages. */

/** One of the worktree's pages beside its board, opened as its record. */
const page = ({ tree }: RunnerContext, record: 'ledger' | 'context' | 'archive'): Runner => ({
  when: (target) => unserved(rowOfTarget({ tree, target })) ?? true,
  run: (target, surface) => {
    const row = rowOfTarget({ tree, target })
    if (row !== null) surface.setFocus([...tree.worktreePath(row), idOf({ kind: 'record', page: record, path: '' })])
  },
})

/**
 * A tool the daemon opens the worktree in, saying the tool's own line when it
 * refuses. A terminal opens in any folder the index lists, a path Git did not
 * answer for included, where someone may go to mend it; Zed only in a worktree
 * Git answered for.
 */
const opener = ({ tree }: RunnerContext, tool: {
  readonly open: (path: string) => Promise<OpenResult>
  readonly can: boolean
  readonly missing: string
  readonly done: string
  readonly unresolved: boolean
}): Runner => ({
  when: (target) => {
    if (!tool.can) return tool.missing
    const row = rowOfTarget({ tree, target })
    if (row === null) return 'No such worktree'
    return row.resolved || tool.unresolved ? true : unserved(row) ?? true
  },
  run: async (target, surface) => {
    const row = rowOfTarget({ tree, target })
    if (row === null) return
    try {
      const result = await tool.open(row.path)
      surface.flash(result.ok ? `${tool.done} ${row.name}` : result.line)
    } catch (error) {
      surface.flash(reasonOf({ error, fallback: 'The daemon could not be asked' }))
    }
  },
})

const openWorktree = ({ tree }: RunnerContext): Runner => ({
  when: (target, focus) => {
    const row = rowOfTarget({ tree, target })
    const refused = unserved(row)
    if (refused !== null) return refused
    return row !== null && onBoardOf({ tree, focus, id: idOf({ kind: 'worktree', path: row.path }) }) ? `This is the board of ${row.name}` : true
  },
  run: (target, surface) => {
    const row = rowOfTarget({ tree, target })
    if (row !== null) openBoard({ board: tree.worktreePath(row), surface })
  },
})

const pullRequest = ({ tree, input }: RunnerContext): Runner => ({
  when: (target) => {
    const row = rowOfTarget({ tree, target })
    if (row === null) return 'No such worktree'
    const report = input.data.signalsOf(row).pullRequest
    if (report?.pr) return true
    return report?.notice ?? `No pull request is known for ${row.name}’s branch`
  },
  run: (target, surface) => {
    const row = rowOfTarget({ tree, target })
    const pr = row === null ? null : input.data.signalsOf(row).pullRequest?.pr ?? null
    if (pr !== null && !openOnce(pr.url)) surface.flash('The browser refused to open a tab')
  },
})

const linearIssue = ({ tree, input }: RunnerContext): Runner => ({
  when: (target) => {
    const row = rowOfTarget({ tree, target })
    if (row === null) return 'No such worktree'
    const issues = input.data.signalsOf(row).issues
    if (issues === null) return `Linear is asked on ${row.name}’s own board`
    if (issues.issues.length > 0) return true
    return issues.notice ?? `Neither ${row.name}’s branch nor its pull request names a Linear issue`
  },
  run: (target, surface) => {
    const row = rowOfTarget({ tree, target })
    const issues = row === null ? [] : input.data.signalsOf(row).issues?.issues ?? []
    surface.choose({
      prompt: `The Linear issues ${row?.name ?? 'the worktree'} names`,
      choices: issues.map((issue) => ({
        key: issue.id,
        name: issue.id,
        on: `${issue.title} · ${issue.state}`,
        run: () => {
          if (!openOnce(issue.url)) surface.flash('The browser refused to open a tab')
        },
      })),
    })
  },
})

const rules = ({ tree, input }: RunnerContext): Runner => ({
  when: (target) => {
    const refused = unserved(rowOfTarget({ tree, target }))
    if (refused !== null) return refused
    return input.rules === false ? 'This session has no RULES.md' : true
  },
  run: (target, surface) => {
    const row = rowOfTarget({ tree, target })
    if (row !== null) surface.setFocus([...tree.worktreePath(row), idOf({ kind: 'record', page: 'file', path: 'RULES.md' })])
  },
})

/** Copies what the worktree has of its own: its folder, or its branch. */
const copier = ({ tree }: RunnerContext, what: 'path' | 'branch'): Runner => ({
  when: (target: Target) => (what === 'branch' && rowOfTarget({ tree, target })?.branch === null ? 'No branch is checked out here' : true),
  run: async (target, surface) => {
    const row = rowOfTarget({ tree, target })
    const text = what === 'path' ? row?.path : row?.branch
    if (text !== null && text !== undefined) await copy({ text, surface, what: `the ${what}` })
  },
})

export const worktreeRunners = (context: RunnerContext): Record<string, Runner> => ({
  'worktree.open': openWorktree(context),
  'worktree.terminal': opener(context, {
    open: DaemonApi.terminal,
    can: context.input.capabilities.terminal,
    missing: 'cmux is not on the daemon’s PATH',
    done: 'Brought forward a terminal in',
    unresolved: true,
  }),
  'worktree.editor': opener(context, {
    open: (path) => DaemonApi.zed({ path }),
    can: context.input.capabilities.zed,
    missing: 'zed is not on the daemon’s PATH',
    done: 'Brought forward Zed on',
    unresolved: false,
  }),
  'worktree.pr': pullRequest(context),
  'worktree.linear': linearIssue(context),
  'worktree.agents': agentsRunner(context),
  'worktree.ledger': page(context, 'ledger'),
  'worktree.context': page(context, 'context'),
  'worktree.archive': page(context, 'archive'),
  'worktree.rules': rules(context),
  'worktree.copyPath': copier(context, 'path'),
  'worktree.copyBranch': copier(context, 'branch'),
  ...memberRunners(context),
})
