import { join, resolve } from 'node:path';
import { NodeServices } from '@effect/platform-node';
import type { NodeServices as NodeServiceUnion } from '@effect/platform-node/NodeServices';
import { file, serve, spawn } from 'bun';
import * as Cause from 'effect/Cause';
import * as Config from 'effect/Config';
import * as Data from 'effect/Data';
import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';
import * as Fiber from 'effect/Fiber';
import * as FileSystem from 'effect/FileSystem';
import * as Option from 'effect/Option';
import * as Result from 'effect/Result';
import * as Schema from 'effect/Schema';
import * as Stream from 'effect/Stream';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';
import * as HttpClient from 'effect/unstable/http/HttpClient';
import * as HttpClientRequest from 'effect/unstable/http/HttpClientRequest';
import type { DaemonInfo, Stage, WorktreeSummary } from '../contract.ts';
import { DaemonInfoSchema, daemonPort } from '../contract.ts';
import { makeSessionEvents, type SessionEventSource } from './events.ts';
import { createRequestHandler } from './http.ts';
import { makeRepository } from './repository.ts';
import {
  encodeWorktreeKey,
  ensureSession,
  listGitWorktrees,
  refreshWorktreeMetadata,
  resolveWorktreeSession,
  type WorktreeMetadata,
  type WorktreeSession,
} from './worktree.ts';

/* eslint-disable max-lines -- One process boundary: its state file, its registry, its routes and the client that upserts it belong in one place. */

/**
 * One daemon per user on 127.0.0.1. It serves the index of tracked worktrees at
 * `/`, one board per worktree under `/w/<key>/`, and pushes a `changed` event
 * per worktree whose `.session` moves underneath it.
 */

const repositoryRoot = resolve(import.meta.dir, '../..');
const distDirectory = join(repositoryRoot, 'app/dist');
const daemonEntry = join(repositoryRoot, 'app/server/daemon.ts');

/** Sources whose newest mtime decides whether a running daemon is current. */
const stampedPaths = [
  'app/server',
  'app/contract.ts',
  'app/stage-rules.ts',
  'app/dist',
  'src/session/scripts',
];

export class DaemonError extends Data.TaggedError('DaemonError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export type DaemonSettings = {
  readonly port: number;
  readonly directory: string;
  readonly statePath: string;
  readonly logPath: string;
};

/** `SESSION_STATE_DIR` and `SESSION_PORT` exist for verification and development. */
export const daemonSettings = Effect.gen(function*() {
  const port = yield* Config.Int('SESSION_PORT').pipe(Config.withDefault(daemonPort));
  const override = yield* Config.String('SESSION_STATE_DIR').pipe(Config.option);
  const directory = Option.isSome(override)
    ? resolve(override.value)
    : join(yield* Config.String('HOME'), '.local/state/session');
  return {
    port,
    directory,
    statePath: join(directory, 'daemon.json'),
    logPath: join(directory, 'daemon.log'),
  } satisfies DaemonSettings;
});

const DaemonStateSchema = Schema.Struct({
  pid: Schema.Int,
  port: Schema.Int,
  startedAt: Schema.String,
  sourceStamp: Schema.String,
  worktrees: Schema.Array(Schema.String),
});
const DaemonStateJson = Schema.fromJsonString(DaemonStateSchema);
const DaemonInfoJson = Schema.fromJsonString(DaemonInfoSchema);
type DaemonState = typeof DaemonStateSchema.Type;

export const sourceStamp = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const pending = stampedPaths.map((entry) => join(repositoryRoot, entry));
  let newest: Date | undefined;
  while (pending.length > 0) {
    const path = pending.pop()!;
    const info = yield* fs.stat(path).pipe(Effect.option);
    if (Option.isNone(info)) continue;
    if (info.value.type === 'Directory') {
      for (const name of yield* fs.readDirectory(path)) pending.push(join(path, name));
      continue;
    }
    const mtime = info.value.mtime;
    if (Option.isSome(mtime) && (newest === undefined || mtime.value > newest)) newest = mtime.value;
  }
  return newest?.toISOString() ?? 'unknown';
});

