import { createFileRoute } from '@tanstack/react-router'

import { WorktreeBoard } from '../../../worktree-board'

/** A worktree's board, at `/w/<key>/`. */
export const Route = createFileRoute('/w/$key/')({ component: WorktreeBoard })
