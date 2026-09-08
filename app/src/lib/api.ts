import { Data, Effect, Result, Schema } from 'effect'
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient'
import * as HttpClient from 'effect/unstable/http/HttpClient'
import * as HttpClientRequest from 'effect/unstable/http/HttpClientRequest'

import { SessionSchema, type Session, type Stage } from '../../contract'

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

const execute = (request: HttpClientRequest.HttpClientRequest) =>
  Effect.gen(function* () {
    const response = yield* HttpClient.execute(request)
    const payload = yield* response.json

    if (response.status < 200 || response.status >= 300) {
      return yield* new ApiError({ status: response.status, message: errorMessage(payload) })
    }

    return yield* decodeSession(payload)
  })

async function run<E>(program: Effect.Effect<Session, E, HttpClient.HttpClient>, signal?: AbortSignal) {
  const result = await Effect.runPromise(
    program.pipe(Effect.provide(FetchHttpClient.layer), Effect.result),
    { signal },
  )
  if (Result.isFailure(result)) throw result.failure
  return result.success
}

export const SessionApi = {
  read: (signal?: AbortSignal) => run(execute(HttpClientRequest.get('/api/session')), signal),

  mutate: (path: '/api/item' | '/api/move' | '/api/batch' | '/api/complete', body: Record<string, unknown>) =>
    HttpClientRequest.post(path).pipe(HttpClientRequest.bodyJsonUnsafe(body), execute, run),

  saveFile: (body: { stage: Stage; markdown: string; revision: string }) =>
    HttpClientRequest.put('/api/file').pipe(HttpClientRequest.bodyJsonUnsafe(body), execute, run),
}
