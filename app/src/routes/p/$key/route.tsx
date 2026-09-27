import { createFileRoute } from '@tanstack/react-router'
import { Schema, SchemaTransformation } from 'effect'

import { noPageUnless, paramsOf } from '../../../lib/base'
import { hasMembers } from '../../../lib/filter'
import { reads } from '../../../lib/reads'

/**
 * A project's path as its board's address carries it: the path's segments
 * after its leading slash, one or more and none of them empty, since each is a
 * folder's name, decoded to the absolute path the index heads the project's
 * section with. The router's rewrite folds the segments into one, and the
 * router decodes that to them.
 */
const ProjectPath = Schema.String.check(Schema.isPattern(/^[^/]+(?:\/[^/]+)*$/u)).pipe(
  Schema.decodeTo(
    Schema.String,
    SchemaTransformation.transform<string, string>({
      decode: (key) => `/${key}`,
      encode: (path) => path.slice(1),
    }),
  ),
)

/**
 * Every page of a project's board is under this route, which decodes the path
 * once and encodes it into every address a link or a key builds; an address
 * whose path no folder could have is no project's.
 */
const ProjectParams = Schema.Struct({ key: ProjectPath })

export const Route = createFileRoute('/p/$key')({
  params: { parse: paramsOf(ProjectParams), stringify: Schema.encodeSync(ProjectParams) },
  // A project is its repository's worktrees, or the one folder outside Git it
  // is, as the rows the board draws from say; a path no tracked worktree is
  // under, even when the rows are asked for again now, is no project's, and
  // its address draws the not-found page before the page mounts.
  beforeLoad: ({ context, params }) =>
    noPageUnless({
      client: context.queryClient,
      read: reads.worktrees(),
      again: reads.worktreesNow(),
      named: (rows) => hasMembers({ filter: { kind: 'project', path: params.key }, rows }),
    }),
})
