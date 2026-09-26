import { createFileRoute } from '@tanstack/react-router'

import { WorktreeIndex } from '../worktree-index'

/** The index of every tracked worktree, at the root. */
export const Route = createFileRoute('/')({ component: WorktreeIndex })
