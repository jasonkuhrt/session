import { createFileRoute } from '@tanstack/react-router'

import { UnionBoard } from '../../../union-board'

/** A project's board, at `/p/<path>/`: the lanes of every worktree of its repository, or of the one folder outside Git it is. */
export const Route = createFileRoute('/p/$key/')({ component: ProjectBoard })

function ProjectBoard() {
  const { key } = Route.useParams()
  return <UnionBoard filter={{ kind: 'project', path: key }} />
}
