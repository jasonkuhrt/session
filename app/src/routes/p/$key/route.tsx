import { createFileRoute } from '@tanstack/react-router'
import { Schema, SchemaTransformation } from 'effect'

import { paramsOf } from '../../../lib/base'

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
 * once; an address whose path no folder could have is no project's.
 */
const ProjectParams = Schema.Struct({ key: ProjectPath })

export const Route = createFileRoute('/p/$key')({
  params: { parse: paramsOf(ProjectParams) },
})
