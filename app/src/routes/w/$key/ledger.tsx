import { createFileRoute } from '@tanstack/react-router'

import { LedgerPage } from '../../../ledger-page'

/** The session's ledger. */
export const Route = createFileRoute('/w/$key/ledger')({ component: LedgerPage })
