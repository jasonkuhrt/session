import * as React from 'react'

import type { AgentsSummary, ClaudeSession, CodexThread, FocusResult } from '../../contract'
import {
  actionsFor,
  actionsForThread,
  isLive,
  isParkedThread,
  loadedMeaning,
  meaningOf,
  needsYou,
  sessionName,
  sortSessions,
  sortThreads,
  tierMeaning,
  wordOf,
  wordOfThread,
} from '../lib/agents'
import { absoluteTime, relativeTime, since } from '../lib/format'
import { cn } from '../lib/utils'
import { Actions } from './agent-actions'
import { Dot } from './agent-marks'
import { Explained, useTip } from './tip'
import { Badge } from './ui/badge'
import { TooltipProvider } from './ui/tooltip'

/**
 * The agents at work in one worktree, as a row apiece under its board. Every
 * row is one session: the buttons that act on that session and no other, its
 * harness, how it is doing, and what it is called.
 *
 * The rows come in two tiers. A live row has a process behind it and can need
 * you now; a resumable row is a handle and the state something last knew it
 * in, and the only thing to do with one is pick it back up. Everything here is
 * read from what Claude Code and Codex answered when the daemon last asked
 * them, and a word this build does not know is rendered as it arrived rather
 * than folded into one it does.
 */

/**
 * The columns every row lines up on, so an action belongs to one session: the
 * actions first, as wide as the most any row has, then the harness, the word,
 * the name, and the age at the far end. Each row is a subgrid of the list, so
 * a column is as wide in every row, and a line under a row starts at its
 * harness, under the session it is about.
 */
const stripGrid = 'grid grid-cols-[auto_8rem_8rem_minmax(0,1fr)_auto] gap-x-3'
const rowGrid = 'col-span-full grid grid-cols-subgrid items-center gap-y-1 border-t py-2 first:border-t-0'
const actionsCell = 'flex items-center gap-1'
const underRow = 'col-[2/-1] text-xs wrap-anywhere'
const ageText = 'text-xs text-muted-foreground'

/**
 * How long a live session has held the status it is in, when the registry says
 * when that status changed. It belongs to the status word rather than beside
 * it: `idle` and `idle for 3 h` in one row would be the same fact twice.
 */
const heldFor = (session: ClaudeSession, now: number) => {
  const changed = session.statusChangedAt
  return isLive(session) && changed !== null ? { at: changed, duration: since(changed, now) } : null
}

/**
 * When a session started. It is the age of a row whose status carries no
 * duration of its own: a resumable session, which has no status to be in, and
 * a live one the registry has no moment for. For a resumable row it is the one
 * fact that says how stale its state is, so it is never dropped.
 */
function StartedAge({ session, now }: { session: ClaudeSession; now: number }) {
  const tip = useTip()
  return (
    <span className={ageText} title={tip(`It started at ${absoluteTime(session.startedAt)}.`)}>
      started {relativeTime(session.startedAt, now)}
    </span>
  )
}

/** One Claude Code session: what it is, how it is doing, and what acts on it. */
function ClaudeRow({ session, now, onFocus }: {
  session: ClaudeSession
  now: number
  onFocus: (pid: number) => Promise<FocusResult>
}) {
  const [failure, setFailure] = React.useState<string | null>(null)
  const tip = useTip()
  const live = isLive(session)
  const attention = needsYou(session)
  const name = sessionName(session)
  const word = wordOf(session)
  const held = heldFor(session, now)

  return (
    <li className={cn(rowGrid, live ? undefined : 'opacity-60')}>
      <span className={actionsCell}>
        <Actions actions={actionsFor(session)} name={name} onFocus={onFocus} onFailure={setFailure} />
      </span>
      <span>
        <Badge variant="outline" title={tip('A session of the Claude Code CLI.')}>Claude Code</Badge>
      </span>
      <Explained
        meaning={held === null
          ? meaningOf(session)
          : `${meaningOf(session)} It has been ${word} for ${held.duration} (since ${
            absoluteTime(held.at)
          }).`}
      >
        <Dot tone={attention ? 'attention' : live ? 'on' : 'off'} />
        <span className={cn('text-xs', attention ? 'font-medium text-attention' : 'text-muted-foreground')}>
          {held === null ? word : `${word} · ${held.duration}`}
        </span>
      </Explained>
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate text-sm font-medium" title={tip(name)}>{name}</span>
        {session.kind === 'interactive' ? null : (
          <Badge variant="outline" title={tip('A background session: it runs without a terminal of its own.')}>
            {session.kind}
          </Badge>
        )}
      </span>
      {held === null ? <StartedAge session={session} now={now} /> : null}
      {session.waitingFor === null || !attention
        ? null
        : <p className={cn(underRow, 'text-attention')}>{session.waitingFor}</p>}
      {failure === null ? null : <p className={cn(underRow, 'text-destructive')}>{failure}</p>}
    </li>
  )
}

