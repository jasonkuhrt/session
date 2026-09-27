import { extname, resolve } from 'node:path';
import { file } from 'bun';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';
import type { ChildProcessSpawner } from 'effect/unstable/process/ChildProcessSpawner';
import type {
  AgentsSummary,
  EpicRename,
  EpicRenamed,
  EpicWrite,
  FocusResult,
  Links,
  OpenResult,
  OrderWrite,
  Session,
  StreamEvent,
  TrailerProblem,
  WorktreeEpic,
  WorktreeRank,
} from '../contract.ts';
import {
  AddressPathSchema,
  AgentsSummarySchema,
  ArchiveListingSchema,
  CompleteItemSchema,
  ContextListingSchema,
  EpicRenamedSchema,
  EpicRenameSchema,
  EpicWriteSchema,
  FocusResultSchema,
  FocusSessionSchema,
  GroupItemsSchema,
  LedgerListingSchema,
  LinksSchema,
  MoveItemSchema,
  OpenResultSchema,
  OrderWriteSchema,
  QueueBatchSchema,
  RefusalSchema,
  SessionSchema,
  StartBatchSchema,
  StreamEventNamesSchema,
  StreamEventSchema,
  StreamPayloadSchema,
  TrailerProblemSchema,
  UngroupItemsSchema,
  WorktreeEpicSchema,
  WorktreePathSchema,
  WorktreeRankSchema,
} from '../contract.ts';
import type { SessionEvents } from './events.ts';
import { SessionError } from './model.ts';
import { RepositoryError, type SessionRepository } from './repository.ts';
import { checkoutOf, type WorktreeSession } from './worktree.ts';

/* eslint-disable max-lines -- The HTTP boundary: the board's route table and the handlers the root shares with it live together, so the two surfaces can never answer one request two ways. */

/**
 * What the files route says each file is: Markdown as Markdown, the image
 * types by extension, and everything else as plain text, which a browser shows
 * instead of running or downloading it.
 */
