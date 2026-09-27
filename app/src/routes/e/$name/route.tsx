import { createFileRoute } from '@tanstack/react-router'
import { Schema } from 'effect'

import { paramsOf } from '../../../lib/base'

/**
 * An epic's name as its board's address carries it, by the rule every epic's
 * name keeps, since it is one line of a file: not empty, no space at either
 * end, and no slash. The router decodes the segment to the name.
 */
const EpicName = Schema.String.check(Schema.isPattern(/^[^\s/](?:[^/]*[^\s/])?$/u))

/**
 * Every page of an epic's board is under this route, which decodes the name
 * once; an address whose name no epic could have is no epic's.
 */
const EpicParams = Schema.Struct({ name: EpicName })

export const Route = createFileRoute('/e/$name')({
  params: { parse: paramsOf(EpicParams) },
})
