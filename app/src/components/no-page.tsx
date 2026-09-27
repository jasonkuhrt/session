import { Link } from '@tanstack/react-router'

import { toIndex } from '../lib/base'

/**
 * An address no page of the board is at, and the way back to one: the root's
 * not-found page, and an epic's or a project's board once the rows say no
 * tracked worktree is in it.
 */
export function NoPage() {
  return (
    <main className="p-6">
      <p className="text-sm text-muted-foreground">
        No board page is at this address.{' '}
        <Link {...toIndex} className="underline underline-offset-4">All projects</Link>
      </p>
    </main>
  )
}
