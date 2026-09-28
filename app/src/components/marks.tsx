import type { AgentsSummary, ClaudeSession, CodexThread, IssuesReport, PullRequest, PullRequestReport, TrailerProblem, WorktreeSummary } from '../../contract'
import { isDerivedName, nameMeaning, sessionName } from '../lib/agent-names'
import { heldMeaning, heldWord, isLive, loadedMeaning, meaningOf, needsYou, sortSessions, sortThreads, wordOfThread } from '../lib/agents'
import { absoluteTime, checkoutLabel } from '../lib/format'
import { checksMark, reviewMeaning, reviewWord, stateMeaning, stateWord } from '../lib/links'
import { problemSentence, trailerMeaning } from '../lib/trailers'
import { cn } from '../lib/utils'
import type { Fact } from '../substrate/seam'
import { Dot } from './agent-marks'
import { useTip } from './tip'

/**
 * What can need you now about a worktree, drawn wherever the worktree is, its
 * step of the path line included when the view does not draw it: a dot per
 * live agent, the one accent a session waiting on a person, a `!` for a
 * source that could not answer or a file that breaks a rule, and its pull
 * request's number, coloured by its state and red while a check fails. The
 * rest of what is known about it is in the detail line, while it has the
 * focus.
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

/** What a source that could not answer said, one line each. */
const noticesOf = (signals: Signals) => [
  ...(signals.pullRequest?.notice === null || signals.pullRequest?.notice === undefined ? [] : [signals.pullRequest.notice]),
  ...(signals.issues?.notice === null || signals.issues?.notice === undefined ? [] : [signals.issues.notice]),
  ...(signals.agents?.notices ?? []),
  ...signals.failures,
]

/** The colour a pull request's number is drawn in: red while a check fails, else its state's. */
const prTone = (pr: PullRequest) => {
  if (pr.checks.failed > 0) return 'text-destructive'
  if (pr.state === 'MERGED') return 'text-(--tn-magenta)'
  if (pr.state === 'CLOSED') return 'text-destructive'
  return pr.isDraft ? 'text-muted-foreground' : 'text-(--tn-green)'
}

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
  if (sessions.length + threads.length + problems.length + notices.length === 0 && pr === null) return null
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-2', className)}>
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
      {pr === null ? null : <span title={tip(prSentence(pr))} className={cn('font-mono text-xs', prTone(pr))}>#{pr.number}</span>}
    </span>
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
        <span className={prTone(pr)}>
          #{pr.number} {stateWord(pr)}
          {pr.reviewDecision === null ? '' : `, ${reviewWord(pr.reviewDecision)}`}
          {checks === null ? '' : `, checks ${checks.kind}`}
        </span>
      ),
      meaning: `${prSentence(pr)} gh was asked at ${absoluteTime(report.reportedAt)}.`,
    })
  }
  for (const issue of signals.issues?.issues ?? []) {
    facts.push({ key: `issue:${issue.id}`, text: `${issue.id} ${issue.state}`, meaning: `${issue.id} ${issue.title}: linear reports it ${issue.state}.` })
  }
  const { sessions, threads } = liveOf(signals.agents)
  for (const session of sessions) {
    facts.push({
      key: `session:${session.sessionId ?? session.pid}`,
      text: (
        <span className={needsYou(session) ? 'text-attention' : undefined}>
          {/* A name Claude Code made from the folder repeats the folder, so it is drawn very dim. */}
          <span className={isDerivedName(session) ? 'opacity-30' : undefined}>{sessionName(session)}</span> {heldWord({ session, now })}
        </span>
      ),
      meaning: [meaningOf(session), heldMeaning(session), nameMeaning(session)].filter((sentence) => sentence !== null).join(' '),
    })
  }
  for (const thread of threads) facts.push({ key: `thread:${thread.id}`, text: threadWords(thread), meaning: loadedMeaning(thread.loaded) })
  for (const notice of noticesOf(signals)) facts.push({ key: `notice:${notice}`, text: <span className="font-semibold">! {notice}</span>, meaning: 'A source that could not answer, in its own words.' })
  for (const problem of signals.trailers.map((trailer) => problemSentence(trailer))) {
    facts.push({ key: `trailer:${problem}`, text: <span className="text-destructive">! {problem}</span>, meaning: trailerMeaning })
  }
  for (const problem of problemsOf({ ...signals, trailers: [] })) {
    facts.push({ key: `problem:${problem}`, text: <span className="text-destructive">! {problem}</span>, meaning: 'A file of the session’s meta/ that breaks its rule, in the words session check gives.' })
  }
  return facts
}
