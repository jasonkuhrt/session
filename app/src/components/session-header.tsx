import { LayoutGrid } from 'lucide-react'

import type { Links, Session } from '../../contract'
import type { Filter } from '../lib/filter'
import { indexMeaning } from '../lib/index-meanings'
import { FilterPicker } from './filter-picker'
import { LinearIssues } from './linear-issues'
import { PageLinks } from './page-links'
import { PullRequestChip } from './pull-request-chip'
import { SettingsMenu } from './settings-menu'
import { useTip } from './tip'
import { Button } from './ui/button'
import { TooltipProvider } from './ui/tooltip'
import { TerminalAction, ZedAction } from './worktree-actions'

/**
 * The board's header: the way back to every project, what the board shows as
 * the control that switches to another board, where the work lives outside
 * the files, the pages beside its lanes, a terminal and Zed there, and the
 * board's own settings. A page deeper than the board carries its own trail
 * instead, because by then where you are is a position rather than a control.
 *
 * Left to right: "All projects", where every trail starts too, then the
 * worktree with its terminal and Zed beside it, since both open in that
 * worktree, then where the work lives outside the files, then the session's
 * rules, ledger, context and archive; the settings stay at the far end. An
 * epic's board and a project's name their epic or project in the control, and
 * carry only the ledger of every worktree in view beside it: what belongs to
 * one worktree alone is on its own board. A source that could not answer says
 * so where its chip would be, and a control that cannot act is not drawn.
 */
export function SessionHeader({ filter, worktree, rules, links, linksError, terminal, zed }: {
  /** What the board shows. */
  filter: Filter
  /** On a worktree's board, its worktree once the session has been read. */
  worktree: Session['worktree'] | undefined
  /** Whether the session holds `RULES.md`. */
  rules: boolean
  /** Null until the daemon has answered once. */
  links: Links | null
  /** Why the latest read of the links failed; the last answer stays on screen. */
  linksError: string | null
  /** Whether the daemon can run cmux. */
  terminal: boolean
  /** Whether the daemon can run zed. */
  zed: boolean
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
          title={tip(indexMeaning)}
          render={<a aria-label="All projects" href="/" />}
        >
          <LayoutGrid /> All projects
        </Button>
        {filter.kind === 'worktree' ? (worktree ? (
          <div className="flex items-center gap-1.5">
            <FilterPicker filter={filter} worktree={worktree} />
            {terminal ? <TerminalAction path={worktree.path} name={worktree.name} size="icon-sm" /> : null}
            {zed ? <ZedAction path={worktree.path} name={worktree.name} size="icon-sm" /> : null}
          </div>
        ) : null) : (
          <div className="flex items-center gap-1.5">
            <FilterPicker filter={filter} />
          </div>
        )}
        <LinksGroup links={links} linksError={linksError} />
        <PageLinks filter={filter} rules={rules} />
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