const readState = (settings: DaemonSettings) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    if (!(yield* fs.exists(settings.statePath))) return null;
    const encoded = yield* fs.readFileString(settings.statePath);
    return yield* Schema.decodeEffect(DaemonStateJson)(encoded);
  }).pipe(Effect.orElseSucceed(() => null));

const writeState = (settings: DaemonSettings, state: DaemonState) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.makeDirectory(settings.directory, { recursive: true });
    yield* fs.writeFileString(settings.statePath, yield* Schema.encodeEffect(DaemonStateJson)(state));
  });

// --- the client half: what `session open` needs -----------------------------

type Probe =
  | { readonly kind: 'silent' }
  | { readonly kind: 'foreign' }
  | { readonly kind: 'ours'; readonly info: DaemonInfo };

const probeDaemon = (port: number) =>
  Effect.gen(function*() {
    const response = yield* HttpClient.get(`http://127.0.0.1:${port}/api/daemon`).pipe(
      Effect.timeout('1 second'),
      Effect.result,
    );
    // A refused connection leaves the port free; silence means somebody holds
    // it without speaking HTTP.
    if (Result.isFailure(response)) {
      return Cause.isTimeoutError(response.failure)
        ? ({ kind: 'foreign' } as const)
        : ({ kind: 'silent' } as const);
    }
    const text = yield* response.success.text.pipe(Effect.option);
    if (Option.isNone(text)) return { kind: 'foreign' } as const;
    const info = yield* Schema.decodeEffect(DaemonInfoJson)(text.value).pipe(Effect.option);
    return Option.isSome(info)
      ? ({ kind: 'ours', info: info.value } as const)
      : ({ kind: 'foreign' } as const);
  }).pipe(Effect.provide(FetchHttpClient.layer)) satisfies Effect.Effect<Probe, never, never>;

const stopProcess = (pid: number) =>
  Effect.try({
    try: () => process.kill(pid, 'SIGTERM'),
    catch: (cause) => new DaemonError({ message: `Process ${pid} was already gone.`, cause }),
  }).pipe(Effect.ignore);

const spawnDaemon = (settings: DaemonSettings) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.makeDirectory(settings.directory, { recursive: true });
    yield* Effect.sync(() => {
      // Detached with its stdio on the log file: the daemon outlives this CLI.
      // The same runtime that is running this CLI, whatever PATH says.
      const child = spawn([process.execPath, daemonEntry], {
        cwd: repositoryRoot,
        stdin: 'ignore',
        stdout: file(settings.logPath),
        stderr: file(settings.logPath),
        detached: true,
      });
      child.unref();
    });
  });

/** A stopped daemon holds the port for a moment; the next one cannot bind yet. */
const waitForSilence = (settings: DaemonSettings) =>
  Effect.gen(function*() {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if ((yield* probeDaemon(settings.port)).kind === 'silent') return;
      yield* Effect.sleep('100 millis');
    }
    return yield* new DaemonError({
      message: `Port ${settings.port} is still held after stopping the daemon. Try again.`,
    });
  });

const waitForDaemon = (settings: DaemonSettings, stamp: string) =>
  Effect.gen(function*() {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const probe = yield* probeDaemon(settings.port);
      if (probe.kind === 'ours' && probe.info.sourceStamp === stamp) return;
      yield* Effect.sleep('100 millis');
    }
    return yield* new DaemonError({
      message: `The daemon did not answer on port ${settings.port}. See ${settings.logPath}.`,
    });
  });

/**
 * Reuse a healthy daemon built from these sources; replace a stale one; refuse
 * a port somebody else holds.
 */
