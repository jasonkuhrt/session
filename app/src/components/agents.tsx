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
import { Dot, Explained } from './agent-marks'
import { Badge } from './ui/badge'
import { TooltipProvider } from './ui/tooltip'

/**
 * The agents at work in one worktree, as a row apiece under its board. Every
 * row is one session: its harness, how it is doing, what it is called, and the
 * buttons that act on that session and no other.
 *
 * The rows come in two tiers. A live row has a process behind it and can need
 * you now; a resumable row is a handle and the state something last knew it
 * in, and the only thing to do with one is pick it back up. Everything here is
 * read from what Claude Code and Codex answered when the daemon last asked
 * them, and a word this build does not know is rendered as it arrived rather
 * than folded into one it does.
 */

/** The columns every row lines up on, so an action belongs to one session. */
const harnessColumn = 'w-32 shrink-0'
const statusColumn = 'w-32 shrink-0'
const ageText = 'shrink-0 text-xs text-muted-foreground'

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
  return (
    <span className={ageText} title={`It started at ${absoluteTime(session.startedAt)}.`}>
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
  const live = isLive(session)
  const attention = needsYou(session)
  const name = sessionName(session)
  const word = wordOf(session)
  const held = heldFor(session, now)

  return (
    <li
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-1 border-t py-2 first:border-t-0',
        live ? undefined : 'opacity-60',
      )}
    >
      <span className={harnessColumn}>
        <Badge variant="outline" title="A session of the Claude Code CLI.">Claude Code</Badge>
      </span>
      <Explained
        meaning={held === null
          ? meaningOf(session)
          : `${meaningOf(session)} It has been ${word} for ${held.duration} (since ${
            absoluteTime(held.at)
          }).`}
        className={statusColumn}
      >
        <Dot tone={attention ? 'attention' : live ? 'on' : 'off'} />
        <span className={cn('text-xs', attention ? 'font-medium text-amber-400' : 'text-muted-foreground')}>
          {held === null ? word : `${word} · ${held.duration}`}
        </span>
      </Explained>
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate text-sm font-medium" title={name}>{name}</span>
        {session.kind === 'interactive' ? null : (
          <Badge variant="outline" title="A background session: it runs without a terminal of its own.">
            {session.kind}
          </Badge>
        )}
      </span>
      {held === null ? <StartedAge session={session} now={now} /> : null}
      <span className="ml-auto flex shrink-0 items-center gap-2">
        <Actions actions={actionsFor(session)} name={name} onFocus={onFocus} onFailure={setFailure} />
      </span>
      {session.waitingFor === null || !attention
        ? null
        : <p className="w-full text-xs text-amber-400 wrap-anywhere">{session.waitingFor}</p>}
      {failure === null ? null : <p className="w-full text-xs text-destructive wrap-anywhere">{failure}</p>}
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
  return (
    <li
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-1 border-t py-2 first:border-t-0',
        isParkedThread(thread) ? 'opacity-60' : undefined,
      )}
    >
      <span className={harnessColumn}>
        <Badge variant="outline" title={`A Codex thread, started from ${thread.origin}.`}>
          Codex {thread.origin}
        </Badge>
      </span>
      <Explained meaning={loadedMeaning(thread.loaded)} className={statusColumn}>
        <Dot tone={thread.loaded === null ? 'unknown' : thread.loaded ? 'on' : 'off'} />
        <span className="text-xs text-muted-foreground">{wordOfThread(thread)}</span>
      </Explained>
      <span className="flex min-w-0 flex-1 items-center gap-2">
        {/* An unnamed thread is named by its preview, which is a whole first
            message; capped so one of them cannot own the row. */}
        <span className="max-w-[60ch] truncate text-sm" title={thread.name}>{thread.name}</span>
      </span>
      <span className={ageText} title={`It was last updated at ${absoluteTime(thread.updatedAt)}.`}>
        updated {relativeTime(thread.updatedAt, now)}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-2">
        <Actions actions={actionsForThread(thread)} name={thread.name} onFocus={onFocus} onFailure={setFailure} />
      </span>
      {failure === null ? null : <p className="w-full text-xs text-destructive wrap-anywhere">{failure}</p>}
    </li>
  )
}

/** A tier's name, with what belongs in it one hover away. */
function TierHeading({ tier }: { tier: 'live' | 'resumable' }) {
  return (
    <li className="border-t pt-2 first:border-t-0">
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
            <ul>
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
