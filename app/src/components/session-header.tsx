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
  const notices = [...(links?.notices ?? []), ...(linksError === null ? [] : [linksError])]
  const pr = links?.pr ?? null
  return (
    <TooltipProvider>
      {/* The header wraps rather than pushing the page wider than the window. */}
      <header className="flex flex-wrap items-center gap-8 border-b px-6 py-5">
        {worktree ? (
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
        ) : null}
        {pr === null && notices.length === 0 ? null : (
          <div className="flex flex-wrap items-center gap-2">
            {links === null || pr === null ? null : <PullRequestChip pr={pr} reportedAt={links.reportedAt} />}
            {notices.length === 0 ? null : <span className="text-xs text-muted-foreground">{notices.join(' · ')}</span>}
          </div>
        )}
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
