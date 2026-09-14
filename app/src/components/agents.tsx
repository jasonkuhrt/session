import { Check, Copy, ExternalLink, Globe, SquareTerminal } from 'lucide-react'
import * as React from 'react'

import type { AgentsSummary, ClaudeSession, CodexThread, FocusResult } from '../../contract'
import { absoluteTime, relativeTime } from '../lib/format'
import { cn } from '../lib/utils'
import { Badge } from './ui/badge'
import { Button } from './ui/button'

/**
 * How the agents working in a worktree are shown: counts in a cell on the
 * index, a chip apiece on its board. Everything here is a read-only overlay
 * over what Claude Code and Codex answered when the daemon last asked them,
 * and it says only what those answers carry. A status string it does not
 * recognise is rendered as it arrived rather than folded into one it does.
 */

/** The statuses Claude Code reports today, in the order a person needs them. */
const statusOrder = ['waiting', 'busy', 'shell', 'idle']

/** A session the listing gave no status for; not a value the enum can take. */
const missingStatus = 'no status'

/** The one status that means a person is being waited on. */
const waitingStatus = 'waiting'

/** How long a copied confirmation stays up before the button says its name again. */
const copiedMilliseconds = 1_500

/**
 * Sessions per status: the known statuses in their order, then anything newer
 * in the order it arrived, so a value this build has never heard of is counted
 * and named rather than dropped.
 */
function statusCounts(sessions: readonly ClaudeSession[]) {
  const counts = new Map<string, number>()
  for (const session of sessions) {
    const status = session.status ?? missingStatus
    counts.set(status, (counts.get(status) ?? 0) + 1)
  }
  const rank = (status: string) => {
    const known = statusOrder.indexOf(status)
    return known === -1 ? statusOrder.length : known
  }
  return [...counts].map(([status, count]) => ({ status, count })).toSorted((left, right) =>
    rank(left.status) - rank(right.status)
  )
}

/** Threads a live process holds open right now; `null` is unknown, never open. */
const loadedCount = (threads: readonly CodexThread[]) =>
  threads.filter((thread) => thread.loaded === true).length

/** Copy feedback that reverts, and that says so when the browser refused. */
function useCopy() {
  const [state, setState] = React.useState<'idle' | 'copied' | 'failed'>('idle')
  // No timer has id 0, so it is the one value that stands for "none pending".
  const timer = React.useRef(0)
  React.useEffect(() => () => window.clearTimeout(timer.current), [])
  const copy = async (text: string) => {
    window.clearTimeout(timer.current)
    try {
      await navigator.clipboard.writeText(text)
      setState('copied')
    } catch {
      setState('failed')
    }
    timer.current = window.setTimeout(() => setState('idle'), copiedMilliseconds)
  }
  return [state, copy] as const
}

/** The one copy button both kinds of chip use: a command, and what happened to it. */
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

/**
 * The counts for one worktree's row. Only what is there: a status with no
 * sessions is absent, and Codex is named only while a thread is open in an app.
 */
export function AgentsCell({ agents }: { agents: AgentsSummary }) {
  const counts = statusCounts(agents.claude)
  const open = loadedCount(agents.codex)
  if (counts.length === 0 && open === 0) return <span className="text-muted-foreground">—</span>

  const parts = counts.map((entry) => ({
    key: entry.status,
    text: `${entry.count} ${entry.status}`,
    accent: entry.status === waitingStatus,
  }))
  if (open > 0) parts.push({ key: 'codex', text: `${open} Codex open`, accent: false })

  return (
    <span className="flex flex-wrap items-baseline whitespace-nowrap text-muted-foreground">
      {parts.map((part, index) => (
        // The separator belongs to the part after it, so a wrap never leaves
        // one dangling at the end of a line.
        <span key={part.key} className={cn('tabular-nums', part.accent && 'font-medium text-amber-400')}>
          {index === 0 ? null : <span aria-hidden className="text-muted-foreground/40">&nbsp;·&nbsp;</span>}
          {part.text}
        </span>
      ))}
    </span>
  )
}

/** A dot that carries one fact, and the words for it on hover. */
function Dot({ tone, title }: { tone: 'on' | 'attention' | 'off' | 'unknown'; title: string }) {
  // Attention is the one tone with a hue: it marks a session blocked on a person.
  const fill = tone === 'attention'
    ? 'bg-amber-400'
    : tone === 'on'
    ? 'bg-primary'
    : tone === 'unknown'
    ? 'border border-muted-foreground/50'
    : 'bg-muted-foreground/40'
  return <span title={title} className={cn('size-2 shrink-0 rounded-full', fill)} />
}

