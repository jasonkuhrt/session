import * as React from 'react'

import type { AgentsSummary, ClaudeSession, CodexThread, ContextFill, FocusResult } from '../../contract'
import { isDerivedName, nameMeaning, sessionName, threadNameMeaning } from '../lib/agent-names'
import {
  actionsFor,
  actionsForThread,
  heldMeaning,
  heldWord,
  isLive,
  isParkedThread,
  loadedMeaning,
  meaningOf,
  needsYou,
  sortSessions,
  sortThreads,
  tierMeaning,
  wordOfThread,
} from '../lib/agents'
import { absoluteTime, relativeTime, tokenCount } from '../lib/format'
import { cn } from '../lib/utils'
import { Actions } from './agent-actions'
import { Dot, Name } from './agent-marks'
import { Explained, useTip } from './tip'
import { Badge } from './ui/badge'
import { TooltipProvider } from './ui/tooltip'

/**
 * The agents at work in one worktree, as a row apiece under its board. Every
 * row is one session and reads in one line: what it is called, its harness,
 * how it is doing and for how long, what is in its context when that can be
 * read, and the buttons that act on that session and no other.
 *
 * The rows come in two tiers. A live row has a process behind it and can need
 * you now; a resumable row is a handle and the state something last knew it
 * in, and the only thing to do with one is pick it back up. Everything here is
 * read from what Claude Code and Codex answered when the daemon last asked
 * them, and a word this build does not know is rendered as it arrived rather
 * than folded into one it does.
 */

/**
 * The columns every row lines up on: the name first, then the harness, the
 * word with its time, the context and the actions, each as wide as its widest
 * cell, and what is left of the width after them, so the actions sit beside
 * the session they act on. Each row is a subgrid of the list, so a column is
 * as wide in every row, and a line under a row starts under its name.
 */
const stripGrid = 'grid grid-cols-[repeat(5,auto)_minmax(0,1fr)] gap-x-3'
const rowGrid = 'col-span-full grid grid-cols-subgrid items-center gap-y-1 border-t py-2 first:border-t-0'
const cell = 'flex min-w-0 items-center gap-2'
const actionsCell = 'flex items-center gap-1'
const underRow = 'col-span-full text-xs wrap-anywhere'
const ageText = 'text-xs text-muted-foreground'
/** A name is capped so one long preview cannot push the rest of every row away. */
const nameWidth = 'max-w-[32ch]'

/** A sentence per block, for a tip that says more than one thing. */
function Blocks({ blocks }: { blocks: readonly string[] }) {
  return (
    <span className="block space-y-1">
      {blocks.map((block) => <span key={block} className="block wrap-anywhere">{block}</span>)}
    </span>
  )
}

/**
 * When a session started. It is the time beside a word that carries none of
 * its own: a resumable session, which has no status to be in, and a live one
 * the registry has no moment for. For a resumable row it is the one fact that
 * says how stale its state is, so it is never dropped.
 */
function StartedAge({ session, now }: { session: ClaudeSession; now: number }) {
  const tip = useTip()
  return (
    <span className={ageText} title={tip(`It started at ${absoluteTime(session.startedAt)}.`)}>
      started {relativeTime(session.startedAt, now)}
    </span>
  )
}

/**
 * How many tokens are in a live session's context, as its last reply left
 * them: a count at a glance, with the exact count, the line it was read from
 * and the listing that read it behind it. It is as old as that listing,
 * since nothing watches a transcript. There is no share of a window, because
 * neither the listing nor the line says how large the window is.
 */
function ContextCount({ context, listedAt }: { context: ContextFill; listedAt: string | null }) {
  const written = context.lineAt === null ? '' : `, written ${absoluteTime(context.lineAt)}`
  const listing = listedAt === null ? 'the last listing' : `the listing at ${absoluteTime(listedAt)}`
  return (
    <Explained
      meaning={
        <Blocks
          blocks={[
            `${context.tokens.toLocaleString()} tokens: the input, cache-creation and cache-read tokens of its last reply, the count Claude Code's status line works from.`,
            `It is the count as of ${listing}: nothing watches a transcript, so a status change is what lists the agents again, and a turn that stays busy keeps this count until then.`,
            `Read from the usage on the last assistant line of its transcript${written}:`,
            context.transcript,
          ]}
        />
      }
    >
      <span className="text-xs text-muted-foreground">{tokenCount(context.tokens)} in context</span>
    </Explained>
  )
}

