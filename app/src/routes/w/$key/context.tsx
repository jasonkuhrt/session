import { createFileRoute } from '@tanstack/react-router'

import { ContextPage } from '../../../context-page'

/** The session's `context/`, as a tree. */
export const Route = createFileRoute('/w/$key/context')({ component: ContextPage })
