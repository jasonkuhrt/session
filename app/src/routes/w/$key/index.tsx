import { createFileRoute } from '@tanstack/react-router'

import App from '../../../App'

/** A worktree's board, at `/w/<key>/`. */
export const Route = createFileRoute('/w/$key/')({ component: App })
