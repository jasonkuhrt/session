import { join, resolve } from 'node:path';
import { NodeServices } from '@effect/platform-node';
import * as Effect from 'effect/Effect';
import * as Schema from 'effect/Schema';
import { stageNames } from '../contract.ts';
import { SessionError } from './model.ts';
import { makeRepository, RepositoryError } from './repository.ts';

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
    Effect.flatMap(Schema.decodeUnknownEffect(schema)),
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

export const createRequestHandler = async (options: {
  readonly directory: string;
  readonly distDirectory?: string | undefined;
}) => {
  const repository = await Effect.runPromise(
    makeRepository(options.directory).pipe(Effect.provide(NodeServices.layer)),
  );
  const distDirectory = resolve(options.distDirectory ?? join(import.meta.dir, '../dist'));
  const run = <A>(effect: Effect.Effect<A, RepositoryError>) => Effect.runPromise(effect);

  return async (request: Request): Promise<Response> => {
    try {
      const url = new URL(request.url);
      const mutation = request.method === 'PUT' || request.method === 'POST';
      if (mutation && !writeIsSameOrigin(request)) {
        return json({ error: 'Cross-origin writes are not allowed.' }, { status: 403 });
      }

      if (request.method === 'GET' && url.pathname === '/api/session') {
        return json(await run(repository.load));
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

      if (request.method === 'PUT' && url.pathname === '/api/file') {
        const input = await run(decodeBody(request, PutFile));
        return json(await run(repository.putFile(input)));
      }
      if (request.method === 'POST' && url.pathname === '/api/item') {
        const input = await run(decodeBody(request, AddItem));
        return json(await run(repository.addItem(input)));
      }
      if (request.method === 'PUT' && url.pathname === '/api/item') {
        const input = await run(decodeBody(request, UpdateItem));
        return json(await run(repository.updateItem(input)));
      }
      if (request.method === 'POST' && url.pathname === '/api/move') {
        const input = await run(decodeBody(request, MoveItem));
        return json(await run(repository.moveItem(input)));
      }
      if (request.method === 'POST' && url.pathname === '/api/batch') {
        const input = await run(decodeBody(request, StartBatch));
        return json(await run(repository.startBatch(input)));
      }
      if (request.method === 'POST' && url.pathname === '/api/complete') {
        const input = await run(decodeBody(request, CompleteItem));
        return json(await run(repository.completeItem(input)));
      }

      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return json({ error: 'Method not allowed.' }, { status: 405 });
      }

      const requestedPath = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      const staticPath = resolve(distDirectory, requestedPath);
      if (staticPath !== distDirectory && !staticPath.startsWith(`${distDirectory}/`)) {
        return json({ error: 'Not found.' }, { status: 404 });
      }
      let file = Bun.file(staticPath);
      if (!(await file.exists()) && !requestedPath.includes('.')) {
        file = Bun.file(join(distDirectory, 'index.html'));
      }
      if (!(await file.exists())) return json({ error: 'Not found.' }, { status: 404 });
      return request.method === 'HEAD' ? new Response(null) : new Response(file);
    } catch (error) {
      return errorResponse(error);
    }
  };
};

export const startServer = async (options: {
  readonly directory: string;
  readonly port?: number | undefined;
  readonly distDirectory?: string | undefined;
}) => {
  const repository = await Effect.runPromise(
    makeRepository(options.directory).pipe(Effect.provide(NodeServices.layer)),
  );
  await Effect.runPromise(repository.initialize);
  const fetch = await createRequestHandler(options);
  return Bun.serve({
    hostname: '127.0.0.1',
    port: options.port ?? 3210,
    fetch,
  });
};