/** One Codex thread, in the same columns, so the two harnesses read as one list. */
function CodexRow({ thread, now, onFocus }: {
  thread: CodexThread
  now: number
  onFocus: (pid: number) => Promise<FocusResult>
}) {
  const [failure, setFailure] = React.useState<string | null>(null)
  const tip = useTip()
  return (
    <li className={cn(rowGrid, isParkedThread(thread) ? 'opacity-60' : undefined)}>
      <span className={actionsCell}>
        <Actions actions={actionsForThread(thread)} name={thread.name} onFocus={onFocus} onFailure={setFailure} />
      </span>
      <span>
        <Badge variant="outline" title={tip(`A Codex thread, started from ${thread.origin}.`)}>
          Codex {thread.origin}
        </Badge>
      </span>
      <Explained meaning={loadedMeaning(thread.loaded)}>
        <Dot tone={thread.loaded === null ? 'unknown' : thread.loaded ? 'on' : 'off'} />
        <span className="text-xs text-muted-foreground">{wordOfThread(thread)}</span>
      </Explained>
      <span className="flex min-w-0 items-center gap-2">
        {/* An unnamed thread is named by its preview, which is a whole first
            message; capped so one of them cannot own the row. */}
        <span className="max-w-[60ch] truncate text-sm" title={tip(thread.name)}>{thread.name}</span>
      </span>
      <span className={ageText} title={tip(`It was last updated at ${absoluteTime(thread.updatedAt)}.`)}>
        updated {relativeTime(thread.updatedAt, now)}
      </span>
      {failure === null ? null : <p className={cn(underRow, 'text-destructive')}>{failure}</p>}
    </li>
  )
}

/** A tier's name, with what belongs in it one hover away. */
function TierHeading({ tier }: { tier: 'live' | 'resumable' }) {
  return (
    <li className="col-span-full border-t pt-2 first:border-t-0">
      <Explained meaning={tier === 'live' ? tierMeaning.live : tierMeaning.resumable}>
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          {tier === 'live' ? 'Live' : 'Resumable'}
        </span>
      </Explained>
    </li>
  )
}

/**
 * The strip under a board's header: one row per session, live rows first, so
 * what a row's buttons act on is the session named beside them. A source that
 * could not be reached says so on its own line, because an empty strip means
 * "nothing is working here" and must never stand in for "nobody answered".
 */
export function AgentsStrip({ agents, error, now, onFocus }: {
  agents: AgentsSummary | null
  error: string | null
  now: number
  onFocus: (pid: number) => Promise<FocusResult>
}) {
  if (agents === null && error === null) return null
  const notices = [...(agents?.notices ?? []), ...(error === null ? [] : [error])]
  const sessions = agents === null ? [] : sortSessions(agents.claude)
  const threads = agents === null ? [] : sortThreads(agents.codex)
  // A thread whose lock could not be read keeps the live tier: it may well be
  // held, and it carries no resume command for the other tier to promise.
  const liveSessions = sessions.filter((session) => isLive(session))
  const liveThreads = threads.filter((thread) => !isParkedThread(thread))
  const parked = sessions.filter((session) => !isLive(session))
  const parkedThreads = threads.filter((thread) => isParkedThread(thread))
  // The tiers are named as soon as there is something in the second one; with
  // only live rows the words and ages in them already say what they are.
  const tiered = parked.length + parkedThreads.length > 0

  const row = (session: ClaudeSession) => (
    <ClaudeRow
      key={session.sessionId ?? session.backgroundId ?? `${session.kind}:${session.pid}`}
      session={session}
      now={now}
      onFocus={onFocus}
    />
  )
  const threadRow = (thread: CodexThread) => (
    <CodexRow key={thread.id} thread={thread} now={now} onFocus={onFocus} />
  )

  return (
    <TooltipProvider>
      <section aria-label="Agents" className="space-y-2 border-b px-6 py-2">
        {sessions.length === 0 && threads.length === 0
          ? <p className="py-1 text-sm text-muted-foreground">No agent sessions here</p>
          : (
            <ul className={stripGrid}>
              {tiered && liveSessions.length + liveThreads.length > 0
                ? <TierHeading tier="live" />
                : null}
              {liveSessions.map((session) => row(session))}
              {liveThreads.map((thread) => threadRow(thread))}
              {tiered ? <TierHeading tier="resumable" /> : null}
              {parked.map((session) => row(session))}
              {parkedThreads.map((thread) => threadRow(thread))}
            </ul>
          )}
        {notices.length === 0
          ? null
          : <p className="text-xs text-muted-foreground">{notices.join(' · ')}</p>}
      </section>
    </TooltipProvider>
  )
}
