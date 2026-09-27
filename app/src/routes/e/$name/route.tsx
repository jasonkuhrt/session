import { createFileRoute } from '@tanstack/react-router'
import { Schema } from 'effect'

import { noPageUnless, paramsOf } from '../../../lib/base'
import { hasMembers } from '../../../lib/filter'
import { reads } from '../../../lib/reads'

/**
 * Every page of an epic's board is under this route, which decodes the name
 * once, as the router decodes the segment, and encodes it into every address
 * a link or a key builds: some name. Whether an epic goes by it is the rows'
 * to say, and the board draws the not-found page when none does, so the
 * engine's rule for a name is not restated here.
 */
const EpicParams = Schema.Struct({ name: Schema.NonEmptyString })

export const Route = createFileRoute('/e/$name')({
  params: { parse: paramsOf(EpicParams), stringify: Schema.encodeSync(EpicParams) },
  // An epic is the linked worktrees whose sessions name it, as the rows the
  // board draws from say; a name no tracked worktree's session names, even
  // when the rows are asked for again now, is no epic's, and its address
  // draws the not-found page before the page mounts. Asking again is what lets
  // an epic the index made a moment ago open from it without a document load.
  beforeLoad: ({ context, params }) =>
    noPageUnless({
      client: context.queryClient,
      read: reads.worktrees(),
      again: reads.worktreesNow(),
      named: (rows) => hasMembers({ filter: { kind: 'epic', name: params.name }, rows }),
    }),
})
