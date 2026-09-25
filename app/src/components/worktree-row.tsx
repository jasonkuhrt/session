import { House } from 'lucide-react'

import type { DaemonCapabilities, PullRequestReport, PullRequestReports, WorktreeSummary } from '../../contract'
import { landing } from '../lib/drag'
import type { MainTile } from '../lib/epics'
import { checkoutLabel } from '../lib/format'
import { cn } from '../lib/utils'
import { AgentPills } from './agent-pills'
import { Copyable } from './copyable'
import { PullRequestChip } from './pull-request-chip'
import { StageGlyph } from './stage-glyph'
import { Explained, useTip } from './tip'
import { TrailerCount } from './trailer-problems'
import { Badge } from './ui/badge'
import { Card } from './ui/card'
import { TerminalAction, ZedAction } from './worktree-actions'

/** What a row needs beyond itself, the same for every row on the page. */
export type RowContext = {
  /** gh's last report for each row's branch, by the worktree's path. */
  readonly pullRequests: PullRequestReports
  readonly now: number
  /** What the daemon can open a worktree in: a terminal in cmux, and Zed. */
  readonly capabilities: DaemonCapabilities
}

const detachedMeaning = 'Git has a commit checked out in this worktree rather than a branch, so it has no branch and no pull request.'

const outsideGitMeaning = 'This folder is not a Git worktree, so it has no branch.'

const notServedMeaning = 'The daemon cannot serve this worktree’s board, for the reason beside this.'

const quietTileMeaning = 'Nothing is live here and nothing has happened in five days, so this tile is dim.'

const mainMeaning =
  'The main worktree of its repository: Git keeps the repository here and lists it first, so it is pinned above the epics and is never in one.'

/** How a card looks for what it is and what a drag is doing to it: dim when quiet, outlined where a held card would land, faint while it is the one held. */
export const cardClass = ({ quiet, lands, held }: { quiet: boolean; lands: boolean; held: boolean }) =>
  cn('gap-0 py-0', quiet && 'opacity-60', lands && landing, held && 'opacity-40')

/**
 * One worktree in two lines, since there are no columns to carry the rest:
 * its name and the agents live in it, then its branch and pull request, with
 * the glyph of what its session holds beside both. A row the daemon cannot
 * serve says why in place of the second line, and a `meta/epic` it cannot
 * read as a name says why on it, in the words `session check` gives.
 */
export function WorktreeRow({ row, context }: { row: WorktreeSummary; context: RowContext }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
      <div className="col-start-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        {row.main ? (
          <Explained meaning={mainMeaning} className="text-muted-foreground">
            <House aria-hidden className="size-3.5" />
          </Explained>
        ) : null}
        <WorktreeName row={row} />
        <TrailerCount problems={row.trailerProblems} />
        {context.capabilities.terminal ? <TerminalAction path={row.path} name={row.name} size="icon-xs" /> : null}
        {context.capabilities.zed ? <ZedAction path={row.path} name={row.name} size="icon-xs" /> : null}
        <AgentPills agents={row.agents} now={context.now} />
      </div>
      {row.conflict === null ? (
        <div className="col-start-2 row-span-2 row-start-1">
          <StageGlyph counts={row.counts} executing={row.executing} />
        </div>
      ) : null}
      <div className="col-start-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
        {row.conflict === null
          ? (
            <>
              <Checkout row={row} />
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
 * before it. Where it sits is its tip. It opens the worktree's board, unless
 * the daemon cannot serve one.
 */
function WorktreeName({ row }: { row: WorktreeSummary }) {
  const tip = useTip()
  return row.conflict === null
    ? (
      <a
        className="min-w-0 rounded-sm font-medium wrap-anywhere underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        href={`/w/${row.key}/`}
        title={tip(row.path)}
      >
        {row.name}
      </a>
    )
    : <span className="min-w-0 font-medium wrap-anywhere text-muted-foreground" title={tip(row.path)}>{row.name}</span>
}

/** What the worktree has checked out, in Git's words: its branch, to copy, or why it has none. */
function Checkout({ row }: { row: WorktreeSummary }) {
  const tip = useTip()
  return row.branch === null
    ? <span title={tip(row.detached ? detachedMeaning : outsideGitMeaning)}>{checkoutLabel(row)}</span>
    : <Copyable value={row.branch}><span className="wrap-anywhere">{row.branch}</span></Copyable>
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

/**
 * The main worktrees, one per repository whose main checkout has a session,
 * pinned above the cards by name and never dragged: a main worktree is never
 * in an epic.
 */
export function MainStrip({ mains, context }: { mains: readonly MainTile[]; context: RowContext }) {
  const tip = useTip()
  if (mains.length === 0) return null
  return (
    <section aria-label="Main worktrees" className="worktree-strip">
      {mains.map(tile => (
        <Card
          key={tile.row.path}
          size="sm"
          title={tile.quiet ? tip(quietTileMeaning) : undefined}
          className={cardClass({ quiet: tile.quiet, lands: false, held: false })}
        >
          <div className="px-3 py-2.5">
            <WorktreeRow row={tile.row} context={context} />
          </div>
        </Card>
      ))}
    </section>
  )
}
