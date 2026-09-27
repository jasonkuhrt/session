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
 * Every page of a board is under this route, which decodes the key once and
 * encodes it into every address a link or a key builds; an address whose key
 * is no worktree's name is no board's.
 */
const BoardParams = Schema.Struct({ key: WorktreeName })

export const Route = createFileRoute('/w/$key')({
  params: { parse: paramsOf(BoardParams), stringify: Schema.encodeSync(BoardParams) },
  // A board is one the daemon serves, and its description, which every page
  // reads anyway, names their keys; a key it does not name, even when asked
  // again now, is no board's: an unknown name, or a tracked key with a
  // remainder that is no page, which the rewrite reads as one longer key,
  // `/w/proj/nowhere/at/all`. Asking again is what lets a board taken on after
  // the document loaded open from the index without a document load.
  beforeLoad: ({ context, params }) =>
    noPageUnless({
      client: context.queryClient,
      read: reads.daemon(),
      again: reads.daemonNow(),
      named: (daemon) => daemon.boards.includes(encodeWorktreeKey(params.key)),
    }),
})