const fileTypes: ReadonlyMap<string, string> = new Map([
  ['.md', 'text/markdown; charset=utf-8'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.svg', 'image/svg+xml'],
]);

const fileTypeOf = (path: string): string => fileTypes.get(extname(path).toLowerCase()) ?? 'text/plain; charset=utf-8';

/**
 * How a route answers: through the schema of what it answers, each value
 * encoded as it leaves, so a page reads only a shape the contract names. It
 * goes out `no-store`, as every answer does.
 */
export const answer = <A, I>(schema: Schema.Codec<A, I>) => {
  const encode = Schema.encodeSync(schema);
  return (value: A, init?: ResponseInit) =>
    Response.json(encode(value), {
      ...init,
      headers: { 'cache-control': 'no-store', ...init?.headers },
    });
};

const answerRefusal = answer(RefusalSchema);

/** A refusal: the sentence that says why, as every route refuses, with its status. */
export const refuse = ({ error, status }: { readonly error: string; readonly status: number }) =>
  answerRefusal({ error }, { status });

const answerSession = answer(SessionSchema);
const answerAgents = answer(AgentsSummarySchema);
const answerTrailers = answer(Schema.Array(TrailerProblemSchema));
const answerLinks = answer(LinksSchema);
const answerLedger = answer(LedgerListingSchema);
const answerContext = answer(ContextListingSchema);
const answerArchive = answer(ArchiveListingSchema);
const answerFocus = answer(FocusResultSchema);
const answerOpen = answer(OpenResultSchema);
const answerEpic = answer(WorktreeEpicSchema);
const answerRenamed = answer(EpicRenamedSchema);
const answerRank = answer(WorktreeRankSchema);

/** A file's path under the session, as the files route's address carries it. */
const decodePath = Schema.decodeUnknownOption(AddressPathSchema);

/**
 * The shell the build prerendered, which is every page of the app: the index
 * and each page of a board are this one document, and its script draws the
 * page the address names. It goes out `no-store`, as every API answer does,
 * because it names the build's hashed assets, which the next build deletes.
 */
const shellResponse = async ({ shell, method }: {
  /** The shell's path on disk. */
  readonly shell: string;
  readonly method: string;
}): Promise<Response> => {
  const page = file(shell);
  if (!(await page.exists())) return refuse({ error: 'Not found.', status: 404 });
  return new Response(method === 'HEAD' ? null : page, {
    headers: { 'cache-control': 'no-store', 'content-type': 'text/html; charset=utf-8' },
  });
};

/**
 * The pages under an epic's board and a project's: an epic's name and a
 * folder's can carry a dot, so these are pages whatever their path holds.
 */
const unionPage = /^\/[ep]\//u;

/**
 * What the root serves outside its API: a file of the build, and the shell
 * for a path without a dot, which is one of the app's pages, and for any path
 * under an epic's board or a project's. An API the root does not have is an
 * error, never the app's page, as it is under a board, so the two answer an
 * unknown API path alike. Nothing outside the build is served.
 */
export const staticResponse = async ({ directory, shell, url, method }: {
  /** Where the build's files are, which is everything the root serves from disk. */
  readonly directory: string;
  /** The shell's path on disk. */
  readonly shell: string;
  readonly url: URL;
  readonly method: string;
}): Promise<Response> => {
  if (method !== 'GET' && method !== 'HEAD') return refuse({ error: 'Method not allowed.', status: 405 });
  if (url.pathname.startsWith('/api/')) return refuse({ error: 'Not found.', status: 404 });
  const requested = url.pathname.slice(1);
  if (!requested.includes('.') || unionPage.test(url.pathname)) return await shellResponse({ shell, method });
  const path = resolve(directory, requested);
  if (path !== directory && !path.startsWith(`${directory}/`)) return refuse({ error: 'Not found.', status: 404 });
  const candidate = file(path);
  if (!(await candidate.exists())) return refuse({ error: 'Not found.', status: 404 });
  return method === 'HEAD' ? new Response(null) : new Response(candidate);
};

/**
 * What an address under `/w/` that no tracked worktree's key begins is
 * answered with. With no key there is no telling where one would end, so the
 * path cannot say whether it is a page or a board's API, and a file page's path
 * can hold `api/` besides; the request says which instead. A browser loading a
 * page asks for HTML, and gets the shell, whose router draws the not-found
 * page; a board's reads, its stream and its writes never ask for HTML, and are
 * refused in JSON, which is what an open board reads once its worktree is gone.
 */
export const noBoardResponse = async ({ request, shell }: {
  readonly request: Request;
  /** The shell's path on disk. */
  readonly shell: string;
}): Promise<Response> => {
  const read = request.method === 'GET' || request.method === 'HEAD';
  if (read && (request.headers.get('accept') ?? '').includes('text/html')) {
    return await shellResponse({ shell, method: request.method });
  }
  return refuse({ error: 'No such worktree.', status: 404 });
};

const errorResponse = (error: unknown): Response => {
  if (error instanceof RepositoryError || error instanceof SessionError) {
    const status = error.kind === 'conflict' ? 409 : error.kind === 'not-found' ? 404 : 400;
    return refuse({ error: error.message, status });
  }
  return refuse({ error: error instanceof Error ? error.message : 'Unexpected server error.', status: 500 });
};

/** A request's body, read as JSON and decoded through the schema of what its route takes. */
const decodeBody = <A, I>(request: Request, schema: Schema.Codec<A, I>) =>
  Effect.tryPromise({
    try: () => request.json(),
    catch: (cause) =>
      new RepositoryError({ kind: 'validation', message: 'Request body must be JSON.', cause }),
  }).pipe(
    Effect.flatMap((input) => Schema.decodeUnknownEffect(schema)(input)),
    Effect.mapError((cause) =>
      cause instanceof RepositoryError
        ? cause
        : new RepositoryError({
            kind: 'validation',
            message: 'Request body is invalid.',
            cause,
          }),
    ),
  );

/**
 * A browser says where a write came from. Behind a local proxy such as
 * portless the scheme the browser used is not the one this server sees, so
 * trust the fetch metadata when a browser sends it and otherwise compare hosts.
 */
const writeIsSameOrigin = (request: Request): boolean => {
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite !== null) return fetchSite === 'same-origin' || fetchSite === 'none';
  const origin = request.headers.get('origin');
  if (origin === null) return true;
  return URL.canParse(origin) && new URL(origin).host === new URL(request.url).host;
};

/**
 * A write both the index and a board make: from the page's own origin, with a
 * body of one shape, answered as JSON. Both such routes go through here, so the
 * two surfaces can never send different bodies or read a refusal differently;
 * the daemon owns what stands behind each one.
 */
