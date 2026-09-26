import { createFileRoute } from '@tanstack/react-router'

import { ArchivePage } from '../../../archive-page'

/** The session's archive. */
export const Route = createFileRoute('/w/$key/archive')({ component: ArchivePage })
