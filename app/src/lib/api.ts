import { Data, Effect, Option, Result, Schema } from 'effect'
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient'
import * as HttpClient from 'effect/unstable/http/HttpClient'
import * as HttpClientRequest from 'effect/unstable/http/HttpClientRequest'

import type { EpicRename, EpicWrite, OrderWrite, StreamEvent } from '../../contract'
import {
  AgentsSummarySchema,
  ArchiveListingSchema,
  ContextListingSchema,
  DaemonCapabilitiesSchema,
  EpicRenamedSchema,
  EpicRenameSchema,
  EpicWriteSchema,
  FocusResultSchema,
  FocusSessionSchema,
  LedgerListingSchema,
  LinksSchema,
  OrderWriteSchema,
  PullRequestReportsSchema,
  RefusalSchema,
  SessionSchema,
  sessionWrites,
  OpenResultSchema,
  StreamEventNamesSchema,
  TrailerProblemSchema,
  WorktreeEpicSchema,
  WorktreePathSchema,
  WorktreeRankSchema,
  WorktreeSummarySchema,
} from '../../contract'
import { rawFileHref } from './base'

export class ApiError extends Data.TaggedError('ApiError')<{
  readonly status: number
  readonly message: string
}> {}

const decodeRefusal = Schema.decodeUnknownOption(RefusalSchema)
const decodeRefusalText = Schema.decodeUnknownOption(Schema.fromJsonString(RefusalSchema))

/** A refusal's sentence, as the daemon's answer carries it, decoded; the plainest true sentence when it carries none. */
const refusalOf = (refusal: Option.Option<{ readonly error: string }>) =>
  Option.match(refusal, { onNone: () => 'The request failed', onSome: ({ error }) => error })

const decodeSession = Schema.decodeUnknownEffect(SessionSchema)
const decodeWorktrees = Schema.decodeUnknownEffect(Schema.Array(WorktreeSummarySchema))
const decodeAgents = Schema.decodeUnknownEffect(AgentsSummarySchema)
const decodeTrailers = Schema.decodeUnknownEffect(Schema.Array(TrailerProblemSchema))
const decodeLinks = Schema.decodeUnknownEffect(LinksSchema)
const decodePullRequests = Schema.decodeUnknownEffect(PullRequestReportsSchema)
const decodeCapabilities = Schema.decodeUnknownEffect(DaemonCapabilitiesSchema)
const decodeFocus = Schema.decodeUnknownEffect(FocusResultSchema)
const decodeOpen = Schema.decodeUnknownEffect(OpenResultSchema)
const decodeLedger = Schema.decodeUnknownEffect(LedgerListingSchema)
const decodeContext = Schema.decodeUnknownEffect(ContextListingSchema)
const decodeArchive = Schema.decodeUnknownEffect(ArchiveListingSchema)
const decodeEpic = Schema.decodeUnknownEffect(WorktreeEpicSchema)
const decodeRank = Schema.decodeUnknownEffect(WorktreeRankSchema)
const decodeRenamed = Schema.decodeUnknownEffect(EpicRenamedSchema)

/** A read's request. */
const get = (url: string) => Effect.succeed(HttpClientRequest.get(url))

/**
 * A write's request: its body encoded, as it leaves, through the schema of
 * what its route takes, into the JSON text it is sent as. The caller's type
 * names the body, and the encode checks it against the route's schema.
 */
const post = <A, I>(url: string, schema: Schema.Codec<A, I>, body: unknown) =>
  Schema.encodeUnknownEffect(Schema.fromJsonString(schema))(body).pipe(
    Effect.map((json) => HttpClientRequest.post(url).pipe(HttpClientRequest.bodyText(json, 'application/json'))),
  )