export const sharedWrite = async <A, I>({ request, schema, respond }: {
  readonly request: Request;
  /** What the route takes. */
  readonly schema: Schema.Codec<A, I>;
  /** The route's answer to the decoded body. */
  readonly respond: (input: A) => Promise<Response>;
}): Promise<Response> => {
  if (!writeIsSameOrigin(request)) return refuse({ error: 'Cross-origin writes are not allowed.', status: 403 });
  try {
    return await respond(await Effect.runPromise(decodeBody(request, schema)));
  } catch (error) {
    return errorResponse(error);
  }
};

/**
 * Focusing a session's terminal: under a board's own prefix, and at the root,
 * where the index has no board to scope it to.
 */
export const focusResponse = ({ request, focus }: {
  readonly request: Request;
  readonly focus: (pid: number) => Promise<FocusResult>;
}) => sharedWrite({ request, schema: FocusSessionSchema, respond: async (input) => answerFocus(await focus(input.pid)) });

/**
 * A worktree opened in a tool, cmux's terminal or Zed, at the root, for a
 * board's header and the index's rows alike. It is asked for by path, and a
 * path the daemon does not track is not somewhere it opens anything.
 */
export const openResponse = ({ request, open }: {
  readonly request: Request;
  /** The tool's answer for a tracked worktree's path; undefined for any other path. */
  readonly open: (path: string) => Promise<OpenResult | undefined>;
}) =>
  sharedWrite({
    request,
    schema: WorktreePathSchema,
    respond: async (input) => {
      const result = await open(input.path);
      return result === undefined
        ? refuse({ error: 'The daemon tracks no worktree at that path.', status: 404 })
        : answerOpen(result);
    },
  });

/**
 * A worktree's epic, at the root, for the index's drags: the worktree by its
 * path, the epic's name to put it in or null to take it out, and the epic the
 * index last read for it, answered with the epic it is in now. The daemon owns
 * which worktrees it tracks and the rule they join by.
 */
export const epicResponse = ({ request, write }: {
  readonly request: Request;
  readonly write: (input: EpicWrite) => Promise<WorktreeEpic>;
}) => sharedWrite({ request, schema: EpicWriteSchema, respond: async (input) => answerEpic(await write(input)) });

/**
 * An epic's new name, at the root, for the index's rename: the epic by its
 * name and the name it takes, answered with the name it has now and whether
 * it merged. The daemon owns which worktrees are in it, and so whether the
 * name was another epic's.
 */
export const renameResponse = ({ request, write }: {
  readonly request: Request;
  readonly write: (input: EpicRename) => Promise<EpicRenamed>;
}) => sharedWrite({ request, schema: EpicRenameSchema, respond: async (input) => answerRenamed(await write(input)) });

/**
 * A worktree's place among its siblings, at the root, for the index's drags:
 * the worktree by its path, as the epic route takes it, and the sibling it
 * goes before, or null for last among the ranked ones, answered with the rank
 * it holds now. The daemon owns which worktrees it tracks, and so which are
 * siblings.
 */
export const orderResponse = ({ request, write }: {
  readonly request: Request;
  readonly write: (input: OrderWrite) => Promise<WorktreeRank>;
}) => sharedWrite({ request, schema: OrderWriteSchema, respond: async (input) => answerRank(await write(input)) });

/** Bun closes a connection that has been idle for `idleTimeout`, ten seconds
 *  by default, so a quiet session must still say something. */
const keepAliveMilliseconds = 5_000;

/** One named event on a stream, and the source that fires it. */
export type EventChannel = {
  readonly name: StreamEvent;
  readonly events: SessionEvents | undefined;
};

/** The events a page named, as its stream carries them: the channels it has, and the names it has no event for. */
export type NamedChannels = {
  readonly channels: ReadonlyArray<EventChannel>;
  readonly unknown: ReadonlyArray<string>;
};

const decodeEventNames = Schema.decodeUnknownOption(StreamEventNamesSchema);
const decodeEvent = Schema.decodeUnknownOption(StreamEventSchema);
const encodeEvent = Schema.encodeSync(StreamEventSchema);

/** Every event's line of data: the empty payload, encoded as it leaves. */
const payload = Schema.encodeSync(Schema.fromJsonString(StreamPayloadSchema))({});

/**
 * The channels a page asked for in `?events=`, decoded, and no others: a
 * stream that names none carries none. A page names what it reads, so a
 * source the daemon re-reads only for a listening page is not kept busy by a
 * page that ignores it. A name the daemon has no event for is carried by
 * nothing, and kept so the stream can say so.
 */
