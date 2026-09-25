import * as React from 'react'

import type { AgentsSummary, ClaudeSession, CodexThread } from '../../contract'
import { isDerivedName, nameMeaning, sessionName, threadNameMeaning } from '../lib/agent-names'
import type { Action } from '../lib/agents'
import {
  actionKey,
  actionsFor,
  actionsForThread,
  heldMeaning,
  heldWord,
  isLive,
  loadedMeaning,
  meaningOf,
  needsYou,
  sortSessions,
  sortThreads,
  wordOfThread,
} from '../lib/agents'
import { IndexApi } from '../lib/api'
import { openOnceOnClick } from '../lib/open-once'
import { absoluteTime, relativeTime } from '../lib/format'
import { cn } from '../lib/utils'
import { ActionIcon, Dot, Name } from './agent-marks'
import { copyLabel, useCopy } from './copyable'
import { useTip } from './tip'
import { Badge } from './ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'

/**
 * The agents in one worktree's row on the index: a pill per session, each one
 * a menu of what can be done with that session and nothing else. The row says
 * how many and which, the menu says the rest, so the pills cost one line
 * however busy the worktree is.
 *
 * Only live things are named here. A session whose process is gone belongs to
 * the board's strip, where it is scoped to the worktree a reader chose; the
 * index answers what is happening now, and where.
 */

/** One live session as the cell needs it: what it says, and what can be done. */
type Pill = {
  key: string
  /** The session is waiting on a person: the one thing here with a colour. */
  attention: boolean
  tone: 'on' | 'attention'
  /** The word with how long it has held, `busy for 16 min`, as the board's row writes it. */
  word: string
  name: string
  /** Whether Claude Code made the name from the folder, which is drawn very dim here as on the board. */
  derived: boolean
  /** Where the name came from, in a sentence. */
  nameMeaning: string
  /** `Claude Code` or `Codex Desktop`: which harness this session belongs to. */
  harness: string
  meaning: string
  /**
   * When this became what it is: `idle for 3 h, since 14 Sep 2026, 10:56` for
   * a session whose status carries a moment, else `started …` or `updated …`
   * with the exact time behind it.
   */
  age: string
  /** The exact moment behind the age, and for a status time the registry stamp it is read from. */
  ageMeaning: string
  waitingFor: string | null
  actions: readonly Action[]
}

/** What a pill says in one sentence, for the hover before the click. */
const summarize = (pill: Pill) => `${pill.name}\n${pill.nameMeaning}\n${pill.harness} · ${pill.meaning} · ${pill.age}`

const claudePill = (session: ClaudeSession, now: number): Pill => {
  const attention = needsYou(session)
  // How long it has held its status belongs to the word, not beside it: the
  // pill would otherwise say `idle` and `idle for 3 h` in the same breath.
  const changed = session.statusChangedAt
  return {
    key: session.sessionId ?? session.backgroundId ?? `${session.kind}:${session.pid}`,
    attention,
    tone: attention ? 'attention' : 'on',
    word: heldWord({ session, now }),
    name: sessionName(session),
    derived: isDerivedName(session),
    nameMeaning: nameMeaning(session),
    harness: 'Claude Code',
    meaning: meaningOf(session),
    age: changed === null
      ? `started ${relativeTime(session.startedAt, now)}`
      : `${heldWord({ session, now })}, since ${absoluteTime(changed)}`,
    ageMeaning: heldMeaning(session) ?? `It started at ${absoluteTime(session.startedAt)}.`,
    waitingFor: attention ? session.waitingFor : null,
    actions: actionsFor(session),
  }
}

const codexPill = (thread: CodexThread, now: number): Pill => ({
  key: thread.id,
  attention: false,
  tone: 'on',
  word: wordOfThread(thread),
  name: thread.name,
  derived: false,
  nameMeaning: threadNameMeaning,
  harness: `Codex ${thread.origin}`,
  meaning: loadedMeaning(thread.loaded),
  age: `updated ${relativeTime(thread.updatedAt, now)}`,
  ageMeaning: `It was last updated at ${absoluteTime(thread.updatedAt)}.`,
  waitingFor: null,
  actions: actionsForThread(thread),
})

/** A value someone is going to paste somewhere else; the menu stays open for it. */
function CopyItem({ action }: { action: Extract<Action, { kind: 'copy' }> }) {
  const [state, copy] = useCopy()
  const tip = useTip()
  return (
    <DropdownMenuItem
      closeOnClick={false}
      title={tip(action.meaning)}
      aria-label={`${action.label}: ${action.value}`}
      onClick={() => void copy(action.value)}
    >
      <ActionIcon action={action} copy={state} />
      {copyLabel({ label: action.label, state })}
    </DropdownMenuItem>
  )
}

