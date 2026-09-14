import { Check, Copy, ExternalLink, Globe, SquareTerminal } from 'lucide-react'
import * as React from 'react'

import type { AgentsSummary, ClaudeSession, CodexThread, FocusResult } from '../../contract'
import { missingStatus, waitingStatus } from '../lib/agents'
import { absoluteTime, relativeTime } from '../lib/format'
import { cn } from '../lib/utils'
import { useCopy } from './copyable'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip'

/**
 * The agents at work in one worktree, as a row apiece under its board. Every
 * row is one session: its harness, how it is doing, what it is called, and the
 * buttons that act on that session and no other. Everything here is read from
 * what Claude Code and Codex answered when the daemon last asked them, and it
 * says only what those answers carry. A status word this build does not know
 * is rendered as it arrived rather than folded into one it does.
 */

/** The one copy button both kinds of row use: a command, and what happened to it. */
function CopyButton({ command, label }: { command: string; label: string }) {
  const [state, copy] = useCopy()
  return (
    <Button
      variant="outline"
      size="xs"
      title={command}
      aria-label={`${label}: ${command}`}
      onClick={() => void copy(command)}
    >
      {state === 'copied' ? <Check /> : <Copy />}
      {state === 'idle' ? label : state === 'copied' ? 'Copied' : 'Copy failed'}
    </Button>
  )
}

/** A dot that carries one fact; the words for it are in the row's tooltip. */
function Dot({ tone }: { tone: 'on' | 'attention' | 'off' | 'unknown' }) {
  // Attention is the one tone with a hue: it marks a session blocked on a person.
  const fill = tone === 'attention'
    ? 'bg-amber-400'
    : tone === 'on'
    ? 'bg-primary'
    : tone === 'unknown'
    ? 'border border-muted-foreground/50'
    : 'bg-muted-foreground/40'
  return <span aria-hidden className={cn('size-2 shrink-0 rounded-full', fill)} />
}

/** What to call a session: its name, else whatever handle identifies it. */
const sessionName = (session: ClaudeSession) =>
  session.name ?? session.backgroundId ?? (session.pid === null ? 'Session' : `pid ${session.pid}`)

/**
 * What Claude Code means by the word in the status column. A word this build
 * has never heard of is still shown, and says only where it came from.
 */
const statusMeaning = (session: ClaudeSession) => {
  switch (session.status) {
    case 'busy': {
      return 'Working on a turn'
    }
    case 'idle': {
      return 'Waiting for the next prompt'
    }
    case waitingStatus: {
      return `Needs you: ${session.waitingFor ?? 'no reason given'}`
    }
    case 'shell': {
      return 'Running a shell command'
    }
    case null: {
      return 'The listing reported no status'
    }
    default: {
      return 'As reported by Claude Code'
    }
  }
}

/** What the Codex dot means. It is about an app holding the thread, never a turn. */
const loadedMeaning = (loaded: boolean | null) =>
  loaded === null ? 'Could not be read' : loaded ? 'Open in an app' : 'Not open in any app'

/** A word with what it means behind it, reachable by pointer and by keyboard. */
function Explained({ children, meaning, className }: {
  children: React.ReactNode
  meaning: string
  className?: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        className={cn('flex cursor-default items-center gap-1.5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 rounded-sm', className)}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{meaning}</TooltipContent>
    </Tooltip>
  )
}

/** The columns every row lines up on, so an action belongs to one session. */
const harnessColumn = 'w-32 shrink-0'
const statusColumn = 'w-24 shrink-0'

/**
 * Where the session can be reached, and only where it actually can be: a tab
 * to focus, the Remote Control page it was once bridged to, or the command
 * that picks it up when there is no tab to go to.
 */
