import { BookMarked, Boxes, FolderGit2, GitBranch, GitCommitHorizontal } from 'lucide-react'

/**
 * The marks that tell a worktree's name from what it has checked out, and a
 * worktree from an epic and a project, drawn the same way wherever each is: in
 * the board's picker, in its lanes and on the index. A folder goes before a
 * worktree's name, a branch before its branch, and a commit when Git has a
 * commit checked out rather than a branch; boxes before an epic's name, and a
 * book, a repository's, before a project's.
 */

export function WorktreeMark() {
  return <FolderGit2 aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
}

export function CheckoutMark({ detached }: { detached: boolean }) {
  const Mark = detached ? GitCommitHorizontal : GitBranch
  return <Mark aria-hidden className="size-3.5 shrink-0" />
}

export function EpicMark() {
  return <Boxes aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
}

export function ProjectMark() {
  return <BookMarked aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
}