/** What to call a session: its name, else whatever handle identifies it. */
const sessionName = (session: ClaudeSession) =>
  session.name ?? session.backgroundId ?? (session.pid === null ? 'Session' : `pid ${session.pid}`)

/** Who the session is: how it is doing, what it is called, and since when. */
function ClaudeIdentity({ session, now }: { session: ClaudeSession; now: number }) {
  const waiting = session.status === waitingStatus
  // A derived name is a label Claude Code made up, not a handle `--resume`
  // knows, so it is never dressed as one.
  const derived = session.nameSource === 'derived' || session.name === null
  const name = sessionName(session)
  return (
    <>
      <Dot tone={waiting ? 'attention' : 'off'} title={session.status ?? 'Status not reported'} />
      <span className={cn('text-xs', waiting ? 'font-medium text-amber-400' : 'text-muted-foreground')}>
        {session.status ?? missingStatus}
      </span>
      <span
        className={cn('max-w-56 truncate text-sm', derived ? 'text-muted-foreground' : 'font-medium')}
        title={derived ? `${name} — a name Claude Code derived, not a resume handle` : name}
      >
        {name}
      </span>
      {session.kind === 'interactive' ? null : <Badge variant="outline">{session.kind}</Badge>}
      <span className="text-xs text-muted-foreground" title={`Started ${absoluteTime(session.startedAt)}`}>
        started {relativeTime(session.startedAt, now)}
      </span>
    </>
  )
}

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
            <SquareTerminal /> Terminal
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
          <Globe /> claude.ai
        </Button>
      )}
      {session.terminal === null && session.resume !== null
        ? <CopyButton command={session.resume} label="Copy resume" />
        : null}
    </>
  )
}

function ClaudeChip({ session, now, onFocus }: {
  session: ClaudeSession
  now: number
  onFocus: (pid: number) => Promise<FocusResult>
}) {
  const [failure, setFailure] = React.useState<string | null>(null)
  return (
    <div className="flex min-w-0 max-w-full flex-col gap-1 rounded-lg border px-2.5 py-2">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <ClaudeIdentity session={session} now={now} />
        <ClaudeActions session={session} onFocus={onFocus} onFailure={setFailure} />
      </div>
      {session.waitingFor === null
        ? null
        : <p className="text-xs text-muted-foreground wrap-anywhere">{session.waitingFor}</p>}
      {failure === null ? null : <p className="text-xs text-destructive wrap-anywhere">{failure}</p>}
    </div>
  )
}

function CodexChip({ thread, now }: { thread: CodexThread; now: number }) {
  return (
    <div className="flex min-w-0 max-w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-2.5 py-2">
      <Dot
        tone={thread.loaded === null ? 'unknown' : thread.loaded ? 'on' : 'off'}
        title={thread.loaded === null
          ? 'Whether an app holds this thread could not be read'
          : thread.loaded
          ? 'Loaded in an app'
          : 'Not loaded'}
      />
      <Badge variant="outline">{thread.origin}</Badge>
      <span className="max-w-56 truncate text-sm" title={thread.name}>{thread.name}</span>
      <span className="text-xs text-muted-foreground" title={absoluteTime(thread.updatedAt)}>
        {relativeTime(thread.updatedAt, now)}
      </span>
      <Button variant="outline" size="xs" render={<a aria-label={`Open ${thread.name} in Codex`} href={thread.link} />}>
        <ExternalLink /> Open in Codex
      </Button>
      {thread.resume === null ? null : <CopyButton command={thread.resume} label="Copy resume" />}
    </div>
  )
}

/**
 * The strip under a board's header. A source that could not be reached says so
 * on its own line, because an empty strip means "nothing is working here" and
 * must never stand in for "nobody answered".
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
    <section aria-label="Agents" className="space-y-2 border-b px-6 py-3">
      {empty ? <p className="text-sm text-muted-foreground">No agent sessions here</p> : (
        <div className="flex flex-wrap items-start gap-2">
          {agents.claude.map((session) => (
            <ClaudeChip
              key={session.sessionId ?? session.backgroundId ?? `${session.kind}:${session.pid}`}
              session={session}
              now={now}
              onFocus={onFocus}
            />
          ))}
          {agents.codex.map((thread) => <CodexChip key={thread.id} thread={thread} now={now} />)}
        </div>
      )}
      {notices.length === 0
        ? null
        : <p className="text-xs text-muted-foreground">{notices.join(' · ')}</p>}
    </section>
  )
}
