import { createFileRoute } from '@tanstack/react-router'
import { Schema } from 'effect'

import { FilePage } from '../../../../file-page'
import { paramsOf } from '../../../../lib/base'

/** A file's page carries the file's path under the session, every segment of it, decoded by a schema. */
const FileParams = Schema.Struct({ _splat: Schema.NonEmptyString })

export const Route = createFileRoute('/w/$key/file/$')({
  params: { parse: paramsOf(FileParams) },
  component: File,
})

function File() {
  const { _splat: path } = Route.useParams()
  return <FilePage path={path} />
}