/**
 * Asking the daemon to bring a terminal forward. It answers whether the window
 * manager did it, so a refusal is shown here rather than thrown away, and the
 * menu closes only once there is nothing left to say.
 */
function FocusItem({ action, onSettled }: {
  action: Extract<Action, { kind: 'focus' }>
  onSettled: (reason: string | null) => void
}) {
  const [pending, setPending] = React.useState(false)
  const tip = useTip()
  return (
    <DropdownMenuItem
      closeOnClick={false}
      title={tip(action.meaning)}
      disabled={pending}
      onClick={() => {
        void (async () => {
          setPending(true)
          try {
            const result = await IndexApi.focus(action.pid)
            onSettled(result.ok ? null : result.reason)
          } catch (error) {
            onSettled(error instanceof Error ? error.message : 'The focus request failed')
          } finally {
            setPending(false)
          }
        })()
      }}
    >
      <ActionIcon action={action} /> {action.label}
    </DropdownMenuItem>
  )
}

/** One session: the pill that names it, and the menu of what it can be asked. */
function SessionPill({ pill }: { pill: Pill }) {
  const [open, setOpen] = React.useState(false)
  const [failure, setFailure] = React.useState<string | null>(null)
  const tip = useTip()
  const settle = (reason: string | null) => {
    setFailure(reason)
    if (reason === null) setOpen(false)
  }

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setFailure(null)
      }}
    >
      <DropdownMenuTrigger
        nativeButton={false}
        render={<Badge variant="outline" />}
        title={tip(summarize(pill))}
        className={cn('max-w-full cursor-pointer', pill.attention && 'font-medium text-attention')}
      >
        <Dot tone={pill.tone} />
        <span className={pill.attention ? undefined : 'text-muted-foreground'}>{pill.word}</span>
        <Name name={pill.name} derived={pill.derived} className="max-w-[24ch] truncate" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-auto min-w-64">
        {/* The label names the group it sits in, so the session it describes and
            the actions that act on it are one group and not two. */}
        <DropdownMenuGroup>
          <DropdownMenuLabel className="font-normal">
            <Name name={pill.name} derived={pill.derived} className="block wrap-anywhere text-foreground" />
            <span className="block wrap-anywhere">{pill.harness} · {pill.meaning}</span>
            <span className="block" title={tip(pill.ageMeaning)}>{pill.age}</span>
            {pill.waitingFor === null
              ? null
              : <span className="block text-attention wrap-anywhere">{pill.waitingFor}</span>}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {pill.actions.map((action) =>
            action.kind === 'copy'
              ? <CopyItem key={actionKey(action)} action={action} />
              : action.kind === 'focus'
              ? <FocusItem key={actionKey(action)} action={action} onSettled={settle} />
              : (
                <DropdownMenuItem
                  key={actionKey(action)}
                  title={tip(action.meaning)}
                  render={
                    <a
                      aria-label={`${action.label}: ${pill.name}`}
                      href={action.href}
                      onClick={openOnceOnClick(action.href)}
                    />
                  }
                >
                  <ActionIcon action={action} /> {action.label}
                </DropdownMenuItem>
              )
          )}
        </DropdownMenuGroup>
        {failure === null ? null : (
          <>
            <DropdownMenuSeparator />
            <p className="px-1.5 py-1 text-xs text-destructive wrap-anywhere">{failure}</p>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Every live agent in this worktree, what needs a person first, and nothing
 * when none is. A session whose process is gone and a thread no app is known
 * to hold are not named here: they belong to the worktree's own board, and a
 * row that listed them would say something is happening where nothing is
 * known to be.
 */
export function AgentPills({ agents, now }: { agents: AgentsSummary; now: number }) {
  const pills: Pill[] = []
  for (const session of sortSessions(agents.claude)) {
    if (isLive(session)) pills.push(claudePill(session, now))
  }
  // Only a thread known to be held is named here; one whose locks could not be
  // read is not known to be happening, and belongs to the board's strip.
  for (const thread of sortThreads(agents.codex)) {
    if (thread.loaded === true) pills.push(codexPill(thread, now))
  }
  if (pills.length === 0) return null

  return (
    <span className="flex flex-wrap gap-1">
      {pills.map((pill) => <SessionPill key={pill.key} pill={pill} />)}
    </span>
  )
}
