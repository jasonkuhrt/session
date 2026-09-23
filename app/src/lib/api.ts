import { Data, Effect, Result, Schema } from 'effect'
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient'
import * as HttpClient from 'effect/unstable/http/HttpClient'
import * as HttpClientRequest from 'effect/unstable/http/HttpClientRequest'

import type { StreamEvent } from '../../contract'
import {
  AgentsSummarySchema,
  DaemonCapabilitiesSchema,
  FocusResultSchema,
  LinksSchema,
  SessionSchema,
  TerminalResultSchema,
  TrailerProblemSchema,
  WorktreeSummarySchema,
} from '../../contract'
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
const decodeTrailers = Schema.decodeUnknownEffect(Schema.Array(TrailerProblemSchema))
const decodeLinks = Schema.decodeUnknownEffect(LinksSchema)
const decodeCapabilities = Schema.decodeUnknownEffect(DaemonCapabilitiesSchema)
const decodeFocus = Schema.decodeUnknownEffect(FocusResultSchema)
const decodeTerminal = Schema.decodeUnknownEffect(TerminalResultSchema)

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
 * at the root, so where the bundle is served decides which one it opens. It
 * carries only the events the page names, because the daemon re-reads some
 * sources only while a page is listening for them.
 */
export const eventsUrl = (events: ReadonlyArray<StreamEvent>) => `${basePath}/api/events?events=${events.join(',')}`

export const SessionApi = {
  read: (signal?: AbortSignal) => run(send(HttpClientRequest.get(`${basePath}/api/session`), decodeSession), signal),

  /** The agents overlay for this board's worktree, recomputed by the daemon. */
  agents: (signal?: AbortSignal) =>
    run(send(HttpClientRequest.get(`${basePath}/api/agents`), decodeAgents), signal),

  /** The `Session-Done` trailers on this worktree's unpushed commits that could not be acted on. */
  trailers: (signal?: AbortSignal) =>
    run(send(HttpClientRequest.get(`${basePath}/api/trailers`), decodeTrailers), signal),

  /** Where this worktree's work lives outside its files: its pull request, as gh last reported it. */
  links: (signal?: AbortSignal) =>
    run(send(HttpClientRequest.get(`${basePath}/api/links`), decodeLinks), signal),

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

/**
 * The registry of tracked worktrees, which lives at the root whichever page is
 * asking: the index reads it as its own contents, and a board reads it for the
 * other boards it can switch to. Absolute on purpose, never under `basePath`.
 */
export const IndexApi = {
  read: (signal?: AbortSignal) => run(send(HttpClientRequest.get('/api/worktrees'), decodeWorktrees), signal),

  /** The same ask a board makes, for a session in any worktree the index lists. */
  focus: (pid: number) =>
    run(send(
      HttpClientRequest.post('/api/agents/focus').pipe(HttpClientRequest.bodyJsonUnsafe({ pid })),
      decodeFocus,
    )),
}

/**
 * What the daemon itself answers, at the root whichever page is asking: what
 * it can do for a page, and a terminal in any worktree it tracks.
 */
export const DaemonApi = {
  capabilities: (signal?: AbortSignal) =>
    run(send(HttpClientRequest.get('/api/daemon'), decodeCapabilities), signal),

  /** Asks for a terminal in the worktree at this path: its cmux workspace brought forward, or a new one. */
  terminal: (path: string) =>
    run(send(
      HttpClientRequest.post('/api/terminal').pipe(HttpClientRequest.bodyJsonUnsafe({ path })),
      decodeTerminal,
    )),
}
