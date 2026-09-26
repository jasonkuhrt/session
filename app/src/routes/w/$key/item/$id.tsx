import { createFileRoute } from '@tanstack/react-router'
import { Schema } from 'effect'

import { ItemPage } from '../../../../item-page'

/** An item's page carries the item's id, decoded by a schema as the board's key is. */
const ItemParams = Schema.Struct({ id: Schema.NonEmptyString })

export const Route = createFileRoute('/w/$key/item/$id')({
  params: { parse: Schema.decodeUnknownSync(ItemParams) },
  component: Item,
})

function Item() {
  const { id } = Route.useParams()
  return <ItemPage id={id} />
}
