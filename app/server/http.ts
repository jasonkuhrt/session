import { basename, join, resolve } from 'node:path';
import { file } from 'bun';
import * as Effect from 'effect/Effect';
import * as Schema from 'effect/Schema';
import type { ChildProcessSpawner } from 'effect/unstable/process/ChildProcessSpawner';
import { stageNames } from '../contract.ts';
import type { AgentsSummary, FocusResult, Links, Session, StreamEvent, TerminalResult, TrailerProblem } from '../contract.ts';
import type { SessionEvents } from './events.ts';
import { SessionError } from './model.ts';
import { RepositoryError, type SessionRepository } from './repository.ts';
import { refreshWorktreeMetadata, type WorktreeMetadata } from './worktree.ts';

/* eslint-disable max-lines -- The HTTP boundary: the board's route table and the handlers the root shares with it live together, so the two surfaces can never answer one request two ways. */

const Stage = Schema.Literals(stageNames);
const MoveItem = Schema.Struct({
  id: Schema.String,
  to: Stage,
  beforeId: Schema.NullOr(Schema.String).pipe(Schema.optionalKey),
  revision: Schema.String,
});
const QueueBatch = Schema.Struct({
  ids: Schema.Array(Schema.String),
  name: Schema.String,
  revision: Schema.String,
});
const StartBatch = Schema.Struct({
  revision: Schema.String,
});
const CompleteItem = Schema.Struct({
  id: Schema.String,
  revision: Schema.String,
});
const FocusSession = Schema.Struct({
  pid: Schema.Int,
});
const OpenTerminal = Schema.Struct({
  path: Schema.String,
});

const json = (value: unknown, init?: ResponseInit) =>
  Response.json(value, {
    ...init,
    headers: { 'cache-control': 'no-store', ...init?.headers },
  });

const errorResponse = (error: unknown): Response => {
  if (error instanceof RepositoryError || error instanceof SessionError) {
    const status = error.kind === 'conflict' ? 409 : error.kind === 'not-found' ? 404 : 400;
    return json({ error: error.message }, { status });
  }
  return json(
    { error: error instanceof Error ? error.message : 'Unexpected server error.' },
    { status: 500 },
  );
};

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
const sharedWrite = async <A, I>(
  request: Request,
  schema: Schema.Codec<A, I>,
  answer: (input: A) => Promise<Response>,
): Promise<Response> => {
  if (!writeIsSameOrigin(request)) {
    return json({ error: 'Cross-origin writes are not allowed.' }, { status: 403 });
  }
  try {
    return await answer(await Effect.runPromise(decodeBody(request, schema)));
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
}) => sharedWrite(request, FocusSession, async (input) => json(await focus(input.pid)));

/**
 * A terminal in a worktree, at the root, for a board's header and the index's
 * rows alike. It is asked for by path, and a path the daemon does not track is
 * not somewhere it opens one.
 */
export const terminalResponse = ({ request, open }: {
  readonly request: Request;
  /** cmux's answer for a tracked worktree's path; undefined for any other path. */
  readonly open: (path: string) => Promise<TerminalResult | undefined>;
}) =>
  sharedWrite(request, OpenTerminal, async (input) => {
    const result = await open(input.path);
    return result === undefined
      ? json({ error: 'The daemon tracks no worktree at that path.' }, { status: 404 })
      : json(result);
  });

/** Bun closes a connection that has been idle for `idleTimeout`, ten seconds
 *  by default, so a quiet session must still say something. */
const keepAliveMilliseconds = 5_000;

/** One named event on a stream, and the source that fires it. */
export type EventChannel = {
  readonly name: StreamEvent;
  readonly events: SessionEvents | undefined;
};

/**
 * The channels a page asked for in `?events=`, or all of them when it named
 * none. A page names what it reads, so a source the daemon re-reads only for
 * a listening page is not kept busy by a page that ignores it.
 */
export const namedChannels = ({ url, channels }: {
  readonly url: URL;
  readonly channels: ReadonlyArray<EventChannel>;
}): ReadonlyArray<EventChannel> => {
  const named = url.searchParams.get('events');
  if (named === null) return channels;
  const wanted = new Set(named.split(','));
  return channels.filter((channel) => wanted.has(channel.name));
};

/**
 * One server-sent event per notification from the daemon's watchers, which own
 * the debounce. Each channel names the event it writes, so one stream carries
 * everything a page listens for and the page decides what to refetch. A surface
 * served without any source keeps a silent stream rather than a 404, so the
 * client connects once instead of retrying forever.
 */
