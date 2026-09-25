import { LayoutGrid } from 'lucide-react'

import type { Links, Session } from '../../contract'
import { LinearIssues } from './linear-issues'
import { PageLinks } from './page-links'
import { PullRequestChip } from './pull-request-chip'
import { SettingsMenu } from './settings-menu'
import { TerminalAction } from './terminal-action'
import { useTip } from './tip'
import { Button } from './ui/button'
import { TooltipProvider } from './ui/tooltip'
import { WorktreePicker } from './worktree-picker'

/**
 * The board's header: the way back to every worktree, the worktree you are
 * looking at with the branch checked out in it and a way to switch, where the
 * work lives outside the files, the session's pages beside its lanes, a
 * terminal here, and the board's own settings. A page deeper than the board
 * carries its own trail instead, because by then where you are is a position
 * rather than a control.
 *
 * Left to right: "All worktrees", where every trail starts too, then the
 * worktree with its terminal beside it, since the terminal opens in that
 * worktree, then where the work lives outside the files, then the session's
 * rules, ledger, context and archive; the settings stay at the far end. A
 * source that could not answer says so where its chip would be, and a control
 * that cannot act is not drawn.
 */
export function SessionHeader({ worktree, rules, links, linksError, terminal }: {
  worktree: Session['worktree'] | undefined
  /** Whether the session holds `RULES.md`. */
  rules: boolean
  /** Null until the daemon has answered once. */
  links: Links | null
  /** Why the latest read of the links failed; the last answer stays on screen. */
  linksError: string | null
  /** Whether the daemon can run cmux. */
  terminal: boolean
}) {
  const tip = useTip()
  return (
    <TooltipProvider>
      {/* The header wraps rather than pushing the page wider than the window. */}
      <header className="flex flex-wrap items-center gap-x-8 gap-y-3 border-b px-6 py-4">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2.5"
          nativeButton={false}
          title={tip('Every worktree the daemon is tracking.')}
          render={<a aria-label="All worktrees" href="/" />}
        >
          <LayoutGrid /> All worktrees
        </Button>
        {worktree ? (
          <div className="flex items-center gap-1.5">
            <WorktreePicker current={worktree} />
            {terminal ? <TerminalAction path={worktree.path} name={worktree.name} size="icon-sm" /> : null}
          </div>
        ) : null}
        <LinksGroup links={links} linksError={linksError} />
        <PageLinks rules={rules} />
        <SettingsMenu className="ml-auto" />
      </header>
    </TooltipProvider>
  )
}

/**
 * Where the work lives outside the files: the pull request, the Linear issues
 * the branch and the pull request name, and what each source that could not
 * answer said, in the place its chips would be. Nothing is drawn when there is
 * no pull request, no issue and no notice.
 */
function LinksGroup({ links, linksError }: { links: Links | null; linksError: string | null }) {
  const notices = [links?.pullRequest.notice ?? null, links?.issues.notice ?? null, linksError]
    .filter((notice) => notice !== null)
  const pr = links?.pullRequest.pr ?? null
  const issues = links?.issues.issues ?? []
  if (pr === null && issues.length === 0 && notices.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-2">
      {links === null || pr === null ? null : <PullRequestChip pr={pr} reportedAt={links.pullRequest.reportedAt} />}
      {links === null ? null : <LinearIssues issues={issues} reportedAt={links.issues.reportedAt} />}
      {notices.length === 0 ? null : <span className="text-xs text-muted-foreground">{notices.join(' · ')}</span>}
    </div>
  )
}
