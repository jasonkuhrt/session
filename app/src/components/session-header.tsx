import { LayoutGrid } from 'lucide-react'

import type { Session } from '../../contract'
import { Copyable } from './copyable'
import { Button } from './ui/button'
import { WorktreePicker } from './worktree-picker'

/**
 * The board's header: which worktree and branch you are looking at, a way to
 * switch worktrees, and the way back to every session. A page deeper than the
 * board carries its own trail instead, because by then where you are is a
 * position rather than a pair of fields.
 */
export function SessionHeader({ worktree }: { worktree: Session['worktree'] | undefined }) {
  return (
    // The header wraps rather than pushing the page wider than the window.
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
  )
}
