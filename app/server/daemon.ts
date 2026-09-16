import { closeSync, openSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import * as NodeChildProcessSpawner from '@effect/platform-node/NodeChildProcessSpawner';
import * as NodeCrypto from '@effect/platform-node/NodeCrypto';
import * as NodeFileSystem from '@effect/platform-node/NodeFileSystem';
import * as NodePath from '@effect/platform-node/NodePath';
import { file, serve, spawn } from 'bun';
import * as Cause from 'effect/Cause';
import * as Clock from 'effect/Clock';
import * as Config from 'effect/Config';
import * as Data from 'effect/Data';
import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';
import * as Equal from 'effect/Equal';
import * as Fiber from 'effect/Fiber';
import * as FileSystem from 'effect/FileSystem';
import * as Layer from 'effect/Layer';
import * as ManagedRuntime from 'effect/ManagedRuntime';
import * as Option from 'effect/Option';
import type { PlatformError } from 'effect/PlatformError';
import * as Result from 'effect/Result';
import * as Schema from 'effect/Schema';
import * as Stream from 'effect/Stream';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';
import * as HttpClient from 'effect/unstable/http/HttpClient';
import * as HttpClientRequest from 'effect/unstable/http/HttpClientRequest';
import type { Activity, AgentsSummary, DaemonInfo, Stage, TrailerProblem, WorktreeSummary } from '../contract.ts';
import { DaemonInfoSchema, daemonPort } from '../contract.ts';
import { agentsFor, focus, notListed, watchedDirectories } from './agents/index.ts';
import { makeSessionEvents, type SessionEventSource } from './events.ts';
import { eventStream, focusResponse, makeRequestHandler } from './http.ts';
import { makeRepository, type SessionRepository } from './repository.ts';
import { reconcileTrailers } from './trailers.ts';
import {
  encodeWorktreeKey,
  ensureSession,
  listGitWorktrees,
  refreshWorktreeMetadata,
  resolveWorktreeSession,
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
    yield* Effect.try({
      try: () => {
        // One descriptor for both streams, opened once and emptied. Two opens of
        // the file each kept an offset of their own and wrote over each other,
        // and neither emptied it, so a restarted daemon's log still showed the
        // previous daemon's lines after its own.
        const log = openSync(settings.logPath, 'w');
        try {
          // Detached with its stdio on the log file: the daemon outlives this CLI.
          // The same runtime that is running this CLI, whatever PATH says.
          const child = spawn([process.execPath, daemonEntry], {
            cwd: repositoryRoot,
            stdin: 'ignore',
            stdout: log,
            stderr: log,
            detached: true,
          });
          child.unref();
        } finally {
          // The child holds its own copy of the descriptor.
          closeSync(log);
        }
      },
      catch: (cause) => new DaemonError({ message: `Could not start the daemon; see ${settings.logPath}.`, cause }),
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
/**
 * What holds the daemon's port right now, beside the settings that name it.
 * `open` decides from this whether to spawn one; every other command uses it to
 * tell a running daemon about a session it has just scaffolded, and to leave
 * the port alone when nothing of ours is on it.
 */
export const daemonOnPort = Effect.gen(function*() {
  const settings = yield* daemonSettings;
  return { settings, probe: yield* probeDaemon(settings.port) };
});

export const ensureDaemon = Effect.gen(function*() {
  const { settings, probe } = yield* daemonOnPort;
  const stamp = yield* sourceStamp;
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
  /** Where the worktree's session and its Git state are, as resolved when it was tracked. */
  readonly session: WorktreeSession;
  /** The one repository the board and the trailer passes both write through, so they share a lock. */
  readonly repository: SessionRepository;
  conflict: string | null;
  handler: ((request: Request) => Promise<Response>) | undefined;
  /** Every tracked worktree has these from the moment it is tracked: the
   *  watcher is what notices its session changing and what notices it leave,
   *  which is not something a board being open can be a condition of. */
  readonly events: SessionEventSource;
  readonly watcher: Fiber.Fiber<void, never>;
  /** The worktree's trailer passes; see `reconcileLoop`. */
  readonly trailerLoop: Fiber.Fiber<void, never>;
  /** The last pass's answer; derived, and replaced by every pass that changes it. */
  trailerProblems: readonly TrailerProblem[];
  /** Pushed when that answer changes, and only then. */
  readonly trailerEvents: SessionEventSource;
};

/**
 * The services the daemon uses, and only those. Node's full set also builds a
 * terminal, which hooks stdin every time it is built and which a daemon never
 * reads.
 */
const daemonServices = Layer.provideMerge(
  NodeChildProcessSpawner.layer,
  Layer.mergeAll(NodeFileSystem.layer, NodeCrypto.layer, NodePath.layer),
);

type DaemonServices = Layer.Success<typeof daemonServices>;

/**
 * Built once for the daemon's whole life, on first use, so a CLI that only
 * imports this module never builds it.
 */
const nodeRuntime = ManagedRuntime.make(daemonServices);

const runNode = <A, E>(effect: Effect.Effect<A, E, DaemonServices>) => nodeRuntime.runPromise(effect);

/** A long-lived fiber on the daemon's services: a watcher, which ends only when interrupted. */
const forkNode = (effect: Effect.Effect<void, never, DaemonServices>) => nodeRuntime.runFork(effect);

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

/** How old an overlay a board may be served before the daemon lists again. */
const agentsFreshnessMilliseconds = 30_000;

/**
 * Claude Code writes a session's file on every status change, so a busy machine
 * touches the registry constantly. The watcher's own settle collapses one
 * burst; this holds the recompute back until the machine goes quiet.
 */
const agentsDebounceMilliseconds = 1_000;

/** What a board follows as its files change, and what the agent sources fire. */
const watchDirectory = (directory: string, events: SessionEventSource) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.watch(directory, { recursive: true }).pipe(
      Stream.runForEach(() => Effect.sync(() => events.changed())),
    );
  }).pipe(
    Effect.catchCause((cause) => Effect.logError(`Watch stopped for ${directory}`, cause)),
  );

/** A commit, an amend, a rebase or a push writes Git's logs in a burst. */
const trailerSettle = '500 millis';

/**
 * When a worktree's trailers are worth reading again: once at the start, to
 * catch up on whatever landed while nothing was watching; on a change to its
 * session, which can make a named item exist or bring one back; on a commit,
 * which Git records in the worktree's own reflog; and on a push, which moves a
 * remote-tracking ref in the logs the repository shares and is what takes a
 * commit out of the unpushed range. A log that does not exist yet is not
 * watched.
 */
const trailerTriggers = (session: WorktreeSession) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    const watched = [
      { directory: session.directory, recursive: true },
      ...(session.git === null ? [] : [
        { directory: join(session.git.directory, 'logs'), recursive: false },
        { directory: join(session.git.common, 'logs', 'refs', 'remotes'), recursive: true },
      ]),
    ];
    const streams: Array<Stream.Stream<null, PlatformError>> = [Stream.succeed(null)];
    for (const { directory, recursive } of watched) {
      if (yield* fs.exists(directory)) {
        streams.push(fs.watch(directory, { recursive }).pipe(Stream.map(() => null)));
      }
    }
    return Stream.mergeAll(streams, { concurrency: 'unbounded' });
  });

/**
 * One worktree's trailer passes, one at a time: a burst of triggers is answered
 * by one pass once it settles, and whatever happens during a pass by one pass
 * after it.
 */
const reconcileLoop = (session: WorktreeSession, pass: Effect.Effect<void>) =>
  Effect.gen(function*() {
    const triggers = yield* trailerTriggers(session);
    yield* triggers.pipe(Stream.debounce(trailerSettle), Stream.runForEach(() => pass));
  }).pipe(
    Effect.catchCause((cause) => Effect.logError(`Trailer passes stopped for ${session.directory}`, cause)),
  );

/**
 * When this worktree last did something, and what did it: the newest of a
 * Claude Code session's status change, a Codex thread's update, and the newest
 * item file. A status time says when a status last changed and nothing else,
 * so it can date activity but never prove a session is alive, and an old one
 * is an agent holding still rather than an agent gone. A tie goes to an agent,
 * which is the more specific answer.
 */
const activityOf = (overlay: AgentsSummary, lastChange: string | null): Activity | null => {
  let best: Activity | null = null;
  let bestMoment = Number.NEGATIVE_INFINITY;
  const consider = (at: string | null, kind: Activity['kind']) => {
    if (at === null) return;
    const moment = Date.parse(at);
    if (Number.isNaN(moment)) return;
    if (moment < bestMoment) return;
    if (moment === bestMoment && kind === 'items') return;
    best = { at, kind };
    bestMoment = moment;
  };
  for (const session of overlay.claude) consider(session.statusChangedAt, 'claude');
  for (const thread of overlay.codex) consider(thread.updatedAt, 'codex');
  consider(lastChange, 'items');
  return best;
};

// eslint-disable-next-line max-lines-per-function -- The registry, its routes and its lifecycle are one object; the closures share the map.
export const runDaemon = async () => {
  const [settings, stamp] = await Promise.all([runNode(daemonSettings), runNode(sourceStamp)]);
  const startedAt = DateTime.formatIso(await Effect.runPromise(DateTime.now));
  const tracked = new Map<string, Tracked>();

  // The agents overlay is derived, never owned: one listing for every tracked
  // worktree, kept only so a board and the index can read the same answer.
  let agents: { at: number; byPath: ReadonlyMap<string, AgentsSummary> } = { at: 0, byPath: new Map() };
  const agentsEvents = makeSessionEvents(0);
  const worktreeEvents = makeSessionEvents(0);

  /**
   * Stamped with the moment it started, so a slow listing that lands after a
   * newer one cannot put older rows back on the board.
   */
  const listAgents = async () => {
    const at = await runNode(Clock.currentTimeMillis);
    try {
      const byPath = await runNode(agentsFor([...tracked.keys()]));
      if (at >= agents.at) agents = { at, byPath };
    } catch (error) {
      console.error(`The agent listing failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  /**
   * Lists again only once the cached overlay is old. The watcher lists before
   * it announces a change, so the refetch that announcement causes is served
   * from the cache rather than spawning the listings a second time.
   */
  const freshenAgents = async () => {
    const now = await runNode(Clock.currentTimeMillis);
    if (now - agents.at > agentsFreshnessMilliseconds) await listAgents();
  };

  /** What a board is served: the cached overlay, listed again once it is old. */
  const overlayFor = async (path: string): Promise<AgentsSummary> => {
    await freshenAgents();
    return agents.byPath.get(path) ?? await runNode(notListed);
  };

  /**
   * One watcher for both agent sources. Claude Code's registry and Codex's
   * writer locks are the two places a change to the overlay shows up, and a
   * change to either re-lists everything once: the sources answer for the whole
   * machine in one spawn, so there is nothing finer to recompute.
   */
  const watchAgents = async () => {
    const directories = await runNode(watchedDirectories);
    if (directories.length === 0) return;
    const changes = makeSessionEvents();
    let pending: ReturnType<typeof setTimeout> | undefined;
    changes.subscribe(() => {
      if (pending !== undefined) clearTimeout(pending);
      pending = setTimeout(() => {
        pending = undefined;
        void listAgents().then(() => agentsEvents.changed());
      }, agentsDebounceMilliseconds);
    });
    for (const directory of directories) forkNode(watchDirectory(directory, changes));
  };

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

  /**
   * One trailer pass for a tracked worktree. It announces on the worktree's own
   * trailers stream, never on its files stream, so a pass is not a trigger for
   * the next one.
   */
  const reconcile = async (path: string) => {
    const entry = tracked.get(path);
    if (entry === undefined) return;
    try {
      const problems = await runNode(reconcileTrailers({ worktree: entry.path, repository: entry.repository }));
      if (Equal.equals(problems, entry.trailerProblems)) return;
      entry.trailerProblems = problems;
      entry.trailerEvents.changed();
      worktreeEvents.changed();
    } catch (error) {
      // The session could not be read; its board already says so. The last
      // answer stands until a pass can be made.
      console.error(`${entry.path}: trailers not reconciled: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const untrack = (path: string) => {
    const entry = tracked.get(path);
    if (entry === undefined) return;
    // Out of the map first: the watcher's own finalizer asks whether this path
    // is still tracked, and the answer by then has to be no.
    tracked.delete(path);
    Effect.runFork(entry.watcher.pipe(Fiber.interrupt));
    Effect.runFork(entry.trailerLoop.pipe(Fiber.interrupt));
    entry.events.close();
    entry.trailerEvents.close();
  };

  /** In the caller's order: the first worktree to claim a key owns it. */
  const insert = (path: string, session: WorktreeSession, repository: SessionRepository) => {
    if (tracked.has(path)) return;
    const key = encodeWorktreeKey(session.worktree.name);
    const owner = [...tracked.values()].find((entry) => entry.key === key);
    const conflict = owner === undefined ? null : `The key ${key} already belongs to ${owner.path}.`;
    if (conflict !== null) console.error(`${path}: ${conflict}`);
    const events = makeSessionEvents();
    tracked.set(path, {
      path,
      key,
      session,
      repository,
      conflict,
      handler: undefined,
      events,
      watcher: forkNode(watchDirectory(session.directory, events)),
      trailerLoop: forkNode(reconcileLoop(session, Effect.promise(() => reconcile(path)))),
      trailerProblems: [],
      trailerEvents: makeSessionEvents(0),
    });
  };

  /**
   * A worktree belongs on the index while it exists and owns a real `.session`
   * directory. A symlink is somebody else's session, and a missing one means
   * the worktree has left: `session open` there is what brings it back.
   */
  const isTrackable = (path: string) =>
    runNode(
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem;
        const session = join(path, '.session');
        if (Option.isSome(yield* fs.readLink(session).pipe(Effect.option))) return false;
        if (!(yield* fs.exists(session))) return false;
        return (yield* fs.stat(session)).type === 'Directory';
      }).pipe(Effect.orElseSucceed(() => false)),
    );

  /**
   * A tracked worktree whose session has gone leaves the index by itself: no
   * button, no next `open`. The check is the same one that let it in.
   */
  const dropIfGone = async (path: string) => {
    if (!tracked.has(path)) return;
    if (await isTrackable(path)) return;
    untrack(path);
    await persist();
    worktreeEvents.changed();
  };

  /**
   * A directory cannot watch itself out of existence: on macOS a watch on a
   * directory that is removed delivers nothing at all, not even the removal of
   * the files inside it, so the signal has to come from one level up. One
   * non-recursive watch per directory that holds tracked worktrees, which is a
   * handful for twenty worktrees, and any change in one re-asks whether the
   * worktrees under it are still there.
   */
  const parentWatchers = new Map<string, Fiber.Fiber<void, never>>();

  const dropGoneUnder = async (parent: string) => {
    const under = [...tracked.keys()].filter((path) => dirname(path) === parent);
    await Promise.all(under.map((path) => dropIfGone(path)));
  };

  const watchParent = (parent: string) =>
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem;
      yield* fs.watch(parent, { recursive: false }).pipe(
        Stream.runForEach(() => Effect.promise(() => dropGoneUnder(parent))),
      );
    }).pipe(
      Effect.catchCause((cause) => Effect.logError(`Watch stopped for ${parent}`, cause)),
    );

  /**
   * Watch the directories that hold tracked worktrees, and only those. It runs
   * where worktrees are taken on, never where one is dropped: a watcher must
   * not be interrupted from inside its own callback.
   */
  const syncParentWatchers = () => {
    const parents = new Set([...tracked.keys()].map((path) => dirname(path)));
    for (const [parent, fiber] of parentWatchers) {
      if (parents.has(parent)) continue;
      Effect.runFork(fiber.pipe(Fiber.interrupt));
      parentWatchers.delete(parent);
    }
    for (const parent of parents) {
      if (parentWatchers.has(parent)) continue;
      parentWatchers.set(parent, forkNode(watchParent(parent)));
    }
  };

  /**
   * Every tracked worktree, re-asked at once. The watchers above push the
   * common case; this is what makes the answer right whatever happened, and
   * the index is the one read that would otherwise show a row that is gone.
   */
  const sweepTracked = async () => {
    const checked = await mapWorktrees([...tracked.keys()], async (path) => ({
      path,
      gone: !(await isTrackable(path)),
    }));
    const gone = checked.filter((entry) => entry.gone);
    if (gone.length === 0) return;
    for (const entry of gone) untrack(entry.path);
    await persist();
    worktreeEvents.changed();
  };

  /**
   * Resolve every new path at once, then take them in order. A path arrives
   * from a local client, so the daemon only ever tracks what it can serve.
   */
  const track = async (paths: ReadonlyArray<string>) => {
    const fresh: string[] = [];
    for (const path of new Set(paths.map((entry) => resolve(entry)))) {
      if (!tracked.has(path)) fresh.push(path);
    }
    const checked = await mapWorktrees(fresh, async (path) => ({
      path,
      usable: await isTrackable(path),
    }));
    const usable: string[] = [];
    for (const entry of checked) if (entry.usable) usable.push(entry.path);
    const described = await mapWorktrees(usable, async (path) => {
      const session = await runNode(resolveWorktreeSession(path));
      return { path, session, repository: await runNode(makeRepository(session.directory)) };
    });
    for (const entry of described) insert(entry.path, entry.session, entry.repository);
    syncParentWatchers();
  };

  /** Git knows the siblings; a worktree joins the index once it has a session. */
  const discover = async () => {
    const known = [...tracked.values()];
    const probed = await mapWorktrees(known, async (entry) => {
      const [trackable, siblings] = await Promise.all([
        isTrackable(entry.path),
        runNode(listGitWorktrees(entry.path).pipe(Effect.orElseSucceed(() => []))),
      ]);
      return { entry, trackable, siblings };
    });
    const candidates = new Set<string>();
    for (const item of probed) {
      // Its siblings are still worth knowing even as this one leaves.
      if (!item.trackable) untrack(item.entry.path);
      for (const sibling of item.siblings) candidates.add(sibling.path);
    }
    const sessions = await mapWorktrees([...candidates], async (path) => ({
      path,
      ready: await isTrackable(path),
    }));
    const ready: string[] = [];
    for (const candidate of sessions) if (candidate.ready) ready.push(candidate.path);
    await track(ready);
    await persist();
  };

  const summarize = async (entry: Tracked): Promise<WorktreeSummary> => {
    const counts: Record<Stage, number> = { TRIAGE: 0, DESIGN: 0, BATCH: 0, QUEUE: 0, EXECUTE: 0 };
    // The overlay comes from the listing the route just ran, so every row on
    // one index answer describes the same moment.
    const overlay = agents.byPath.get(entry.path) ?? await runNode(notListed);
    const base = {
      key: entry.key,
      name: entry.session.worktree.name,
      path: entry.path,
      branch: entry.session.worktree.branch,
      agents: overlay,
      trailerProblems: entry.trailerProblems,
    };
    try {
      const metadata = await runNode(refreshWorktreeMetadata(entry.session.worktree));
      const loaded = await runNode(
        Effect.all({ session: entry.repository.load, lastChange: entry.repository.lastChange }),
      );
      for (const stage of loaded.session.stages) counts[stage.stage] = stage.items.length;
      // The batch in Execute names the work under way; a batch with no name is
      // nothing to render, so it reads as an empty Execute rather than a blank.
      const execute = loaded.session.stages.find((stage) => stage.stage === 'EXECUTE');
      const batch = execute?.items[0]?.batch ?? null;
      return {
        ...base,
        branch: metadata.branch,
        executing: batch === null || batch === '' ? null : batch,
        counts,
        lastChange: loaded.lastChange,
        activity: activityOf(overlay, loaded.lastChange),
        conflict: entry.conflict,
      };
    } catch (error) {
      // A row that cannot be read is a row that cannot be served; say why.
      return {
        ...base,
        executing: null,
        counts,
        lastChange: null,
        activity: activityOf(overlay, null),
        conflict: entry.conflict ?? (error instanceof Error ? error.message : String(error)),
      };
    }
  };

  const handlerFor = async (entry: Tracked) => {
    if (entry.handler !== undefined) return entry.handler;
    await runNode(ensureSession(entry.session));
    entry.handler = await runNode(makeRequestHandler({
      repository: entry.repository,
      distDirectory,
      worktree: entry.session.worktree,
      events: entry.events,
      agents: {
        read: () => overlayFor(entry.path),
        focus: (pid) => runNode(focus(pid)),
        events: agentsEvents,
      },
      trailers: { read: () => entry.trailerProblems, events: entry.trailerEvents },
    }));
    return entry.handler;
  };

  const board = async (request: Request, url: URL) => {
    const rest = url.pathname.slice('/w/'.length);
    const entry = [...tracked.values()]
      .toSorted((left, right) => right.key.length - left.key.length)
      .find((candidate) => rest === candidate.key || rest.startsWith(`${candidate.key}/`));
    if (entry === undefined) return json({ error: 'No such worktree.' }, 404);
    if (entry.conflict !== null) return json({ error: entry.conflict }, 409);
    // Relative, so the address the browser used (a proxy's, or the raw port) is kept.
    if (rest === entry.key) return new Response(null, { status: 307, headers: { location: `/w/${entry.key}/` } });
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
      if (request.method === 'GET' && url.pathname === '/api/events') {
        return eventStream([
          { name: 'agents', events: agentsEvents },
          { name: 'worktrees', events: worktreeEvents },
        ]);
      }
      if (request.method === 'GET' && url.pathname === '/api/worktrees') {
        await sweepTracked();
        await freshenAgents();
        return json(await mapWorktrees([...tracked.values()], (entry) => summarize(entry)));
      }
      // The index has no board to scope this to, and the session it acts on may
      // be in any worktree it lists, so the root serves the board's own route.
      if (request.method === 'POST' && url.pathname === '/api/agents/focus') {
        return await focusResponse({ request, focus: (pid) => runNode(focus(pid)) });
      }
      if (request.method === 'POST' && url.pathname === '/api/worktrees/refresh') {
        const body = await request.json().catch(() => ({}));
        const path = typeof body === 'object' && body !== null && 'path' in body ? body.path : undefined;
        if (typeof path === 'string') await track([path]);
        await discover();
        await listAgents();
        const rows = await mapWorktrees([...tracked.values()], (entry) => summarize(entry));
        worktreeEvents.changed();
        return json(rows);
      }
      if (url.pathname === '/w' || url.pathname.startsWith('/w/')) return await board(request, url);
      return await staticFile(url, request.method);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'Unexpected daemon error.' }, 500);
    }
  };

  const previous = await runNode(readState(settings));
  await track(previous?.worktrees ?? []);
  await watchAgents();

  // SSE streams are quiet between events; Bun would close them after ten seconds.
  const server = serve({ hostname: '127.0.0.1', port: settings.port, idleTimeout: 0, fetch: handle });
  await persist();
  console.log(`Session daemon: http://127.0.0.1:${server.port} (pid ${process.pid})`);
  console.log(`Sources: ${stamp}`);
};

if (import.meta.main) await runDaemon();
