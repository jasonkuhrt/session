import { House } from 'lucide-react'

import type { DaemonCapabilities, PullRequestReport, PullRequestReports, WorktreeSummary } from '../../contract'
import type { StageRange } from '../lib/dashboard'
import { landing } from '../lib/drag'
import { checkoutLabel } from '../lib/format'
import { mainMeaning } from '../lib/index-meanings'
import { cn } from '../lib/utils'
import { AgentPills } from './agent-pills'
import { Copyable } from './copyable'
import { PullRequestChip } from './pull-request-chip'
import { StageGlyph } from './stage-glyph'
import { Explained, useTip } from './tip'
import { TrailerCount } from './trailer-problems'
import { Badge } from './ui/badge'
import { TerminalAction, ZedAction } from './worktree-actions'
import { CheckoutMark, WorktreeMark } from './worktree-marks'

/** What a row needs beyond itself, the same for every row on the page. */
export type RowContext = {
  /** gh's last report for each row's branch, by the worktree's path. */
  readonly pullRequests: PullRequestReports
  readonly now: number
  /** What the daemon can open a worktree in: a terminal in cmux, and Zed. */
  readonly capabilities: DaemonCapabilities
  /** The fewest and the most items any stage drawn on the page holds, which every row's glyph is measured against. */
  readonly stageRange: StageRange
}

/** What any worktree on the index is, said by the mark before its name, since the page has no heading to say it. */
const listedMeaning = 'A worktree, on this page while it has a session: it joins when a session is created in it, and leaves when that session is gone.'

const detachedMeaning = 'Git has a commit checked out in this worktree rather than a branch, so it has no branch and no pull request.'

const outsideGitMeaning = 'This folder is not a Git worktree, so it has no branch.'

const notServedMeaning = 'The daemon cannot serve this worktree’s board, for the reason beside this.'

/** How a card looks for what it is and what a drag is doing to it: dim when quiet, outlined where a held card would land, faint while it is the one held. */
export const cardClass = ({ quiet, lands, held }: { quiet: boolean; lands: boolean; held: boolean }) =>
  cn('gap-0 py-0', quiet && 'opacity-60', lands && landing, held && 'opacity-40')

/**
 * One worktree in two lines, since there are no columns to carry the rest:
 * the glyph of what its session holds at the top left, then its name and the
 * agents live in it, then its branch and pull request under them, each line
 * marked as the worktree picker marks it. A row the daemon cannot serve has no
 * glyph and says why in place of the second line, and a `meta/epic` it cannot
 * read as a name says why on it, in the words `session check` gives.
 * `meaning` is what the mark before the name says the worktree is here, and
 * `name` the name it is drawn under, where a head needs more than its own.
 */
export function WorktreeRow({ row, context, meaning = listedMeaning, name = row.name }: {
  row: WorktreeSummary
  context: RowContext
  meaning?: string
  name?: string
}) {
  return (
    // The glyph's column is as wide as a glyph whether or not the row draws
    // one, so the names in one card line up.
    <div className="grid grid-cols-[1.75rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1">
      <div className="col-start-1 row-start-1">
        {row.conflict === null
          ? <StageGlyph counts={row.counts} executing={row.executing} range={context.stageRange} />
          : null}
      </div>
      <div className="col-start-2 row-start-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        {row.main ? (
          <Explained meaning={mainMeaning} className="text-muted-foreground">
            <House aria-hidden className="size-3.5" />
          </Explained>
        ) : null}
        <span className="flex min-w-0 items-center gap-1.5">
          <Explained meaning={meaning}>
            <WorktreeMark />
          </Explained>
          <WorktreeName row={row} name={name} />
        </span>
        <TrailerCount problems={row.trailerProblems} />
        {context.capabilities.terminal ? <TerminalAction path={row.path} name={row.name} size="icon-xs" /> : null}
        {context.capabilities.zed ? <ZedAction path={row.path} name={row.name} size="icon-xs" /> : null}
        <AgentPills agents={row.agents} now={context.now} />
      </div>
      <div className="col-start-2 row-start-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
        {row.conflict === null
          ? (
            <>
              <Checkout branch={row.branch} detached={row.detached} />
              <PullRequestSlot report={context.pullRequests[row.path]} />
            </>
          )
          : <NotServed reason={row.conflict} />}
        {row.epicProblem === null ? null : <span className="text-xs wrap-anywhere text-destructive">{row.epicProblem}</span>}
      </div>
    </div>
  )
}

/**
 * The name alone, which already tells the worktrees apart: a worktree whose
 * folder shares the main checkout's name carries its parent folder's name
 * before it, and so does a head whose section shares its name with another.
 * Where it sits is its tip. It opens the worktree's board, unless the daemon
 * cannot serve one.
 */
function WorktreeName({ row, name }: { row: WorktreeSummary; name: string }) {
  const tip = useTip()
  return row.conflict === null
    ? (
      <a
        className="min-w-0 rounded-sm font-medium wrap-anywhere underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        href={`/w/${row.key}/`}
        title={tip(row.path)}
      >
        {name}
      </a>
    )
    : <span className="min-w-0 font-medium wrap-anywhere text-muted-foreground" title={tip(row.path)}>{name}</span>
}

/** What a worktree has checked out, in Git's words and under the picker's mark: its branch, to copy, or why it has none. */
export function Checkout({ branch, detached }: { branch: string | null; detached: boolean }) {
  const tip = useTip()
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <CheckoutMark detached={detached} />
      {branch === null
        ? <span title={tip(detached ? detachedMeaning : outsideGitMeaning)}>{checkoutLabel({ branch, detached })}</span>
        : <Copyable value={branch}><span className="wrap-anywhere">{branch}</span></Copyable>}
    </span>
  )
}

/**
 * The branch's pull request as a board's header draws it, or, in its place,
 * gh's sentence for why it could not say. A branch with no pull request, and a
 * row gh has not been asked about yet, show nothing.
 */
function PullRequestSlot({ report }: { report: PullRequestReport | undefined }) {
  if (report?.pr) return <PullRequestChip pr={report.pr} reportedAt={report.reportedAt} />
  return report?.notice ? <span className="text-xs">{report.notice}</span> : null
}

function NotServed({ reason }: { reason: string }) {
  const tip = useTip()
  return (
    <span className="flex flex-wrap items-baseline gap-2">
      <Badge variant="destructive" title={tip(notServedMeaning)}>Not served</Badge>
      <span className="wrap-anywhere">{reason}</span>
    </span>
  )
}