function ClaudeActions({ session, onFocus, onFailure }: {
  session: ClaudeSession
  onFocus: (pid: number) => Promise<FocusResult>
  onFailure: (reason: string | null) => void
}) {
  const [pending, setPending] = React.useState(false)
  const pid = session.pid

  const focus = async (target: number) => {
    setPending(true)
    try {
      const result = await onFocus(target)
      onFailure(result.ok ? null : result.reason)
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      {session.terminal !== null && pid !== null
        ? (
          <Button variant="outline" size="xs" disabled={pending} onClick={() => void focus(pid)}>
            <SquareTerminal /> Focus terminal
          </Button>
        )
        : null}
      {session.web === null ? null : (
        <Button
          variant="outline"
          size="xs"
          render={
            <a
              aria-label={`Open ${sessionName(session)} on claude.ai`}
              href={session.web}
              rel="noreferrer"
              target="_blank"
              title="Remote Control link recorded for this session; it may be disconnected"
            />
          }
        >
          <Globe /> Open on claude.ai
        </Button>
      )}
      {session.terminal === null && session.resume !== null
        ? <CopyButton command={session.resume} label="Copy resume" />
        : null}
    </>
  )
}

/** One Claude Code session: what it is, how it is doing, and what acts on it. */
function ClaudeRow({ session, now, onFocus }: {
  session: ClaudeSession
  now: number
  onFocus: (pid: number) => Promise<FocusResult>
}) {
  const [failure, setFailure] = React.useState<string | null>(null)
  const waiting = session.status === waitingStatus
  // A derived name is a label Claude Code made up, not a handle `--resume`
  // knows, so it is named as one rather than merely dimmed.
  const derived = session.nameSource === 'derived' || session.name === null
  const name = sessionName(session)

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t py-2 first:border-t-0">
      <span className={harnessColumn}>
        <Badge variant="outline">Claude Code</Badge>
      </span>
      <Explained meaning={statusMeaning(session)} className={statusColumn}>
        <Dot tone={waiting ? 'attention' : 'off'} />
        <span className={cn('text-xs', waiting ? 'font-medium text-amber-400' : 'text-muted-foreground')}>
          {session.status ?? missingStatus}
        </span>
      </Explained>
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span className={cn('truncate text-sm', derived ? 'text-muted-foreground' : 'font-medium')} title={name}>
          {name}
        </span>
        {derived
          ? (
            <Explained meaning="Claude Code's generated name for an unnamed session; not a resume handle">
              <span className="text-xs text-muted-foreground/70">auto-named</span>
            </Explained>
          )
          : null}
        {session.kind === 'interactive' ? null : <Badge variant="outline">{session.kind}</Badge>}
      </span>
      <span className="shrink-0 text-xs text-muted-foreground" title={`Started ${absoluteTime(session.startedAt)}`}>
        started {relativeTime(session.startedAt, now)}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-2">
        <ClaudeActions session={session} onFocus={onFocus} onFailure={setFailure} />
      </span>
      {session.waitingFor === null
        ? null
        : <p className="w-full text-xs text-amber-400 wrap-anywhere">{session.waitingFor}</p>}
      {failure === null ? null : <p className="w-full text-xs text-destructive wrap-anywhere">{failure}</p>}
    </li>
  )
}

/** One Codex thread, in the same columns, so the two harnesses read as one list. */
function CodexRow({ thread, now }: { thread: CodexThread; now: number }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t py-2 first:border-t-0">
      <span className={harnessColumn}>
        <Badge variant="outline">Codex {thread.origin}</Badge>
      </span>
      <Explained meaning={loadedMeaning(thread.loaded)} className={statusColumn}>
        <Dot tone={thread.loaded === null ? 'unknown' : thread.loaded ? 'on' : 'off'} />
        <span className="text-xs text-muted-foreground">
          {thread.loaded === null ? 'unknown' : thread.loaded ? 'open' : 'not open'}
        </span>
      </Explained>
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate text-sm" title={thread.name}>{thread.name}</span>
      </span>
      <span className="shrink-0 text-xs text-muted-foreground" title={`Updated ${absoluteTime(thread.updatedAt)}`}>
        updated {relativeTime(thread.updatedAt, now)}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-2">
        <Button variant="outline" size="xs" render={<a aria-label={`Open ${thread.name} in Codex`} href={thread.link} />}>
          <ExternalLink /> Open in Codex
        </Button>
        {thread.resume === null ? null : <CopyButton command={thread.resume} label="Copy resume" />}
      </span>
    </li>
  )
}

/**
 * The strip under a board's header: one row per session, so what a row's
 * buttons act on is the session named beside them. A source that could not be
 * reached says so on its own line, because an empty strip means "nothing is
 * working here" and must never stand in for "nobody answered".
 */
export function AgentsStrip({ agents, error, now, onFocus }: {
  agents: AgentsSummary | null
  error: string | null
  now: number
  onFocus: (pid: number) => Promise<FocusResult>
}) {
  if (agents === null && error === null) return null
  const notices = [...(agents?.notices ?? []), ...(error === null ? [] : [error])]
  const empty = agents === null || (agents.claude.length === 0 && agents.codex.length === 0)

  return (
    <TooltipProvider>
      <section aria-label="Agents" className="space-y-2 border-b px-6 py-2">
        {empty ? <p className="py-1 text-sm text-muted-foreground">No agent sessions here</p> : (
          <ul>
            {agents.claude.map((session) => (
              <ClaudeRow
                key={session.sessionId ?? session.backgroundId ?? `${session.kind}:${session.pid}`}
                session={session}
                now={now}
                onFocus={onFocus}
              />
            ))}
            {agents.codex.map((thread) => <CodexRow key={thread.id} thread={thread} now={now} />)}
          </ul>
        )}
        {notices.length === 0
          ? null
          : <p className="text-xs text-muted-foreground">{notices.join(' · ')}</p>}
      </section>
    </TooltipProvider>
  )
}