export const namedChannels = ({ url, channels }: {
  readonly url: URL;
  readonly channels: ReadonlyArray<EventChannel>;
}): NamedChannels => {
  const wanted = new Set<StreamEvent>();
  const unknown: string[] = [];
  for (const name of Option.getOrElse(decodeEventNames(url.searchParams.get('events') ?? ''), () => [])) {
    const event = decodeEvent(name);
    if (Option.isSome(event)) wanted.add(event.value);
    else if (name !== '') unknown.push(name);
  }
  return { channels: channels.filter((channel) => wanted.has(channel.name)), unknown };
};

/**
 * One server-sent event per notification from the daemon's watchers, which own
 * the debounce. Each channel names the event it writes, so one stream carries
 * everything a page listens for and the page decides what to refetch. A surface
 * served without any source keeps a silent stream rather than a 404, so the
 * client connects once instead of retrying forever. A name the page gave that
 * the daemon has no event for is said once, in a comment line, which a page
 * never reads as an event.
 */
export const eventStream = ({ channels, unknown }: NamedChannels): Response => {
  const encoder = new TextEncoder();
  let unsubscribes: Array<() => void> = [];
  let keepAlive: ReturnType<typeof setInterval> | undefined;

  const stop = () => {
    for (const unsubscribe of unsubscribes) unsubscribe();
    unsubscribes = [];
    if (keepAlive !== undefined) clearInterval(keepAlive);
    keepAlive = undefined;
  };

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (frame: string) => {
        try {
          controller.enqueue(encoder.encode(frame));
        } catch {
          stop();
        }
      };
      write(': open\n\n');
      if (unknown.length > 0) write(`: this stream carries no event named ${unknown.join(' or ')}\n\n`);
      for (const channel of channels) {
        const frame = `event: ${encodeEvent(channel.name)}\ndata: ${payload}\n\n`;
        const unsubscribe = channel.events?.subscribe(() => write(frame));
        if (unsubscribe !== undefined) unsubscribes.push(unsubscribe);
      }
      keepAlive = setInterval(() => write(': keep-alive\n\n'), keepAliveMilliseconds);
    },
    cancel: stop,
  });

  return new Response(body, {
    headers: {
      'cache-control': 'no-store',
      'content-type': 'text/event-stream; charset=utf-8',
      connection: 'keep-alive',
    },
  });
};

/* eslint-disable max-lines-per-function -- The HTTP boundary is a small linear route table; splitting each route would add indirection without isolating behavior. */
/**
 * One worktree's board. Built as an effect so it runs every request on the
 * services it was built with: the daemon's one set, and not a set built per
 * request. The repository is the worktree's own, the same instance the daemon
 * closes items through, so both queue on one lock.
 */
