import { createFileRoute } from '@tanstack/react-router'
import { Schema } from 'effect'

import { noPageUnless, paramsOf } from '../../../lib/base'
import { hasMembers } from '../../../lib/filter'
import { reads } from '../../../lib/reads'

/**
 * Every page of an epic's board is under this route, which decodes the name
 * once, as the router decodes the segment: some name. Whether an epic goes by
 * it is the rows' to say, and the board draws the not-found page when none
 * does, so the engine's rule for a name is not restated here.
 */
const EpicParams = Schema.Struct({ name: Schema.NonEmptyString })

export const Route = createFileRoute('/e/$name')({
  params: { parse: paramsOf(EpicParams) },
  // An epic is the linked worktrees whose sessions name it, as the rows the
  // board draws from say; a name no tracked worktree's session names is no
  // epic's, and its address draws the not-found page before the page mounts.
  beforeLoad: ({ context, params }) =>
    noPageUnless({
      client: context.queryClient,
      read: reads.worktrees(),
      named: (rows) => hasMembers({ filter: { kind: 'epic', name: params.name }, rows }),
    }),
})
