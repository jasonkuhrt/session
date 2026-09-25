import { ChevronDown } from 'lucide-react'

import type { LinearIssue } from '../../contract'
import { absoluteTime } from '../lib/format'
import { openOnceOnClick } from '../lib/open-once'
import { Tip, useTip } from './tip'
import { Badge } from './ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'

const opensOnce = 'Brings forward the Linear tab this page opened for it, or opens one.'

/**
 * The Linear issues this worktree names, as one chip however many there are:
 * the issue itself when there is one, and otherwise the first one named with
 * how many more, which lists them all. Like the pull request's chip it carries
 * no colour, because the lanes are where anything that needs you is shown;
 * this only says where the work is tracked.
 */
export function LinearIssues({ issues, reportedAt }: { issues: readonly LinearIssue[]; reportedAt: string }) {
  const [first] = issues
  if (first === undefined) return null
  if (issues.length === 1) return <LinearIssueChip issue={first} reportedAt={reportedAt} />
  return <LinearIssueList first={first} issues={issues} reportedAt={reportedAt} />
}

/**
 * One issue as a chip that is a link to it: the identifier, with the issue's
 * title, the state linear reports it in and when linear was asked one hover
 * away. A click opens the issue once: the tab it already has comes forward
 * instead of another.
 */
function LinearIssueChip({ issue, reportedAt }: { issue: LinearIssue; reportedAt: string }) {
  return (
    <Tip
      meaning={
        <span className="block space-y-1">
          <span className="block font-medium">{issue.id} {issue.title}</span>
          <span className="block">linear reports its state as {issue.state}.</span>
          <span className="block">linear was asked at {absoluteTime(reportedAt)}.</span>
          <span className="block">{opensOnce}</span>
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

/**
 * Several issues as one chip, the first one named and how many more, whose
 * list gives each one's identifier, title and the state linear reports it in,
 * in the order the branch and the pull request name them. Each opens once, as
 * a single chip does.
 */
function LinearIssueList({ first, issues, reportedAt }: {
  first: LinearIssue
  issues: readonly LinearIssue[]
  reportedAt: string
}) {
  const tip = useTip()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        nativeButton={false}
        render={<Badge variant="outline" />}
        aria-label={`${issues.length} Linear issues`}
        title={tip(`The ${issues.length} Linear issues the branch and the pull request name. Lists them.`)}
        className="cursor-pointer"
      >
        {first.id}
        <span className="text-muted-foreground">+{issues.length - 1}</span>
        <ChevronDown data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-auto max-w-[min(36rem,90vw)] min-w-72">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="font-normal">
            <span className="block text-foreground">
              {issues.length} Linear issues, named by the branch and the pull request
            </span>
            <span className="block">linear was asked at {absoluteTime(reportedAt)}.</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {issues.map((issue) => (
            <DropdownMenuItem
              key={issue.id}
              title={tip(opensOnce)}
              render={
                <a
                  aria-label={`Linear issue ${issue.id}: ${issue.title}`}
                  href={issue.url}
                  rel="noreferrer"
                  target="_blank"
                  onClick={openOnceOnClick(issue.url)}
                />
              }
            >
              <span className="font-medium">{issue.id}</span>
              <span className="min-w-0 flex-1 truncate">{issue.title}</span>
              <span className="text-muted-foreground">{issue.state}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