/** One request, and its answer decoded through the schema of what the route answers; a refusal is its decoded sentence. */
const send = <A, E, F>(
  request: Effect.Effect<HttpClientRequest.HttpClientRequest, F>,
  decode: (payload: unknown) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    const response = yield* HttpClient.execute(yield* request)
    const payload = yield* response.json

    if (response.status < 200 || response.status >= 300) {
      return yield* new ApiError({ status: response.status, message: refusalOf(decodeRefusal(payload)) })
    }

    return yield* decode(payload)
  })

/**
 * A file as the files route serves it, read as text. A refusal is still the
 * daemon's JSON, so its decoded sentence is what the error carries.
 */
const sendText = (request: HttpClientRequest.HttpClientRequest) =>
  Effect.gen(function* () {
    const response = yield* HttpClient.execute(request)
    const text = yield* response.text

    if (response.status < 200 || response.status >= 300) {
      return yield* new ApiError({ status: response.status, message: refusalOf(decodeRefusalText(text)) })
    }

    return text
  })

async function run<A, E>(program: Effect.Effect<A, E, HttpClient.HttpClient>, signal?: AbortSignal) {
  const result = await Effect.runPromise(
    program.pipe(Effect.provide(FetchHttpClient.layer), Effect.result),
    { signal },
  )
  if (Result.isFailure(result)) throw result.failure
  return result.success
}

/** Every route that moves the records. The board and the item page share them. */
export type SessionMutation = keyof typeof sessionWrites

/** What a route that moves the records takes, less the revision, which every such write adds from the session it read. */
export type SessionWriteBody<P extends SessionMutation> = Omit<(typeof sessionWrites)[P]['Type'], 'revision'>

const encodeEventNames = Schema.encodeSync(StreamEventNamesSchema)

/**
 * The stream a page listens to: a board's under the board's prefix, the
 * index's at the root, whose prefix is empty. It carries only the events the
 * page names, because the daemon re-reads some sources only while a page is
 * listening for them, and the names go out encoded as the address carries them.
 */
export const eventsUrl = ({ board, events }: { readonly board: string; readonly events: ReadonlyArray<StreamEvent> }) =>
  `${board}/api/events?events=${encodeEventNames(events)}`

/** What a board answers, under the board's prefix, `/w/<key>`. */
export const SessionApi = {
  read: (board: string, signal?: AbortSignal) =>
    run(send(get(`${board}/api/session`), decodeSession), signal),

  /** The agents overlay for this board's worktree, recomputed by the daemon. */
  agents: (board: string, signal?: AbortSignal) =>
    run(send(get(`${board}/api/agents`), decodeAgents), signal),

  /** The `Session-Done` trailers on this worktree's unpushed commits that could not be acted on. */
  trailers: (board: string, signal?: AbortSignal) =>
    run(send(get(`${board}/api/trailers`), decodeTrailers), signal),

  /** Where this worktree's work lives outside its files: its pull request and the Linear issues it names, as gh and linear last reported them. */
  links: (board: string, signal?: AbortSignal) =>
    run(send(get(`${board}/api/links`), decodeLinks), signal),

  /** The session's ledger: its entries newest first, and a notice for each file left out. */
  ledger: (board: string, signal?: AbortSignal) =>
    run(send(get(`${board}/api/ledger`), decodeLedger), signal),

  /** Every file and directory under the session's `context/`, depth first. */
  context: (board: string, signal?: AbortSignal) =>
    run(send(get(`${board}/api/context`), decodeContext), signal),

  /** The session's archived records as their names give them, newest first. */
  archive: (board: string, signal?: AbortSignal) =>
    run(send(get(`${board}/api/archive`), decodeArchive), signal),

  /** One file of the session, by its path under the session, as the text on disk. */
  file: (board: string, path: string, signal?: AbortSignal) =>
    run(sendText(HttpClientRequest.get(rawFileHref({ board, path }))), signal),

  /** Asks the daemon to bring this session's terminal forward. */
  focus: (board: string, pid: number) =>
    run(send(post(`${board}/api/agents/focus`, FocusSessionSchema, { pid }), decodeFocus)),

  /** One write to the records, on the revision the page read, answered with the session as it left them. */
  mutate: <P extends SessionMutation>(board: string, path: P, body: SessionWriteBody<P>, revision: string) =>
    run(send(post(`${board}${path}`, sessionWrites[path], { ...body, revision }), decodeSession)),
}

