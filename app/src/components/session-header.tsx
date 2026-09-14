import { LayoutGrid } from 'lucide-react'
import type * as React from 'react'

import type { Session } from '../../contract'
import { Copyable } from './copyable'
import { Button } from './ui/button'
import { WorktreePicker } from './worktree-picker'

/**
 * The one header every worktree surface wears: which worktree and branch you
 * are looking at, a way to switch worktrees, and the way back out. A page
 * deeper than the board passes what leads back to it.
 */
export function SessionHeader({
  worktree,
  back,
}: {
  worktree: Session['worktree'] | undefined
  back?: React.ReactNode
}) {
  return (
    // The header wraps rather than pushing the page wider than the window.
    <header className="flex flex-wrap items-center gap-8 border-b px-6 py-5">
      {back}
      {worktree ? (
        <dl className="flex gap-8 text-sm">
          <div>
            <dt className="text-muted-foreground">Branch</dt>
            <dd className="font-medium">
              {worktree.branch === null
                ? 'No branch'
                : <Copyable value={worktree.branch}>{worktree.branch}</Copyable>}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Worktree</dt>
            <dd>
              <WorktreePicker current={worktree} />
            </dd>
          </div>
        </dl>
      ) : null}
      <Button variant="ghost" size="sm" className="ml-auto" render={<a aria-label="All sessions" href="/" />}>
        <LayoutGrid /> All sessions
      </Button>
    </header>
  )
}
