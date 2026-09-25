import type { LinearIssue } from '../../contract'
import { absoluteTime } from '../lib/format'
import { openOnceOnClick } from '../lib/open-once'
import { Tip } from './tip'
import { Badge } from './ui/badge'

/**
 * One Linear issue this worktree names, as one chip that is a link to it: the
 * identifier, with the issue's title, the state linear reports it in and when
 * linear was asked one hover away. A click opens the issue once: the tab it
 * already has comes forward instead of another. Like the pull request's chip
 * it carries no colour, because the lanes are where anything that needs you
 * is shown; this only says where the work is tracked.
 */
export function LinearIssueChip({ issue, reportedAt }: { issue: LinearIssue; reportedAt: string }) {
  return (
    <Tip
      meaning={
        <span className="block space-y-1">
          <span className="block font-medium">{issue.id} {issue.title}</span>
          <span className="block">linear reports its state as {issue.state}.</span>
          <span className="block">linear was asked at {absoluteTime(reportedAt)}.</span>
          <span className="block">Brings forward the Linear tab this board opened for it, or opens one.</span>
        </span>
      }
      render={
        <Badge
          variant="outline"
          render={
            <a
              aria-label={`Linear issue ${issue.id}: ${issue.title}`}
              href={issue.url}
              rel="noreferrer"
              target="_blank"
              onClick={openOnceOnClick(issue.url)}
            />
          }
        />
      }
    >
      {issue.id}
    </Tip>
  )
}
