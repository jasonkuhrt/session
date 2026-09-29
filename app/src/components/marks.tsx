import type { AgentsSummary, ClaudeSession, CodexThread, IssuesReport, PullRequest, PullRequestReport, TrailerProblem, WorktreeSummary } from '../../contract'
import { isDerivedName, nameMeaning, sessionName } from '../lib/agent-names'
import { heldMeaning, heldWord, isLive, loadedMeaning, meaningOf, needsYou, sortSessions, sortThreads, wordOfThread } from '../lib/agents'
import { absoluteTime, checkoutLabel, tokenCount } from '../lib/format'
import { checksMark, reviewMeaning, reviewWord, stateMeaning, stateWord } from '../lib/links'
import { openOnceOnClick } from '../lib/open-once'
import { problemSentence, trailerMeaning } from '../lib/trailers'
import { cn } from '../lib/utils'
import { BesideLink } from '../substrate/beside-link'
import type { Fact } from '../substrate/seam'
import { Dot } from './agent-marks'
import { useTip } from './tip'
import { Badge } from './ui/badge'

/**
 * What can need you now about a worktree, drawn wherever the worktree is, its
 * step of the path line included when the view does not draw it: a dot per
 * live agent, the one accent a session waiting on a person, a `!` for a
 * source that could not answer or a file that breaks a rule, and its pull
 * request's number, a badge coloured by its state and red while a check
 * fails, which is a link to the pull request. They are drawn beside the link
 * of the row, the step or the name they are marks of, since a link holds no
 * other; everything but the number is drawn in that link again, so a click on
 * it is the row's, the step's or the name's. The rest of what is known about
 * it is in the detail line, while it has the focus.
 */

/** What a worktree's marks and facts are read from: its row, and a board's own reads of it when the page has them. */
export type Signals = {
  readonly agents: AgentsSummary | null
  readonly pullRequest: PullRequestReport | null
  readonly issues: IssuesReport | null
  readonly trailers: readonly TrailerProblem[]
  /** Why a read of the page's own failed, which the facts of the worktree it reads say. */
  readonly failures: readonly string[]
  readonly row: WorktreeSummary | null
}

/** The live sessions and threads, what needs a person first, as the pills of the index listed them. */
const liveOf = (agents: AgentsSummary | null) => ({
  sessions: agents === null ? [] : sortSessions(agents.claude).filter((session) => isLive(session)),
  threads: agents === null ? [] : sortThreads(agents.codex).filter((thread) => thread.loaded === true),
})

/** The problems a worktree's files and commits carry, one sentence each. */
const problemsOf = (signals: Signals) => [
  ...signals.trailers.map((problem) => problemSentence(problem)),
  ...(signals.row?.epicProblem === null || signals.row?.epicProblem === undefined ? [] : [signals.row.epicProblem]),
  ...(signals.row?.rankProblem === null || signals.row?.rankProblem === undefined ? [] : [signals.row.rankProblem]),
]

/** What a source that could not answer said, one line each, with when it was asked; a read of the page's own is as of now. */
const datedNoticesOf = (signals: Signals): ReadonlyArray<{ readonly line: string; readonly asked: string | null }> => [
  ...(signals.pullRequest?.notice === null || signals.pullRequest?.notice === undefined
    ? []
    : [{ line: signals.pullRequest.notice, asked: signals.pullRequest.reportedAt }]),
  ...(signals.issues?.notice === null || signals.issues?.notice === undefined ? [] : [{ line: signals.issues.notice, asked: signals.issues.reportedAt }]),
  ...(signals.agents?.notices ?? []).map((line) => ({ line, asked: signals.agents?.fetchedAt ?? null })),
  ...signals.failures.map((line) => ({ line, asked: null })),
]

/** What a source that could not answer said, one line each. */
const noticesOf = (signals: Signals) => datedNoticesOf(signals).map((notice) => notice.line)

/**
 * How many tokens are in a live session's context, as its last reply left
 * them, and where that count comes from: it is as old as the listing that
 * read it, since nothing watches a transcript, and it is never a share of a
 * window, since neither the listing nor the line says how large the window is.
 */