export const ensureDaemon = Effect.gen(function*() {
  const settings = yield* daemonSettings;
  const stamp = yield* sourceStamp;
  const probe = yield* probeDaemon(settings.port);
  if (probe.kind === 'ours' && probe.info.sourceStamp === stamp) return settings;
  if (probe.kind === 'foreign') {
    return yield* new DaemonError({
      message: `Port ${settings.port} is held by another process. Free it and try again.`,
    });
  }
  if (probe.kind === 'ours') yield* stopProcess(probe.info.pid);
  else {
    // Nothing is listening, but a crashed daemon may still be named here.
    const state = yield* readState(settings);
    if (state !== null) yield* stopProcess(state.pid);
  }
  yield* waitForSilence(settings);
  yield* spawnDaemon(settings);
  yield* waitForDaemon(settings, stamp);
  return settings;
});

/** Track this worktree with the daemon and let it rediscover its siblings. */
export const trackWorktree = (input: { readonly settings: DaemonSettings; readonly path: string }) =>
  HttpClient.execute(
    HttpClientRequest.post(
      `http://127.0.0.1:${input.settings.port}/api/worktrees/refresh`,
    ).pipe(HttpClientRequest.bodyJsonUnsafe({ path: input.path })),
  ).pipe(
    Effect.provide(FetchHttpClient.layer),
    Effect.mapError((cause) => new DaemonError({ message: 'The daemon refused the worktree.', cause })),
  );

/** macOS opens the board; everywhere else the printed URL is the whole story. */
export const openInBrowser = (url: string) =>
  Effect.gen(function*() {
    if (process.platform !== 'darwin') return;
    // Wait for the launcher: this process exits as soon as it returns.
    yield* Effect.tryPromise({
      try: () => spawn(['open', url], { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' }).exited,
      catch: (cause) => new DaemonError({ message: `Could not open ${url}.`, cause }),
    });
  });

// --- the server half --------------------------------------------------------

type Tracked = {
  readonly path: string;
  readonly key: string;
  readonly metadata: WorktreeMetadata;
  conflict: string | null;
  handler: ((request: Request) => Promise<Response>) | undefined;
  events: SessionEventSource | undefined;
  watcher: Fiber.Fiber<void, never> | undefined;
};

const runNode = <A, E>(effect: Effect.Effect<A, E, NodeServiceUnion>) =>
  Effect.runPromise(effect.pipe(Effect.provide(NodeServices.layer)));

/**
 * Every task here spawns Git and reads a session, so the index must not fan out
 * one task per tracked worktree: twenty at once exhausts the listener budget of
 * the streams those child processes attach to.
 */
const worktreeConcurrency = 4;

const mapWorktrees = <A, B>(
  items: ReadonlyArray<A>,
  run: (item: A) => Promise<B>,
): Promise<B[]> =>
  Effect.runPromise(
    Effect.forEach(items, (item) => Effect.promise(() => run(item)), {
      concurrency: worktreeConcurrency,
    }),
  );

const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { 'cache-control': 'no-store' } });

const watchSession = (directory: string, events: SessionEventSource) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.watch(directory, { recursive: true }).pipe(
      Stream.runForEach(() => Effect.sync(() => events.changed())),
    );
  }).pipe(
    Effect.provide(NodeServices.layer),
    Effect.catchCause((cause) => Effect.logError(`Watch stopped for ${directory}`, cause)),
  );