export const makeRequestHandler = (options: {
  readonly repository: SessionRepository;
  /** The shell the build prerendered, which every page of the board is. */
  readonly shell: string;
  /** The worktree the board belongs to, as the daemon resolved it when it began tracking it. */
  readonly session: WorktreeSession;
  /** Pushed on every write under the worktree's `.session`. */
  readonly events: SessionEvents;
  /**
   * The agents overlay for this worktree. The daemon owns the listing, its
   * cache and the window manager; the board's routes only hand them on.
   */
  readonly agents: {
    readonly read: () => Promise<AgentsSummary>;
    readonly focus: (pid: number) => Promise<FocusResult>;
    readonly events: SessionEvents;
  };
  /**
   * The `Session-Done` trailers on this worktree's unpushed commits that could
   * not be acted on, and the stream that says when that answer changed. The
   * daemon reconciles them; the board only reads them.
   */
  readonly trailers: {
    readonly read: () => ReadonlyArray<TrailerProblem>;
    readonly events: SessionEvents;
  };
  /**
   * Where this worktree's work lives outside its files, and the stream that
   * says a source was asked again. The daemon asks the sources and keeps their
   * last answers; the board only reads them.
   */
  readonly links: {
    readonly read: () => Promise<Links>;
    readonly events: SessionEvents;
  };
}) =>
  Effect.gen(function*() {
    const run = Effect.runPromiseWith(yield* Effect.context<ChildProcessSpawner>());
    const { repository } = options;
    // The name and path are fixed while the worktree is tracked; what it has
    // checked out is read again with every session read.
    const attachWorktree = async (session: Session): Promise<Session> => {
      const { name, path } = options.session.worktree;
      return { ...session, worktree: { name, path, ...(await run(checkoutOf(options.session))) } };
    };

    return async (request: Request): Promise<Response> => {
      try {
        const url = new URL(request.url);
        const mutation = request.method === 'PUT' || request.method === 'POST';
        if (mutation && !writeIsSameOrigin(request)) return refuse({ error: 'Cross-origin writes are not allowed.', status: 403 });

        if (request.method === 'GET' && url.pathname === '/api/session') {
          return answerSession(await attachWorktree(await run(repository.load)));
        }

        if (request.method === 'GET' && url.pathname === '/api/agents') {
          return answerAgents(await options.agents.read());
        }

        if (request.method === 'GET' && url.pathname === '/api/trailers') {
          return answerTrailers(options.trailers.read());
        }

        if (request.method === 'GET' && url.pathname === '/api/links') {
          return answerLinks(await options.links.read());
        }

        if (request.method === 'GET' && url.pathname === '/api/events') {
          return eventStream(namedChannels({
            url,
            channels: [
              { name: 'changed', events: options.events },
              { name: 'agents', events: options.agents.events },
              { name: 'trailers', events: options.trailers.events },
              { name: 'links', events: options.links.events },
            ],
          }));
        }

        if (request.method === 'GET' && url.pathname === '/api/ledger') {
          return answerLedger(await run(repository.ledgerListing));
        }

        if (request.method === 'GET' && url.pathname === '/api/context') {
          return answerContext(await run(repository.contextListing));
        }

        if (request.method === 'GET' && url.pathname === '/api/archive') {
          return answerArchive(await run(repository.archiveListing));
        }

        if (request.method === 'GET' && url.pathname.startsWith('/files/')) {
          // The file's path under the session, as the address carries it; one that does not decode is no file's.
          const decoded = decodePath(url.pathname.slice('/files/'.length));
          if (Option.isNone(decoded)) return refuse({ error: 'Not found.', status: 404 });
          const relativePath = decoded.value;
          return new Response(file(await run(repository.servedFile(relativePath))), {
            headers: {
              'cache-control': 'no-store',
              'content-type': fileTypeOf(relativePath),
              // The session's files are data, served from the board's own
              // origin: nothing among them runs there, and none is sniffed
              // into a type that would.
              'content-security-policy': 'sandbox',
              'x-content-type-options': 'nosniff',
            },
          });
        }

        if (request.method === 'POST' && url.pathname === '/api/move') {
          const input = await run(decodeBody(request, MoveItemSchema));
          return answerSession(await attachWorktree(await run(repository.moveItem(input))));
        }
        if (request.method === 'POST' && url.pathname === '/api/group') {
          const input = await run(decodeBody(request, GroupItemsSchema));
          return answerSession(await attachWorktree(await run(repository.groupItems(input))));
        }
        if (request.method === 'POST' && url.pathname === '/api/ungroup') {
          const input = await run(decodeBody(request, UngroupItemsSchema));
          return answerSession(await attachWorktree(await run(repository.ungroupItems(input))));
        }
        if (request.method === 'POST' && url.pathname === '/api/batch') {
          const input = await run(decodeBody(request, QueueBatchSchema));
          return answerSession(await attachWorktree(await run(repository.queueBatch(input))));
        }
        if (request.method === 'POST' && url.pathname === '/api/start') {
          const input = await run(decodeBody(request, StartBatchSchema));
          return answerSession(await attachWorktree(await run(repository.startBatch(input))));
        }
        if (request.method === 'POST' && url.pathname === '/api/agents/focus') {
          return await focusResponse({ request, focus: options.agents.focus });
        }
        if (request.method === 'POST' && url.pathname === '/api/complete') {
          const input = await run(decodeBody(request, CompleteItemSchema));
          return answerSession(await attachWorktree(await run(repository.completeItem(input))));
        }

        if (request.method !== 'GET' && request.method !== 'HEAD') return refuse({ error: 'Method not allowed.', status: 405 });

        // An API a board does not have is an error, never the app's page.
        if (url.pathname.startsWith('/api/')) return refuse({ error: 'Not found.', status: 404 });

        // Every other path is one of the board's pages, whatever it holds: an
        // item id or a file's path can carry a dot, and gets the page all the
        // same. The page's assets are absolute, under the root's `/assets/`,
        // so nothing is served from under a board but its API and its files.
        return await shellResponse({ shell: options.shell, method: request.method });
      } catch (error) {
        return errorResponse(error);
      }
    };
  });
/* eslint-enable max-lines-per-function */
