import { createFileRoute } from '@tanstack/react-router'
import { Schema } from 'effect'

import { paramsOf } from '../../../lib/base'

/**
 * Every page of an epic's board is under this route, which decodes the name
 * once, as the router decodes the segment: some name. Whether an epic goes by
 * it is the rows' to say, and the board draws the not-found page when none
 * does, so the engine's rule for a name is not restated here.
 */
const EpicParams = Schema.Struct({ name: Schema.NonEmptyString })

export const Route = createFileRoute('/e/$name')({
  params: { parse: paramsOf(EpicParams) },
})
