import { createFileRoute } from '@tanstack/react-router'

import { UnionLedgerPage } from '../../../ledger-page'

/** The ledger of every worktree in an epic, merged. */
export const Route = createFileRoute('/e/$name/ledger')({ component: EpicLedger })

function EpicLedger() {
  const { name } = Route.useParams()
  return <UnionLedgerPage filter={{ kind: 'epic', name }} />
}
