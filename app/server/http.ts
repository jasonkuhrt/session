import { basename, join, resolve } from 'node:path';
import { NodeServices } from '@effect/platform-node';
import { file } from 'bun';
import * as Effect from 'effect/Effect';
import * as Schema from 'effect/Schema';
import { stageNames } from '../contract.ts';
import type { AgentsSummary, FocusResult, Session } from '../contract.ts';
import type { SessionEvents } from './events.ts';
import { SessionError } from './model.ts';
import { makeRepository, RepositoryError } from './repository.ts';
import { refreshWorktreeMetadata, type WorktreeMetadata } from './worktree.ts';

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

const runRepository = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

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
    const input = await runRepository(decodeBody(request, FocusSession));
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
export const createRequestHandler = async (options: {
  readonly directory: string;
  readonly distDirectory?: string | undefined;
  readonly worktree?: WorktreeMetadata | undefined;
  readonly refreshWorktree?: boolean | undefined;
  readonly events?: SessionEvents | undefined;
  /**
   * The agents overlay for this worktree. The daemon owns the listing, its
   * cache and the window manager; the board's routes only hand them on.
   */
  readonly agents: {
    readonly read: () => Promise<AgentsSummary>;
    readonly focus: (pid: number) => Promise<FocusResult>;
    readonly events: SessionEvents;
  };
}) => {
  const repository = await Effect.runPromise(
    makeRepository(options.directory).pipe(Effect.provide(NodeServices.layer)),
  );
  const distDirectory = resolve(options.distDirectory ?? join(import.meta.dir, '../dist'));
  const attachWorktree = async (session: Session): Promise<Session> => {
    if (options.worktree === undefined) return session;
    const worktree = options.refreshWorktree === true
      ? await Effect.runPromise(
          refreshWorktreeMetadata(options.worktree).pipe(Effect.provide(NodeServices.layer)),
        )
      : options.worktree;
    return { ...session, worktree };
  };

  return async (request: Request): Promise<Response> => {
    try {
      const url = new URL(request.url);
      const mutation = request.method === 'PUT' || request.method === 'POST';
      if (mutation && !writeIsSameOrigin(request)) {
        return json({ error: 'Cross-origin writes are not allowed.' }, { status: 403 });
      }

      if (request.method === 'GET' && url.pathname === '/api/session') {
        return json(await attachWorktree(await runRepository(repository.load)));
      }

      if (request.method === 'GET' && url.pathname === '/api/agents') {
        return json(await options.agents.read());
      }

      if (request.method === 'GET' && url.pathname === '/api/events') {
        return eventStream([
          { name: 'changed', events: options.events },
          { name: 'agents', events: options.agents.events },
        ]);
      }

      if (request.method === 'GET' && url.pathname.startsWith('/files/')) {
        let relativePath: string;
        try {
          relativePath = decodeURIComponent(url.pathname.slice('/files/'.length));
        } catch {
          return json({ error: 'Not found.' }, { status: 404 });
        }
        const markdown = await runRepository(repository.readMarkdownFile(relativePath));
        return new Response(markdown, {
          headers: { 'cache-control': 'no-store', 'content-type': 'text/markdown; charset=utf-8' },
        });
      }

      if (request.method === 'POST' && url.pathname === '/api/move') {
        const input = await runRepository(decodeBody(request, MoveItem));
        return json(await attachWorktree(await runRepository(repository.moveItem(input))));
      }
      if (request.method === 'POST' && url.pathname === '/api/batch') {
        const input = await runRepository(decodeBody(request, QueueBatch));
        return json(await attachWorktree(await runRepository(repository.queueBatch(input))));
      }
      if (request.method === 'POST' && url.pathname === '/api/start') {
        const input = await runRepository(decodeBody(request, StartBatch));
        return json(await attachWorktree(await runRepository(repository.startBatch(input))));
      }
      if (request.method === 'POST' && url.pathname === '/api/agents/focus') {
        return await focusResponse({ request, focus: options.agents.focus });
      }
      if (request.method === 'POST' && url.pathname === '/api/complete') {
        const input = await runRepository(decodeBody(request, CompleteItem));
        return json(await attachWorktree(await runRepository(repository.completeItem(input))));
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
};
/* eslint-enable max-lines-per-function */
