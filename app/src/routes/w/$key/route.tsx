import { createFileRoute } from '@tanstack/react-router'
import { Schema } from 'effect'

import { encodeWorktreeKey } from '../../../../contract'
import { noPageUnless, paramsOf } from '../../../lib/base'
import { reads } from '../../../lib/reads'

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
  // A board is one the daemon serves, and its description, which every page
  // reads anyway, names their keys; a key it does not name is no board's: an
  // unknown name, or a tracked key with a remainder that is no page, which the
  // rewrite reads as one longer key, `/w/proj/nowhere/at/all`.
  beforeLoad: ({ context, params }) =>
    noPageUnless({
      client: context.queryClient,
      read: reads.daemon(),
      named: (daemon) => daemon.boards.includes(encodeWorktreeKey(params.key)),
    }),
})
