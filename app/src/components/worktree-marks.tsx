import { FolderGit2, GitBranch, GitCommitHorizontal } from 'lucide-react'

/**
 * The marks that tell a worktree's name from what it has checked out, drawn
 * the same way wherever a worktree is: in the board's worktree picker and on
 * every row of the index. A folder goes before a worktree's name, a branch
 * before its branch, and a commit when Git has a commit checked out rather
 * than a branch.
 */

export function WorktreeMark() {
  return <FolderGit2 aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
}

export function CheckoutMark({ detached }: { detached: boolean }) {
  const Mark = detached ? GitCommitHorizontal : GitBranch
  return <Mark aria-hidden className="size-3.5 shrink-0" />
}
