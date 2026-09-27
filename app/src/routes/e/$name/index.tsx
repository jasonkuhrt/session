import { createFileRoute } from '@tanstack/react-router'

import { UnionBoard } from '../../../union-board'

/** An epic's board, at `/e/<name>/`: the lanes of every worktree whose session names the epic. */
export const Route = createFileRoute('/e/$name/')({ component: EpicBoard })

function EpicBoard() {
  const { name } = Route.useParams()
  return <UnionBoard filter={{ kind: 'epic', name }} />
}
