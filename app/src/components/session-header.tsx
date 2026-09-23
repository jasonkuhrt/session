import { LayoutGrid } from 'lucide-react'

import type { Links, Session } from '../../contract'
import { Copyable } from './copyable'
import { PullRequestChip } from './pull-request-chip'
import { TerminalAction } from './terminal-action'
import { Button } from './ui/button'
import { TooltipProvider } from './ui/tooltip'
import { WorktreePicker } from './worktree-picker'

/**
 * The board's header: which worktree and branch you are looking at, a way to
 * switch worktrees, where the work lives outside the files, a terminal here,
 * and the way back to every session. A page deeper than the board carries its
 * own trail instead, because by then where you are is a position rather than
 * a pair of fields.
 *
 * Left to right after the worktree and branch: where the work lives outside
 * the files, then the terminal; "All sessions" stays at the far end. A source
 * that could not answer says so where its chip would be, and a control that
 * cannot act is not drawn.
 */
export function SessionHeader({ worktree, links, linksError, terminal }: {
  worktree: Session['worktree'] | undefined
  /** Null until the daemon has answered once. */
  links: Links | null
  /** Why the latest read of the links failed; the last answer stays on screen. */
  linksError: string | null
  /** Whether the daemon can run cmux. */
  terminal: boolean
}) {
  return (
    <TooltipProvider>
      {/* The header wraps rather than pushing the page wider than the window. */}
      <header className="flex flex-wrap items-center gap-8 border-b px-6 py-5">
        {worktree ? <WorktreeFields worktree={worktree} /> : null}
        <LinksGroup links={links} linksError={linksError} />
        {terminal && worktree ? <TerminalAction path={worktree.path} name={worktree.name} size="icon-sm" /> : null}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          nativeButton={false}
          title="Every worktree the daemon is tracking."
          render={<a aria-label="All sessions" href="/" />}
        >
          <LayoutGrid /> All sessions
        </Button>
      </header>
    </TooltipProvider>
  )
}

/** The branch checked out here, and the worktree, with the way to switch to another. */
function WorktreeFields({ worktree }: { worktree: NonNullable<Session['worktree']> }) {
  return (
    <dl className="flex gap-8 text-sm">
      <div>
        <dt className="text-muted-foreground" title="The Git branch checked out in this worktree.">Branch</dt>
        <dd className="font-medium">
          {worktree.branch === null
            ? 'No branch'
            : <Copyable value={worktree.branch}>{worktree.branch}</Copyable>}
        </dd>
      </div>
      <div>
        <dt className="text-muted-foreground" title="The worktree whose session this board shows; switch to another below.">Worktree</dt>
        <dd>
          <WorktreePicker current={worktree} />
        </dd>
      </div>
    </dl>
  )
}

/**
 * Where the work lives outside the files: the pull request, and what each
 * source that could not answer said, in the place its chips would be. Nothing
 * is drawn when there is no pull request, no issue and no notice.
 */
function LinksGroup({ links, linksError }: { links: Links | null; linksError: string | null }) {
  const notices = [...(links?.notices ?? []), ...(linksError === null ? [] : [linksError])]
  const pr = links?.pr ?? null
  const issues = links?.issues ?? []
  if (pr === null && issues.length === 0 && notices.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-2">
      {links === null || pr === null ? null : <PullRequestChip pr={pr} reportedAt={links.reportedAt} />}
      {notices.length === 0 ? null : <span className="text-xs text-muted-foreground">{notices.join(' · ')}</span>}
    </div>
  )
}
