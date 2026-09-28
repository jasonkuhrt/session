import type { AgentsSummary } from '../../contract'
import { isDerivedName, sessionName } from '../lib/agent-names'
import type { Action } from '../lib/agents'
import { actionsFor, actionsForThread, heldWord, isLive, sortSessions, sortThreads, wordOfThread } from '../lib/agents'
import { tokenCount } from '../lib/format'
import { openOnce } from '../lib/open-once'
import type { Choice, Runner, SurfaceApi } from '../substrate/seam'
import type { RunnerContext } from './shared'
import { copy, rowOfTarget } from './shared'

/**
 * The agents in a worktree: choose one, then what to do with it, focus its
 * terminal, open it in Codex, or copy its resume command or its id, the one
 * list of actions the listing supports for it.
 */

/** One agent's actions as choices, each saying what happened in the detail line. */
const actionChoices = (context: RunnerContext, surface: SurfaceApi, agent: { readonly name: string; readonly actions: readonly Action[] }): Choice[] =>
  agent.actions.map((action) => ({
    key: `${action.kind}:${action.label}`,
    name: action.label,
    on: action.meaning,
    run: async () => {
      if (action.kind === 'copy') await copy({ text: action.value, surface, what: action.label.replace(/^Copy /u, '') })
      else if (action.kind === 'link') openOnce(action.href)
      else {
        const result = await context.input.focusAgent(action.pid)
        surface.flash(result.ok ? `Brought forward ${agent.name}` : result.reason)
      }
    },
  }))

/** The agents to choose from, live ones first, each then asking what to do with it. */
const agentChoices = (context: RunnerContext, surface: SurfaceApi, agents: AgentsSummary): Choice[] => {
  const now = context.input.data.now
  const choose = (name: string, actions: readonly Action[]) =>
    surface.choose({ prompt: `${name}: what to do`, choices: actionChoices(context, surface, { name, actions }) })
  return [
    ...sortSessions(agents.claude).map((session) => ({
      key: session.sessionId ?? session.backgroundId ?? `${session.kind}:${session.pid}`,
      name: sessionName(session),
      on: [
        'Claude Code',
        heldWord({ session, now }),
        ...(isLive(session) ? [] : ['resumable']),
        ...(isDerivedName(session) ? ['a name Claude Code made from the folder'] : []),
        ...(session.context === null ? [] : [`${tokenCount(session.context.tokens)} in context`]),
      ].join(', '),
      run: () => choose(sessionName(session), actionsFor(session)),
    })),
    ...sortThreads(agents.codex).map((thread) => ({
      key: thread.id,
      name: thread.name,
      on: `Codex ${thread.origin}, ${wordOfThread(thread)}`,
      run: () => choose(thread.name, actionsForThread(thread)),
    })),
  ]
}

export const agentsRunner = (context: RunnerContext): Runner => ({
  when: (target) => {
    const row = rowOfTarget({ tree: context.tree, target })
    if (row === null) return 'No such worktree'
    const agents = context.input.data.signalsOf(row).agents
    return agents === null || agents.claude.length + agents.codex.length === 0
      ? [`No agent sessions in ${row.name}`, ...(agents?.notices ?? [])].join('. ')
      : true
  },
  run: (target, surface) => {
    const row = rowOfTarget({ tree: context.tree, target })
    const agents = row === null ? null : context.input.data.signalsOf(row).agents
    if (row !== null && agents !== null) surface.choose({ prompt: `The agents in ${row.name}`, choices: agentChoices(context, surface, agents) })
  },
})