const contextMeaning = (session: ClaudeSession, listedAt: string | null): string | null => {
  const context = session.context
  if (context === null) return null
  const listing = listedAt === null ? 'the last listing' : `the listing at ${absoluteTime(listedAt)}`
  return [
    `${context.tokens.toLocaleString()} tokens in context: the input, cache-creation and cache-read tokens of its last reply, the count Claude Code's status line works from.`,
    `It is the count as of ${listing}: nothing watches a transcript, so a status change is what lists the agents again, and a turn that stays busy keeps this count until then.`,
    `Read from the usage on the last assistant line of its transcript${context.lineAt === null ? '' : `, written ${absoluteTime(context.lineAt)}`}: ${context.transcript}`,
  ].join(' ')
}

/** The colour that says where a pull request stands: red while a check fails or once it is closed, magenta once merged, dim as a draft, and green while open. */
const prTone = (pr: PullRequest) => {
  if (pr.checks.failed > 0 || pr.state === 'CLOSED') return 'red'
  if (pr.state === 'MERGED') return 'magenta'
  return pr.isDraft ? 'dim' : 'green'
}

/** A tone as the detail line draws the pull request's fact in it. */
const toneText = {
  red: 'text-destructive',
  magenta: 'text-(--tn-magenta)',
  dim: 'text-muted-foreground',
  green: 'text-(--tn-green)',
} as const satisfies Record<ReturnType<typeof prTone>, string>

/**
 * A tone as the badge the number is drawn as: the stock destructive badge for
 * red, and for the others the stock secondary one in the tone's colour, over
 * a tint of it as the destructive one is, but for a draft's, which is dim.
 */
const toneBadge = {
  red: { variant: 'destructive' },
  magenta: { variant: 'secondary', className: 'bg-(--tn-magenta)/20 text-(--tn-magenta)' },
  dim: { variant: 'secondary', className: 'text-muted-foreground' },
  green: { variant: 'secondary', className: 'bg-(--tn-green)/20 text-(--tn-green)' },
} as const satisfies Record<ReturnType<typeof prTone>, { readonly variant: 'destructive' | 'secondary'; readonly className?: string }>

/** A pull request in one line: gh's own words for where it stands and how its checks do. */
const prSentence = (pr: PullRequest) => {
  const checks = checksMark(pr.checks)
  return [
    `#${pr.number} ${pr.title}`,
    stateMeaning(pr),
    reviewMeaning(pr.reviewDecision),
    checks === null ? 'gh reports no checks on it.' : checks.meaning,
  ].join(' ')
}

const sessionWords = (session: ClaudeSession, now: number) => `${sessionName(session)} ${heldWord({ session, now })}`

const threadWords = (thread: CodexThread) => `${thread.name} ${wordOfThread(thread)}`

export function Marks({ signals, now, className }: { readonly signals: Signals; readonly now: number; readonly className?: string }) {
  const tip = useTip()
  const { sessions, threads } = liveOf(signals.agents)
  const problems = problemsOf(signals)
  const notices = noticesOf(signals)
  const pr = signals.pullRequest?.pr ?? null
  const words = sessions.length + threads.length + problems.length + notices.length
  if (words === 0 && pr === null) return null
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-2', className)}>
      {words === 0 ? null : (
        <BesideLink>
          {sessions.length + threads.length === 0 ? null : (
            <span className="inline-flex items-center gap-1">
              {sessions.map((session) => (
                <span key={session.sessionId ?? session.backgroundId ?? `${session.kind}:${session.pid}`} className="inline-flex" title={tip(`${sessionWords(session, now)}: ${meaningOf(session)}`)}>
                  <Dot tone={needsYou(session) ? 'attention' : 'on'} />
                </span>
              ))}
              {threads.map((thread) => (
                <span key={thread.id} className="inline-flex" title={tip(`${threadWords(thread)}: an app holds this Codex thread open.`)}>
                  <Dot tone="on" />
                </span>
              ))}
            </span>
          )}
          {problems.length === 0 ? null : <span title={tip(problems.join(' '))} className="font-mono text-xs font-semibold text-destructive">!</span>}
          {notices.length === 0 ? null : <span title={tip(notices.join(' '))} className="font-mono text-xs font-semibold text-muted-foreground">!</span>}
        </BesideLink>
      )}
      {pr === null ? null : <PullRequestNumber pr={pr} />}
    </span>
  )
}

