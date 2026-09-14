import { Data, Effect, Result, Schema } from 'effect'
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient'
import * as HttpClient from 'effect/unstable/http/HttpClient'
import * as HttpClientRequest from 'effect/unstable/http/HttpClientRequest'

import { AgentsSummarySchema, SessionSchema, WorktreeSummarySchema } from '../../contract'
import { basePath } from './base'

export class ApiError extends Data.TaggedError('ApiError')<{
  readonly status: number
  readonly message: string
}> {}

function errorMessage(payload: unknown) {
  return typeof payload === 'object' && payload !== null && 'error' in payload && typeof payload.error === 'string'
    ? payload.error
    : 'The request failed'
}

const decodeSession = Schema.decodeUnknownEffect(SessionSchema)
const decodeWorktrees = Schema.decodeUnknownEffect(Schema.Array(WorktreeSummarySchema))
const decodeAgents = Schema.decodeUnknownEffect(AgentsSummarySchema)

/**
 * `FocusResult` is the one contract shape with no Schema beside it, because it
 * is the only reply that is not data: the daemon answers whether the window
 * manager did the thing, and a refusal carries the reason it gave.
 */
const decodeFocus = Schema.decodeUnknownEffect(Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true) }),
  Schema.Struct({ ok: Schema.Literal(false), reason: Schema.String }),
]))

const send = <A, E>(
  request: HttpClientRequest.HttpClientRequest,
  decode: (payload: unknown) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    const response = yield* HttpClient.execute(request)
    const payload = yield* response.json

    if (response.status < 200 || response.status >= 300) {
      return yield* new ApiError({ status: response.status, message: errorMessage(payload) })
    }

    return yield* decode(payload)
  })

/** For a route whose success body is not part of the contract. */
const sendStatus = (request: HttpClientRequest.HttpClientRequest) =>
  Effect.gen(function* () {
    const response = yield* HttpClient.execute(request)
    if (response.status >= 200 && response.status < 300) return
    return yield* new ApiError({ status: response.status, message: errorMessage(yield* response.json) })
  })

async function run<A, E>(program: Effect.Effect<A, E, HttpClient.HttpClient>, signal?: AbortSignal) {
  const result = await Effect.runPromise(
    program.pipe(Effect.provide(FetchHttpClient.layer), Effect.result),
    { signal },
  )
  if (Result.isFailure(result)) throw result.failure
  return result.success
}

/**
 * The stream this page listens to: a board's under its own prefix, the index's
 * at the root. Both carry the events their surface refetches on, so where the
 * bundle is served decides which one it subscribes to.
 */
export const eventsUrl = `${basePath}/api/events`

export const SessionApi = {
  read: (signal?: AbortSignal) => run(send(HttpClientRequest.get(`${basePath}/api/session`), decodeSession), signal),

  /** The agents overlay for this board's worktree, recomputed by the daemon. */
  agents: (signal?: AbortSignal) =>
    run(send(HttpClientRequest.get(`${basePath}/api/agents`), decodeAgents), signal),

  /** Asks the daemon to bring this session's terminal forward. */
  focus: (pid: number) =>
    run(send(
      HttpClientRequest.post(`${basePath}/api/agents/focus`).pipe(HttpClientRequest.bodyJsonUnsafe({ pid })),
      decodeFocus,
    )),

  mutate: (
    path: '/api/move' | '/api/batch' | '/api/start' | '/api/complete',
    body: Record<string, unknown>,
  ) =>
    run(send(
      HttpClientRequest.post(`${basePath}${path}`).pipe(HttpClientRequest.bodyJsonUnsafe(body)),
      decodeSession,
    )),
}

/** The index is only ever served at the root, so these need no prefix. */
export const IndexApi = {
  read: (signal?: AbortSignal) => run(send(HttpClientRequest.get('/api/worktrees'), decodeWorktrees), signal),

  refresh: () => HttpClientRequest.post('/api/worktrees/refresh').pipe(sendStatus, run),
}