// eslint-disable-next-line max-lines-per-function -- The registry, its routes and its lifecycle are one object; the closures share the map.
export const runDaemon = async () => {
  const [settings, stamp] = await Promise.all([runNode(daemonSettings), runNode(sourceStamp)]);
  const startedAt = DateTime.formatIso(await Effect.runPromise(DateTime.now));
  const tracked = new Map<string, Tracked>();

  const persist = () =>
    runNode(
      writeState(settings, {
        pid: process.pid,
        port: settings.port,
        startedAt,
        sourceStamp: stamp,
        worktrees: [...tracked.keys()],
      }),
    );

  const pathExists = (path: string) =>
    runNode(
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem;
        return yield* fs.exists(path);
      }).pipe(Effect.orElseSucceed(() => false)),
    );

  const untrack = (path: string) => {
    const entry = tracked.get(path);
    if (entry === undefined) return;
    if (entry.watcher !== undefined) Effect.runFork(entry.watcher.pipe(Fiber.interrupt));
    entry.events?.close();
    tracked.delete(path);
  };

  /** In the caller's order: the first worktree to claim a key owns it. */
  const insert = (path: string, resolved: WorktreeSession) => {
    if (tracked.has(path)) return;
    const key = encodeWorktreeKey(resolved.worktree.name);
    const owner = [...tracked.values()].find((entry) => entry.key === key);
    const conflict = owner === undefined ? null : `The key ${key} already belongs to ${owner.path}.`;
    if (conflict !== null) console.error(`${path}: ${conflict}`);
    tracked.set(path, {
      path,
      key,
      metadata: resolved.worktree,
      conflict,
      handler: undefined,
      events: undefined,
      watcher: undefined,
    });
  };

  const isDirectory = (path: string) =>
    runNode(
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem;
        if (!(yield* fs.exists(path))) return false;
        return (yield* fs.stat(path)).type === 'Directory';
      }).pipe(Effect.orElseSucceed(() => false)),
    );

  /**
   * Resolve every new path at once, then take them in order. A path arrives
   * from a local client, so the daemon only ever tracks a directory it can see.
   */
  const track = async (paths: ReadonlyArray<string>) => {
    const fresh: string[] = [];
    for (const path of new Set(paths.map((entry) => resolve(entry)))) {
      if (!tracked.has(path)) fresh.push(path);
    }
    const checked = await mapWorktrees(fresh, async (path) => ({
      path,
      usable: await isDirectory(path),
    }));
    const usable: string[] = [];
    for (const entry of checked) if (entry.usable) usable.push(entry.path);
    const described = await mapWorktrees(usable, async (path) => ({
      path,
      resolved: await runNode(resolveWorktreeSession(path)),
    }));
    for (const entry of described) insert(entry.path, entry.resolved);
  };

  /** Git knows the siblings; a worktree joins the index once it has a session. */
  const discover = async () => {
    const known = [...tracked.values()];
    const probed = await mapWorktrees(known, async (entry) => {
      const [exists, siblings] = await Promise.all([
        pathExists(entry.path),
        runNode(listGitWorktrees(entry.path).pipe(Effect.orElseSucceed(() => []))),
      ]);
      return { entry, exists, siblings };
    });
    const candidates = new Set<string>();
    for (const item of probed) {
      if (!item.exists) {
        untrack(item.entry.path);
        continue;
      }
      for (const sibling of item.siblings) candidates.add(sibling.path);
    }
    const sessions = await mapWorktrees([...candidates], async (path) => ({
      path,
      ready: await pathExists(join(path, '.session')),
    }));
    const ready: string[] = [];
    for (const candidate of sessions) if (candidate.ready) ready.push(candidate.path);
    await track(ready);
    await persist();
  };

  const summarize = async (entry: Tracked): Promise<WorktreeSummary> => {
    const counts: Record<Stage, number> = { TRIAGE: 0, DESIGN: 0, BATCH: 0, QUEUE: 0, EXECUTE: 0 };
    const base = {
      key: entry.key,
      name: entry.metadata.name,
      path: entry.path,
      branch: entry.metadata.branch,
    };
    try {
      const metadata = await runNode(refreshWorktreeMetadata(entry.metadata));
      const loaded = await runNode(
        Effect.gen(function*() {
          const repository = yield* makeRepository(join(entry.path, '.session'));
          return {
            session: yield* repository.load,
            lastChange: yield* repository.lastChange,
          };
        }),
      );
      for (const stage of loaded.session.stages) counts[stage.stage] = stage.items.length;
      const execute = loaded.session.stages.find((stage) => stage.stage === 'EXECUTE');
      const running = execute === undefined || execute.items.length === 0
        ? null
        : { batch: execute.items[0]!.batch ?? '', items: execute.items.length };
      return {
        ...base,
        branch: metadata.branch,
        running,
        counts,
        lastChange: loaded.lastChange,
        conflict: entry.conflict,
      };
    } catch (error) {
      // A row that cannot be read is a row that cannot be served; say why.
      return {
        ...base,
        running: null,
        counts,
        lastChange: null,
        conflict: entry.conflict ?? (error instanceof Error ? error.message : String(error)),
      };
    }
  };

  const handlerFor = async (entry: Tracked) => {
    if (entry.handler !== undefined) return entry.handler;
    const resolved = await runNode(resolveWorktreeSession(entry.path));
    await runNode(ensureSession(resolved));
    const events = makeSessionEvents();
    entry.events = events;
    entry.watcher = Effect.runFork(watchSession(resolved.directory, events));
    entry.handler = await createRequestHandler({
      directory: resolved.directory,
      distDirectory,
      worktree: resolved.worktree,
      refreshWorktree: true,
      events,
    });
    return entry.handler;
  };

  const board = async (request: Request, url: URL) => {
    const rest = url.pathname.slice('/w/'.length);
    const entry = [...tracked.values()]
      .toSorted((left, right) => right.key.length - left.key.length)
      .find((candidate) => rest === candidate.key || rest.startsWith(`${candidate.key}/`));
    if (entry === undefined) return json({ error: 'No such worktree.' }, 404);
    if (entry.conflict !== null) return json({ error: entry.conflict }, 409);
    if (rest === entry.key) return Response.redirect(new URL(`/w/${entry.key}/`, url).href, 307);
    const target = new URL(url);
    target.pathname = rest.slice(entry.key.length);
    return (await handlerFor(entry))(new Request(target, request));
  };

  const staticFile = async (url: URL, method: string) => {
    if (method !== 'GET' && method !== 'HEAD') return json({ error: 'Method not allowed.' }, 405);
    const requested = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const path = resolve(distDirectory, requested);
    if (path !== distDirectory && !path.startsWith(`${distDirectory}/`)) {
      return json({ error: 'Not found.' }, 404);
    }
    let candidate = file(path);
    if (!(await candidate.exists()) && !requested.includes('.')) {
      candidate = file(join(distDirectory, 'index.html'));
    }
    if (!(await candidate.exists())) return json({ error: 'Not found.' }, 404);
    return method === 'HEAD' ? new Response(null) : new Response(candidate);
  };

  const handle = async (request: Request): Promise<Response> => {
    try {
      const url = new URL(request.url);
      if (request.method === 'GET' && url.pathname === '/api/daemon') {
        return json({ pid: process.pid, port: settings.port, startedAt, sourceStamp: stamp });
      }
      if (request.method === 'GET' && url.pathname === '/api/worktrees') {
        return json(await mapWorktrees([...tracked.values()], (entry) => summarize(entry)));
      }
      if (request.method === 'POST' && url.pathname === '/api/worktrees/refresh') {
        const body = await request.json().catch(() => ({}));
        const path = typeof body === 'object' && body !== null && 'path' in body ? body.path : undefined;
        if (typeof path === 'string') await track([path]);
        await discover();
        return json(await mapWorktrees([...tracked.values()], (entry) => summarize(entry)));
      }
      if (url.pathname === '/w' || url.pathname.startsWith('/w/')) return await board(request, url);
      return await staticFile(url, request.method);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'Unexpected daemon error.' }, 500);
    }
  };

  const previous = await runNode(readState(settings));
  await track(previous?.worktrees ?? []);

  // SSE streams are quiet between events; Bun would close them after ten seconds.
  const server = serve({ hostname: '127.0.0.1', port: settings.port, idleTimeout: 0, fetch: handle });
  await persist();
  console.log(`Session daemon: http://127.0.0.1:${server.port} (pid ${process.pid})`);
  console.log(`Sources: ${stamp}`);
};

if (import.meta.main) await runDaemon();