/**
 * Where a page under a board stands: the worktree it belongs to and the
 * session root its paths hang off, as the session read gives them. That read
 * loads every item, so one broken item file stops it; the daemon's sentence
 * for it is kept instead of failing the page, because the ledger, `context/`,
 * the archive and a file are read without the items. A daemon that cannot be
 * reached still fails the read.
 */
export type Place =
  | { readonly kind: 'read'; readonly worktree: string | null; readonly directory: string }
  | { readonly kind: 'unread'; readonly problem: string }

/** Where this page stands, read from the session; a session the daemon answered for but could not load is a place with its reason. */
export async function readPlace({ board, signal }: {
  readonly board: string
  readonly signal?: AbortSignal | undefined
}): Promise<Place> {
  try {
    const session = await SessionApi.read(board, signal)
    return { kind: 'read', worktree: session.worktree?.name ?? null, directory: session.directory }
  } catch (error) {
    if (error instanceof ApiError) return { kind: 'unread', problem: error.message }
    throw error
  }
}

/** The worktree a page's place names, once the session has been read. */
export const worktreeOf = (place: Place | null) => (place?.kind === 'read' ? place.worktree : null)

/** Why a page's place could not be read, when it could not. */
export const problemOf = (place: Place | null) => (place?.kind === 'unread' ? place.problem : null)

/**
 * The registry of tracked worktrees, which lives at the root whichever page is
 * asking: the index reads it as its own contents, and a board reads it for the
 * other boards it can switch to. Absolute on purpose, never under a board.
 */
export const IndexApi = {
  read: (signal?: AbortSignal) => run(send(get('/api/worktrees'), decodeWorktrees), signal),

  /** gh's last report for each row's branch, by the worktree's path, as the daemon holds it. */
  pullRequests: (signal?: AbortSignal) =>
    run(send(get('/api/pull-requests'), decodePullRequests), signal),

  /** The same ask a board makes, for a session in any worktree the index lists. */
  focus: (pid: number) => run(send(post('/api/agents/focus', FocusSessionSchema, { pid }), decodeFocus)),

  /**
   * Puts a worktree in the epic of that name, or in none with null, by its
   * path, refused when its file no longer names the epic the index read.
   */
  setEpic: (write: EpicWrite) => run(send(post('/api/worktrees/epic', EpicWriteSchema, write), decodeEpic)),

  /**
   * Renames an epic: every worktree in it takes the new name, keeping its
   * rank, or, when another epic has the name, merging into it unranked, as
   * the daemon tells from the worktrees it tracks.
   */
  renameEpic: (write: EpicRename) => run(send(post('/api/worktrees/rename', EpicRenameSchema, write), decodeRenamed)),

  /**
   * Places a worktree before a ranked sibling, or after the unranked siblings
   * drawn above where it was dropped, or last among the ranked, by paths.
   */
  setOrder: (write: OrderWrite) => run(send(post('/api/worktrees/order', OrderWriteSchema, write), decodeRank)),
}

/**
 * What the daemon itself answers, at the root whichever page is asking: what
 * it can do for a page, and a terminal or Zed in any worktree it tracks.
 */
export const DaemonApi = {
  capabilities: (signal?: AbortSignal) =>
    run(send(get('/api/daemon'), decodeCapabilities), signal),

  /** Asks for a terminal in the worktree at this path: its cmux workspace brought forward, or a new one. */
  terminal: (path: string) => run(send(post('/api/terminal', WorktreePathSchema, { path }), decodeOpen)),

  /** Asks for Zed on the worktree at this path: the window open on it brought forward, or a new one. */
  zed: (path: string) => run(send(post('/api/zed', WorktreePathSchema, { path }), decodeOpen)),
}
