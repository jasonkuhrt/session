import { Effect, Result, Schema } from 'effect'
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient'
import * as HttpClient from 'effect/unstable/http/HttpClient'
import * as HttpClientRequest from 'effect/unstable/http/HttpClientRequest'

import { SessionSchema, type Session, type Stage } from '../../contract'

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

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
      return yield* Effect.fail(new ApiError(response.status, errorMessage(payload)))
    }

    return yield* decodeSession(payload)
  })

async function run(program: Effect.Effect<Session, unknown, HttpClient.HttpClient>) {
  const result = await Effect.runPromise(
    program.pipe(Effect.provide(FetchHttpClient.layer), Effect.result),
  )
  if (Result.isFailure(result)) throw result.failure
  return result.success
}

export const SessionApi = {
  read: () => run(execute(HttpClientRequest.get('/api/session'))),

  mutate: (path: '/api/item' | '/api/move' | '/api/batch' | '/api/complete', body: Record<string, unknown>) =>
    run(execute(HttpClientRequest.post(path).pipe(HttpClientRequest.bodyJsonUnsafe(body)))),

  updateItem: (body: { id: string; title: string; body: string; revision: string }) =>
    run(execute(HttpClientRequest.put('/api/item').pipe(HttpClientRequest.bodyJsonUnsafe(body)))),

  saveFile: (body: { stage: Stage; markdown: string; revision: string }) =>
    run(execute(HttpClientRequest.put('/api/file').pipe(HttpClientRequest.bodyJsonUnsafe(body)))),
}
