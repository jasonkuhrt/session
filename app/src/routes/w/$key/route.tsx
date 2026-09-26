import { createFileRoute } from '@tanstack/react-router'
import { Schema } from 'effect'

/**
 * A board's address carries its worktree's name as its key, which the
 * router's rewrite folds into one segment and the router decodes; the URL is
 * a boundary, so the name is decoded by a schema. Every page of the board is
 * under this route.
 */
const BoardParams = Schema.Struct({ key: Schema.NonEmptyString })

export const Route = createFileRoute('/w/$key')({
  params: { parse: Schema.decodeUnknownSync(BoardParams) },
})