export const eventStream = (channels: ReadonlyArray<EventChannel>): Response => {
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
      for (const channel of channels) {
        const unsubscribe = channel.events?.subscribe(() =>
          write(`event: ${channel.name}\ndata: {}\n\n`),
        );
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
  readonly distDirectory: string;
  readonly worktree: WorktreeMetadata;
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
   * says it was asked again. The daemon asks the sources and keeps the last
   * answer; the board only reads it.
   */
  readonly links: {
    readonly read: () => Promise<Links>;
    readonly events: SessionEvents;
  };
}) =>
  Effect.gen(function*() {
    const run = Effect.runPromiseWith(yield* Effect.context<ChildProcessSpawner>());
    const { repository } = options;
    const distDirectory = resolve(options.distDirectory);
    const attachWorktree = async (session: Session): Promise<Session> => ({
      ...session,
      worktree: await run(refreshWorktreeMetadata(options.worktree)),
    });

    return async (request: Request): Promise<Response> => {
      try {
        const url = new URL(request.url);
        const mutation = request.method === 'PUT' || request.method === 'POST';
        if (mutation && !writeIsSameOrigin(request)) {
          return json({ error: 'Cross-origin writes are not allowed.' }, { status: 403 });
        }

        if (request.method === 'GET' && url.pathname === '/api/session') {
          return json(await attachWorktree(await run(repository.load)));
        }

        if (request.method === 'GET' && url.pathname === '/api/agents') {
          return json(await options.agents.read());
        }

        if (request.method === 'GET' && url.pathname === '/api/trailers') {
          return json(options.trailers.read());
        }

        if (request.method === 'GET' && url.pathname === '/api/links') {
          return json(await options.links.read());
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

        if (request.method === 'GET' && url.pathname.startsWith('/files/')) {
          let relativePath: string;
          try {
            relativePath = decodeURIComponent(url.pathname.slice('/files/'.length));
          } catch {
            return json({ error: 'Not found.' }, { status: 404 });
          }
          const markdown = await run(repository.readMarkdownFile(relativePath));
          return new Response(markdown, {
            headers: { 'cache-control': 'no-store', 'content-type': 'text/markdown; charset=utf-8' },
          });
        }

        if (request.method === 'POST' && url.pathname === '/api/move') {
          const input = await run(decodeBody(request, MoveItem));
          return json(await attachWorktree(await run(repository.moveItem(input))));
        }
        if (request.method === 'POST' && url.pathname === '/api/batch') {
          const input = await run(decodeBody(request, QueueBatch));
          return json(await attachWorktree(await run(repository.queueBatch(input))));
        }
        if (request.method === 'POST' && url.pathname === '/api/start') {
          const input = await run(decodeBody(request, StartBatch));
          return json(await attachWorktree(await run(repository.startBatch(input))));
        }
        if (request.method === 'POST' && url.pathname === '/api/agents/focus') {
          return await focusResponse({ request, focus: options.agents.focus });
        }
        if (request.method === 'POST' && url.pathname === '/api/complete') {
          const input = await run(decodeBody(request, CompleteItem));
          return json(await attachWorktree(await run(repository.completeItem(input))));
        }

        if (request.method !== 'GET' && request.method !== 'HEAD') {
          return json({ error: 'Method not allowed.' }, { status: 405 });
        }

        const requestedPath = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
        const staticPath = resolve(distDirectory, requestedPath);
        if (staticPath !== distDirectory && !staticPath.startsWith(`${distDirectory}/`)) {
          return json({ error: 'Not found.' }, { status: 404 });
        }
        let staticFile = file(staticPath);
        if (!(await staticFile.exists()) && !requestedPath.includes('.')) {
          staticFile = file(join(distDirectory, 'index.html'));
        }
        // A page nested under the board (`item/<ID>`) resolves `./app.js` against
        // its own directory. The bundle is one flat set of files at the root of
        // dist, so a nested asset is that same file; `basename` is what keeps
        // this from reaching anywhere else.
        if (!(await staticFile.exists()) && requestedPath.includes('/')) {
          staticFile = file(join(distDirectory, basename(requestedPath)));
        }
        if (!(await staticFile.exists())) return json({ error: 'Not found.' }, { status: 404 });
        return request.method === 'HEAD' ? new Response(null) : new Response(staticFile);
      } catch (error) {
        return errorResponse(error);
      }
    };
  });
/* eslint-enable max-lines-per-function */