/**
 * The pull request's number: a badge coloured by where the pull request
 * stands, and a link to its own address. A plain click on it opens the pull
 * request once, in a tab named for its address, as the Pull request command
 * does, and does nothing else, since it is a control of its own and not part
 * of the link it is drawn beside: it neither takes the focus nor opens the
 * row, the step or the name. A click with a modifier, or the middle button, is
 * the browser's, which opens the address in a tab of its own. A press leaves
 * the browser's focus with the page, as a press on a node does, so the key
 * after a click reaches the registry.
 */
function PullRequestNumber({ pr }: { readonly pr: PullRequest }) {
  const tip = useTip()
  return (
    <Badge
      {...toneBadge[prTone(pr)]}
      render={<a href={pr.url} target="_blank" rel="noreferrer" aria-label={`#${pr.number} pull request`} />}
      tabIndex={-1}
      title={tip(prSentence(pr))}
      onMouseDown={(event) => event.preventDefault()}
      onClick={openOnceOnClick(pr.url)}
    >
      #{pr.number}
    </Badge>
  )
}

/** The worktree's facts, for the detail line, in the order a reader asks them. */
export function worktreeFacts({ name, signals, now }: { readonly name: string; readonly signals: Signals; readonly now: number }): Fact[] {
  const { row } = signals
  const facts: Fact[] = [{ key: 'name', text: name, meaning: row?.path ?? name }]
  if (row !== null) {
    facts.push({
      key: 'branch',
      text: checkoutLabel({ branch: row.branch, detached: row.detached }),
      meaning: 'What Git has checked out in the worktree.',
    })
    if (row.conflict !== null) facts.push({ key: 'served', text: `Not served: ${row.conflict}`, meaning: 'Why the daemon serves no board for this worktree.' })
  }
  const report = signals.pullRequest
  const pr = report?.pr ?? null
  if (pr !== null && report !== null) {
    const checks = checksMark(pr.checks)
    facts.push({
      key: 'pr',
      text: (
        <span className={toneText[prTone(pr)]}>
          #{pr.number} {stateWord(pr)}
          {pr.reviewDecision === null ? '' : `, ${reviewWord(pr.reviewDecision)}`}
          {checks === null ? '' : `, checks ${checks.kind}`}
        </span>
      ),
      meaning: `${prSentence(pr)} gh was asked at ${absoluteTime(report.reportedAt)}.`,
    })
  }
  const { sessions, threads } = liveOf(signals.agents)
  for (const session of sessions) {
    facts.push({
      key: `session:${session.sessionId ?? session.pid}`,
      text: (
        <span className={needsYou(session) ? 'text-attention' : undefined}>
          {/* A name Claude Code made from the folder repeats the folder, so it is drawn very dim. */}
          <span className={isDerivedName(session) ? 'opacity-30' : undefined}>{sessionName(session)}</span> {heldWord({ session, now })}
          {session.context === null ? null : `, ${tokenCount(session.context.tokens)} in context`}
        </span>
      ),
      meaning: [meaningOf(session), heldMeaning(session), nameMeaning(session), contextMeaning(session, signals.agents?.fetchedAt ?? null)]
        .filter((sentence) => sentence !== null)
        .join(' '),
    })
  }
  for (const thread of threads) facts.push({ key: `thread:${thread.id}`, text: threadWords(thread), meaning: loadedMeaning(thread.loaded) })
  for (const notice of datedNoticesOf(signals)) {
    facts.push({
      key: `notice:${notice.line}`,
      text: <span className="font-semibold">! {notice.line}</span>,
      meaning: `A source that could not answer, in its own words${notice.asked === null ? ', as the page read it just now' : `, when it was asked at ${absoluteTime(notice.asked)}`}.`,
    })
  }
  for (const problem of signals.trailers.map((trailer) => problemSentence(trailer))) {
    facts.push({ key: `trailer:${problem}`, text: <span className="text-destructive">! {problem}</span>, meaning: trailerMeaning })
  }
  for (const problem of problemsOf({ ...signals, trailers: [] })) {
    facts.push({ key: `problem:${problem}`, text: <span className="text-destructive">! {problem}</span>, meaning: 'A file of the session’s meta/ that breaks its rule, in the words session check gives.' })
  }
  return facts
}
