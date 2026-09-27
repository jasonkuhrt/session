import { createFileRoute } from '@tanstack/react-router'

import { UnionLedgerPage } from '../../../ledger-page'

/** The ledger of every worktree of a project, merged. */
export const Route = createFileRoute('/p/$key/ledger')({ component: ProjectLedger })

function ProjectLedger() {
  const { key } = Route.useParams()
  return <UnionLedgerPage filter={{ kind: 'project', path: key }} />
}
