import { join, resolve } from 'node:path';
import { NodeServices } from '@effect/platform-node';
import { file, serve } from 'bun';
import * as Effect from 'effect/Effect';
import * as Schema from 'effect/Schema';
import { stageNames } from '../contract.ts';
import type { Session } from '../contract.ts';
import { SessionError } from './model.ts';
import { makeRepository, RepositoryError } from './repository.ts';
import { refreshWorktreeMetadata, type WorktreeMetadata } from './worktree.ts';

const Stage = Schema.Literals(stageNames);
const PutFile = Schema.Struct({
  stage: Stage,
  markdown: Schema.String,
  revision: Schema.String,
});
const AddItem = Schema.Struct({
  stage: Stage,
  id: Schema.optionalKey(Schema.String),
  title: Schema.String,
  body: Schema.String,
  group: Schema.optionalKey(Schema.String),
  revision: Schema.String,
});
const UpdateItem = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  body: Schema.String,
  revision: Schema.String,
});
const MoveItem = Schema.Struct({
  id: Schema.String,
  to: Stage,
  beforeId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  body: Schema.optionalKey(Schema.String),
  revision: Schema.String,
});
const StartBatch = Schema.Struct({
  ids: Schema.Array(Schema.String),
  name: Schema.String,
  revision: Schema.String,
});
const CompleteItem = Schema.Struct({
  id: Schema.String,
  revision: Schema.String,
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

const writeIsSameOrigin = (request: Request): boolean => {
  const url = new URL(request.url);
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  return (origin === null || origin === url.origin) && fetchSite !== 'cross-site';
};

const runRepository = <A>(effect: Effect.Effect<A, RepositoryError>) => Effect.runPromise(effect);

/* eslint-disable max-lines-per-function -- The HTTP boundary is a small linear route table; splitting each route would add indirection without isolating behavior. */
export const createRequestHandler = async (options: {
  readonly directory: string;
  readonly distDirectory?: string | undefined;
  readonly worktree?: WorktreeMetadata | undefined;
  readonly refreshWorktree?: boolean | undefined;
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

      if (request.method === 'PUT' && url.pathname === '/api/file') {
        const input = await runRepository(decodeBody(request, PutFile));
        return json(await attachWorktree(await runRepository(repository.putFile(input))));
      }
      if (request.method === 'POST' && url.pathname === '/api/item') {
        const input = await runRepository(decodeBody(request, AddItem));
        return json(await attachWorktree(await runRepository(repository.addItem(input))));
      }
      if (request.method === 'PUT' && url.pathname === '/api/item') {
        const input = await runRepository(decodeBody(request, UpdateItem));
        return json(await attachWorktree(await runRepository(repository.updateItem(input))));
      }
      if (request.method === 'POST' && url.pathname === '/api/move') {
        const input = await runRepository(decodeBody(request, MoveItem));
        return json(await attachWorktree(await runRepository(repository.moveItem(input))));
      }
      if (request.method === 'POST' && url.pathname === '/api/batch') {
        const input = await runRepository(decodeBody(request, StartBatch));
        return json(await attachWorktree(await runRepository(repository.startBatch(input))));
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
      if (!(await staticFile.exists())) return json({ error: 'Not found.' }, { status: 404 });
      return request.method === 'HEAD' ? new Response(null) : new Response(staticFile);
    } catch (error) {
      return errorResponse(error);
    }
  };
};
/* eslint-enable max-lines-per-function */

export const startServer = async (options: {
  readonly directory: string;
  readonly port?: number | undefined;
  readonly distDirectory?: string | undefined;
  readonly worktree?: WorktreeMetadata | undefined;
}) => {
  const repository = await Effect.runPromise(
    makeRepository(options.directory).pipe(Effect.provide(NodeServices.layer)),
  );
  await Effect.runPromise(repository.initialize);
  const fetch = await createRequestHandler({ ...options, refreshWorktree: true });
  return serve({
    hostname: '127.0.0.1',
    port: options.port ?? 3210,
    fetch,
  });
};