/** One Claude Code session: what it is called, how it is doing, and what acts on it. */
function ClaudeRow({ session, now, listedAt, onFocus }: {
  session: ClaudeSession
  now: number
  /** When the daemon listed the agents this row was read from. */
  listedAt: string | null
  onFocus: (pid: number) => Promise<FocusResult>
}) {
  const [failure, setFailure] = React.useState<string | null>(null)
  const tip = useTip()
  const live = isLive(session)
  const attention = needsYou(session)
  const name = sessionName(session)
  const held = heldMeaning(session)

  return (
    <li className={cn(rowGrid, live ? undefined : 'opacity-60')}>
      <span className={cell}>
        <Explained className="min-w-0" meaning={<Blocks blocks={[name, nameMeaning(session)]} />}>
          <Name name={name} derived={isDerivedName(session)} className={cn(nameWidth, 'truncate text-sm font-medium')} />
        </Explained>
        {session.kind === 'interactive' ? null : (
          <Badge variant="outline" title={tip('A background session: it runs without a terminal of its own.')}>
            {session.kind}
          </Badge>
        )}
      </span>
      <span>
        <Badge variant="outline" title={tip('A session of the Claude Code CLI.')}>Claude Code</Badge>
      </span>
      <span className={cell}>
        <Explained meaning={<Blocks blocks={held === null ? [meaningOf(session)] : [meaningOf(session), held]} />}>
          <Dot tone={attention ? 'attention' : live ? 'on' : 'off'} />
          <span className={cn('text-xs', attention ? 'font-medium text-attention' : 'text-muted-foreground')}>
            {heldWord({ session, now })}
          </span>
        </Explained>
        {held === null ? <StartedAge session={session} now={now} /> : null}
      </span>
      <span>{session.context === null ? null : <ContextCount context={session.context} listedAt={listedAt} />}</span>
      <span className={actionsCell}>
        <Actions actions={actionsFor(session)} name={name} onFocus={onFocus} onFailure={setFailure} />
      </span>
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
      <span className={cell}>
        <Explained className="min-w-0" meaning={<Blocks blocks={[thread.name, threadNameMeaning]} />}>
          <Name name={thread.name} derived={false} className={cn(nameWidth, 'truncate text-sm')} />
        </Explained>
      </span>
      <span>
        <Badge variant="outline" title={tip(`A Codex thread, started from ${thread.origin}.`)}>
          Codex {thread.origin}
        </Badge>
      </span>
      <span className={cell}>
        <Explained meaning={loadedMeaning(thread.loaded)}>
          <Dot tone={thread.loaded === null ? 'unknown' : thread.loaded ? 'on' : 'off'} />
          <span className="text-xs text-muted-foreground">{wordOfThread(thread)}</span>
        </Explained>
        <span className={ageText} title={tip(`It was last updated at ${absoluteTime(thread.updatedAt)}.`)}>
          updated {relativeTime(thread.updatedAt, now)}
        </span>
      </span>
      {/* Codex records no context for a thread, so its context column is empty. */}
      <span />
      <span className={actionsCell}>
        <Actions actions={actionsForThread(thread)} name={thread.name} onFocus={onFocus} onFailure={setFailure} />
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
 * what a row's buttons act on is the session named at its start. A source that
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

  const listedAt = agents?.fetchedAt ?? null
  const row = (session: ClaudeSession) => (
    <ClaudeRow
      key={session.sessionId ?? session.backgroundId ?? `${session.kind}:${session.pid}`}
      session={session}
      now={now}
      listedAt={listedAt}
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
