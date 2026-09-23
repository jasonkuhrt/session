import { basename, extname, join, resolve } from 'node:path';
import { file } from 'bun';
import * as Effect from 'effect/Effect';
import * as Schema from 'effect/Schema';
import type { ChildProcessSpawner } from 'effect/unstable/process/ChildProcessSpawner';
import { stageNames } from '../contract.ts';
import type { AgentsSummary, FocusResult, Session, TrailerProblem } from '../contract.ts';
import type { SessionEvents } from './events.ts';
import { SessionError } from './model.ts';
import { RepositoryError, type SessionRepository } from './repository.ts';
import { refreshWorktreeMetadata, type WorktreeMetadata } from './worktree.ts';

/* eslint-disable max-lines -- The HTTP boundary is one linear route table and the few response shapes it needs; splitting it by length would scatter routes that read as a list. */

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
 * Focusing a session's terminal, as both routers serve it: a board's under its
 * own prefix, and the index's at the root, where there is no board to scope it
 * to. One handler, so the two can never take different bodies or answer a
 * refusal differently; the daemon owns the window manager behind it.
 */
export async function focusResponse(
  { request, focus }: {
    readonly request: Request;
    readonly focus: (pid: number) => Promise<FocusResult>;
  },
): Promise<Response> {
  if (!writeIsSameOrigin(request)) {
    return json({ error: 'Cross-origin writes are not allowed.' }, { status: 403 });
  }
  try {
    const input = await Effect.runPromise(decodeBody(request, FocusSession));
    return json(await focus(input.pid));
  } catch (error) {
    return errorResponse(error);
  }
}

/** Bun closes a connection that has been idle for `idleTimeout`, ten seconds
 *  by default, so a quiet session must still say something. */
const keepAliveMilliseconds = 5_000;

/** One named event on a stream, and the source that fires it. */
export type EventChannel = {
  readonly name: string;
  readonly events: SessionEvents | undefined;
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

        if (request.method === 'GET' && url.pathname === '/api/events') {
          return eventStream([
            { name: 'changed', events: options.events },
            { name: 'agents', events: options.agents.events },
            { name: 'trailers', events: options.trailers.events },
          ]);
        }

        if (request.method === 'GET' && url.pathname === '/api/ledger') {
          return json(await run(repository.ledgerListing));
        }

        if (request.method === 'GET' && url.pathname === '/api/context') {
          return json(await run(repository.contextListing));
        }

        if (request.method === 'GET' && url.pathname === '/api/archive') {
          return json(await run(repository.archiveListing));
        }

        if (request.method === 'GET' && url.pathname.startsWith('/files/')) {
          let relativePath: string;
          try {
            relativePath = decodeURIComponent(url.pathname.slice('/files/'.length));
          } catch {
            return json({ error: 'Not found.' }, { status: 404 });
          }
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

        // An API a board does not have is an error, never the app's page.
        if (url.pathname.startsWith('/api/')) return json({ error: 'Not found.' }, { status: 404 });

        const requestedPath = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
        const staticPath = resolve(distDirectory, requestedPath);
        if (staticPath !== distDirectory && !staticPath.startsWith(`${distDirectory}/`)) {
          return json({ error: 'Not found.' }, { status: 404 });
        }
        let staticFile = file(staticPath);
        // A page nested under the board (`item/<ID>`, `file/<path>`) resolves
        // `./app.js` against its own directory. The bundle is one flat set of
        // files at the root of dist, so a nested asset is that same file;
        // `basename` is what keeps this from reaching anywhere else.
        if (!(await staticFile.exists()) && requestedPath.includes('/')) {
          staticFile = file(join(distDirectory, basename(requestedPath)));
        }
        // Every other path is one of the app's pages, whatever it holds: an item
        // id or a file's path can carry a dot, and gets the page all the same.
        if (!(await staticFile.exists())) staticFile = file(join(distDirectory, 'index.html'));
        if (!(await staticFile.exists())) return json({ error: 'Not found.' }, { status: 404 });
        return request.method === 'HEAD' ? new Response(null) : new Response(staticFile);
      } catch (error) {
        return errorResponse(error);
      }
    };
  });
/* eslint-enable max-lines-per-function */
