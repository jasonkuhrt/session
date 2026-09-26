import { createFileRoute } from '@tanstack/react-router'
import { Schema } from 'effect'

import { paramsOf } from '../../../lib/base'

/**
 * A worktree's name as a board's address carries it: one segment or more,
 * none of them empty, since each is a folder's name. The router's rewrite
 * folds the key into one segment and the router decodes it to this name.
 */
const WorktreeName = Schema.String.check(Schema.isPattern(/^[^/]+(?:\/[^/]+)*$/u))

/**
 * Every page of a board is under this route, which decodes the key once; an
 * address whose key is no worktree's name is no board's.
 */
const BoardParams = Schema.Struct({ key: WorktreeName })

export const Route = createFileRoute('/w/$key')({
  params: { parse: paramsOf(BoardParams) },
})
