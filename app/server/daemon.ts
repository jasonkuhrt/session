import { closeSync, openSync } from 'node:fs';
import { basename, delimiter, dirname, join, resolve } from 'node:path';
import * as NodeChildProcessSpawner from '@effect/platform-node/NodeChildProcessSpawner';
import * as NodeCrypto from '@effect/platform-node/NodeCrypto';
import * as NodeFileSystem from '@effect/platform-node/NodeFileSystem';
import * as NodePath from '@effect/platform-node/NodePath';
import { file, serve, spawn } from 'bun';
import * as Cause from 'effect/Cause';
import * as Clock from 'effect/Clock';
import * as Config from 'effect/Config';
import * as Crypto from 'effect/Crypto';
import * as Data from 'effect/Data';
import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';
import * as Equal from 'effect/Equal';
import * as Exit from 'effect/Exit';
import * as Fiber from 'effect/Fiber';
import * as FileSystem from 'effect/FileSystem';
import * as Layer from 'effect/Layer';
import * as ManagedRuntime from 'effect/ManagedRuntime';
import * as Option from 'effect/Option';
import type { PlatformError } from 'effect/PlatformError';
import * as Result from 'effect/Result';
import * as Schema from 'effect/Schema';
import * as Semaphore from 'effect/Semaphore';
import * as Stream from 'effect/Stream';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';
import * as HttpClient from 'effect/unstable/http/HttpClient';
import * as HttpClientRequest from 'effect/unstable/http/HttpClientRequest';
import type {
  Activity,
  AgentsSummary,
  DaemonCapabilities,
  DaemonInfo,
  EpicRename,
  EpicRenamed,
  EpicWrite,
  IssuesReport,
  Links,
  OrderWrite,
  PullRequestReports,
  Stage,
  TrailerProblem,
  WorktreeEpic,
  WorktreeRank,
  WorktreeSummary,
} from '../contract.ts';
import { DaemonInfoSchema, daemonPort, encodeWorktreeKey, WorktreeSummarySchema } from '../contract.ts';
import { agentsFor, notListed, watchedDirectories } from './agents/index.ts';
import { focus } from './cmux.ts';
import { renameEpic, setWorktreeEpic } from './epic.ts';
import { makeSessionEvents, type SessionEventSource } from './events.ts';
import {
  epicResponse,
  eventStream,
  focusResponse,
  makeRequestHandler,
  namedChannels,
  openResponse,
  orderResponse,
  renameResponse,
  shellResponse,
} from './http.ts';
import { archiveDirectory, contextDirectory, ignoreDirectory, ledgerDirectory, metaDirectory } from './layout.ts';
import {
  checkedOutBranch,
  issuesFor,
  type PullRequestReading,
  pullRequestFor,
  pullRequestReport,
} from './links/index.ts';
import { setRank } from './order.ts';
import { aliasHostnames } from './portless.ts';
import { makeRepository, RepositoryError, type SessionRepository } from './repository.ts';
import { cmuxOnPath, openTerminal } from './terminal.ts';
import { reconcileTrailers } from './trailers.ts';
import { gitRepositoryVariables } from './git.ts';
import {
  checkoutIn,
  ensureSession,
  listRepositories,
  type RepositoryListing,
  repositoryIn,
  resolveWorktreeSession,
  type WorktreeSession,
} from './worktree.ts';
import { openInZed, zedOnPath } from './zed.ts';

/* eslint-disable max-lines -- One process boundary: its state file, its registry, its routes and the client that upserts it belong in one place. */

/**
 * One daemon per user on 127.0.0.1. It serves the index of tracked worktrees at
 * `/`, one board per worktree under `/w/<key>/`, and pushes a `changed` event
 * per worktree whose `.session` moves underneath it.
 */

const repositoryRoot = resolve(import.meta.dir, '../..');
/** What `bun run build` writes for the browser: the shell every page is, and the assets it names. */
const distDirectory = join(repositoryRoot, 'app/dist/client');
const shellFile = join(distDirectory, '_shell.html');
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

/**
 * What a daemon leaves for the next one: the worktrees it tracks. Who a daemon
 * is, it says itself on the port, so nothing here names one.
 */
const DaemonStateSchema = Schema.Struct({
  worktrees: Schema.Array(Schema.String),
});
const DaemonStateJson = Schema.fromJsonString(DaemonStateSchema);
const DaemonInfoJson = Schema.fromJsonString(DaemonInfoSchema);
const WorktreeRowsJson = WorktreeSummarySchema.pipe(Schema.Array, Schema.fromJsonString);
const DaemonRefusalJson = Schema.fromJsonString(Schema.Struct({ error: Schema.String }));
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

/**
 * Written whole, through a neighbour renamed into place, so a reader, the next
 * daemon or a command asking which worktrees are tracked, never reads half a
 * file, which it would take for none. Every write has a neighbour of its own,
 * removed when the write fails, so two writes never rename one file.
 */
const writeState = (settings: DaemonSettings, state: DaemonState) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    const crypto = yield* Crypto.Crypto;
    yield* fs.makeDirectory(settings.directory, { recursive: true });
    const temp = join(settings.directory, `.daemon.json.${yield* crypto.randomUUIDv4}.tmp`);
    yield* fs.writeFileString(temp, yield* Schema.encodeEffect(DaemonStateJson)(state)).pipe(
      Effect.andThen(fs.rename(temp, settings.statePath)),
      Effect.onError(() => fs.remove(temp).pipe(Effect.ignore)),
    );
  });

/**
 * The worktrees the daemon tracks, as its state file lists them: what a
 * running daemon wrote on its last change, and what the next one tracks again.
 * A command reads it to know a worktree's siblings, which are tracked ones;
 * none when no daemon has written it.
 */
export const trackedPaths = Effect.gen(function*() {
  const state = yield* readState(yield* daemonSettings);
  return state?.worktrees ?? [];
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

type Environment = Readonly<Record<string, string | undefined>>;

/**
 * What Claude Code, Codex, cmux and Git set for the processes they run, which
 * the daemon drops: the ones that change what a command it runs does, or that
 * hold a session's credentials. The user's own settings stay.
 * - Claude Code's session, down to the socket and token that message it, and
 *   `AI_AGENT`, its word to other tools that an agent is running them. Claude
 *   Code reads its settings again as it starts, from `CLAUDE_CONFIG_DIR`,
 *   which is kept.
 * - What Codex sets for the commands it runs: its session and thread, its
 *   version, its sandbox, permission profile and network proxy, and how it was
 *   installed. Its settings, such as `CODEX_HOME`, stay.
 * - The Anthropic API's credentials, which nothing the daemon runs uses.
 * - cmux's terminal: the workspace and surface its CLI takes as the target of
 *   every command, and the socket path the CLI finds without being told. It
 *   keeps `CMUX_SOCKET_PASSWORD` and `CMUX_SOCKET_CAPABILITY`, with which a
 *   process outside cmux's own, as the detached daemon is, reaches its socket.
 * - The repository Git names for the hooks it runs, the variables
 *   `git rev-parse --local-env-vars` lists, which would aim every Git command
 *   the daemon runs at that one repository.
 */
const dropped = {
  names: new Set([
    'AI_AGENT',
    'CODEX_SESSION_ID',
    'CODEX_THREAD_ID',
    'CODEX_VERSION',
    'CODEX_PERMISSION_PROFILE',
    ...gitRepositoryVariables,
  ]),
  prefixes: ['CLAUDE', 'ANTHROPIC', 'CMUX_', 'CODEX_APPLY_PATCH_', 'CODEX_SANDBOX', 'CODEX_NETWORK_', 'CODEX_MANAGED_'],
  except: new Set(['CLAUDE_CONFIG_DIR', 'CMUX_SOCKET_PASSWORD', 'CMUX_SOCKET_CAPABILITY']),
};

const isDropped = (name: string) =>
  !dropped.except.has(name) &&
  (dropped.names.has(name) || dropped.prefixes.some((prefix) => name.startsWith(prefix)));

/**
 * `NODE_OPTIONS` as the user set it. When cmux launches Claude Code it points
 * `NODE_OPTIONS` at a module in a temporary directory, keeping the user's own
 * value in `CMUX_ORIGINAL_NODE_OPTIONS` and whether there was one in
 * `CMUX_ORIGINAL_NODE_OPTIONS_PRESENT`; this undoes that as the module does.
 */
const userNodeOptions = (environment: Environment): string | null => {
  switch (environment['CMUX_ORIGINAL_NODE_OPTIONS_PRESENT']) {
    case '1': {
      const original = environment['CMUX_ORIGINAL_NODE_OPTIONS'] ?? '';
      return original === '' ? null : original;
    }
    case '0': {
      return null;
    }
    default: {
      return environment['NODE_OPTIONS'] ?? null;
    }
  }
};

/** The `node_modules/.bin` of a directory and of each directory above it. */
const binsAbove = (directory: string) => {
  const bins = new Set<string>();
  for (let current = directory; !bins.has(join(current, 'node_modules/.bin')); current = dirname(current)) {
    bins.add(join(current, 'node_modules/.bin'));
  }
  return bins;
};

/**
 * PATH without the `node_modules/.bin` of the command's directory and the
 * directories above it, which a package runner puts first, so a repository's
 * own copy of a tool never stands in for the user's. A relative entry is made
 * absolute against the command's directory, since the daemon runs in another.
 */
const userPath = (input: { readonly path: string; readonly cwd: string }) => {
  const bins = binsAbove(input.cwd);
  return input.path
    .split(delimiter)
    .map((entry) => resolve(input.cwd, entry))
    .filter((entry) => !bins.has(entry))
    .join(delimiter);
};

/**
 * The environment the daemon starts with: this command's, less the variables
 * above, since the daemon outlives whatever started it and passes its
 * environment to every gh, linear, claude, codex and cmux it runs. It serves
 * the port and keeps the state this command resolved, whatever its own
 * directory would make of a relative `SESSION_STATE_DIR`.
 */
const daemonEnvironment = (input: {
  readonly environment: Environment;
  readonly cwd: string;
  readonly settings: DaemonSettings;
}) => {
  const kept: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.environment)) {
    if (value === undefined || name === 'NODE_OPTIONS' || isDropped(name)) continue;
    kept[name] = value;
  }
  const nodeOptions = userNodeOptions(input.environment);
  if (nodeOptions !== null) kept['NODE_OPTIONS'] = nodeOptions;
  if (kept['PATH'] !== undefined) kept['PATH'] = userPath({ path: kept['PATH'], cwd: input.cwd });
  kept['SESSION_PORT'] = String(input.settings.port);
  kept['SESSION_STATE_DIR'] = input.settings.directory;
  return kept;
};

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
            env: daemonEnvironment({ environment: process.env, cwd: process.cwd(), settings }),
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

/** The daemon that came up from these sources, once it answers. */
const waitForDaemon = (settings: DaemonSettings, stamp: string) =>
  Effect.gen(function*() {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const probe = yield* probeDaemon(settings.port);
      if (probe.kind === 'ours' && probe.info.sourceStamp === stamp) return probe.info;
      yield* Effect.sleep('100 millis');
    }
    return yield* new DaemonError({
      message: `The daemon did not answer on port ${settings.port}. See ${settings.logPath}.`,
    });
  });

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

/**
 * Stop the daemon on the port and start one from these sources, answering the
 * one that came up. A daemon is known by what it answers on the port and by
 * nothing else: one that does not answer is gone or still starting, and a pid
 * remembered from before may by now be another process's. A port somebody else
 * holds is refused.
 */
const replaceDaemon = (input: {
  readonly settings: DaemonSettings;
  readonly probe: Probe;
  readonly stamp: string;
}) =>
  Effect.gen(function*() {
    if (input.probe.kind === 'foreign') {
      return yield* new DaemonError({
        message: `Port ${input.settings.port} is held by another process. Free it and try again.`,
      });
    }
    if (input.probe.kind === 'ours') yield* stopProcess(input.probe.info.pid);
    yield* waitForSilence(input.settings);
    yield* spawnDaemon(input.settings);
    return yield* waitForDaemon(input.settings, input.stamp);
  });

/**
 * Reuse a healthy daemon built from these sources; replace a stale one; start
 * one when none answers; refuse a port somebody else holds.
 */
export const ensureDaemon = Effect.gen(function*() {
  const { settings, probe } = yield* daemonOnPort;
  const stamp = yield* sourceStamp;
  if (probe.kind === 'ours' && probe.info.sourceStamp === stamp) return settings;
  yield* replaceDaemon({ settings, probe, stamp });
  return settings;
});

/**
 * What `session daemon status` reads: what holds the port, and the sources a
 * daemon started from this checkout would carry the stamp of.
 */
export const daemonStatus = Effect.gen(function*() {
  const { settings, probe } = yield* daemonOnPort;
  return { settings, probe, sources: { root: repositoryRoot, stamp: yield* sourceStamp } };
});

/**
 * `session daemon restart`: a daemon started afresh from this checkout's
 * sources, whether or not one was running and however current it was.
 * `stopped` is the one it replaced, null when none answered.
 */
export const restartDaemon = Effect.gen(function*() {
  const { settings, probe } = yield* daemonOnPort;
  const started = yield* replaceDaemon({ settings, probe, stamp: yield* sourceStamp });
  return { settings, root: repositoryRoot, stopped: probe.kind === 'ours' ? probe.info : null, started };
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

/**
 * Take a worktree on and answer the key its board is served under, read from
 * the worktree's own row in the rows the daemon answers with. A worktree the
 * daemon serves no board for, as when another took its name first, fails with
 * the daemon's reason, so `open` never prints the address of a board that is
 * another worktree's.
 */
export const boardKey = (input: { readonly settings: DaemonSettings; readonly path: string }) =>
  Effect.gen(function*() {
    const response = yield* trackWorktree(input);
    const text = yield* response.text.pipe(
      Effect.mapError((cause) => new DaemonError({ message: 'The daemon’s answer to the take-on could not be read.', cause })),
    );
    if (response.status !== 200) {
      const refused = yield* Schema.decodeEffect(DaemonRefusalJson)(text).pipe(Effect.option);
      return yield* new DaemonError({
        message: Option.isSome(refused) ? refused.value.error : `The daemon refused the take-on with ${response.status}.`,
      });
    }
    const rows = yield* Schema.decodeEffect(WorktreeRowsJson)(text).pipe(
      Effect.mapError((cause) => new DaemonError({ message: 'The daemon answered the take-on with something other than its rows.', cause })),
    );
    const row = rows.find((candidate) => candidate.path === input.path);
    if (row === undefined) {
      return yield* new DaemonError({
        message: `The daemon did not take ${input.path} on: its .session is a link rather than a directory of its own, ` +
          `or Git refused it, which ${input.settings.logPath} says.`,
      });
    }
    if (row.conflict !== null) return yield* new DaemonError({ message: row.conflict });
    return row.key;
  });

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
  /**
   * Why its board is not served: another tracked worktree owned its key when
   * it was taken on. The first worktree to claim a key owns it until it
   * leaves, and then the next one to have claimed it does, as a restart would
   * give it.
   */
  conflict: string | null;
  handler: ((request: Request) => Promise<Response>) | undefined;
  /** Every tracked worktree has these from the moment it is tracked: the
   *  watcher is what notices its session changing, for its boards and the
   *  index alike, which is not something a board being open can be a
   *  condition of. Its leaving is noticed a level up; see `parentWatchers`. */
  readonly events: SessionEventSource;
  readonly watcher: Fiber.Fiber<void, never>;
  /** The worktree's trailer passes and link re-reads, over one set of watches; see `worktreeLoops`. */
  readonly loops: Fiber.Fiber<void, never>;
  /** The last pass's answer; derived, and replaced by every pass that changes it. */
  trailerProblems: readonly TrailerProblem[];
  /** Pushed when that answer changes, and only then. */
  readonly trailerEvents: SessionEventSource;
  /**
   * What gh last said about the branch's pull request; null before the first
   * ask. One answer serves the index and the worktree's boards alike.
   */
  pullRequest: {
    readonly reading: PullRequestReading;
    /** When gh was asked, in epoch milliseconds. */
    readonly askedAt: number;
    /** `moves` as it stood when gh was asked; a move since makes the answer old. */
    readonly moves: number;
  } | null;
  /** The gh ask under way, which every caller in the meantime shares. */
  pullRequestRead: Promise<PullRequestReading> | undefined;
  /**
   * What linear last said about the issues the branch and a pull request
   * name, and the answer of gh's it read them from. Issues read from any
   * answer but gh's newest are old, so linear is asked again whenever gh is.
   */
  issues: { readonly report: IssuesReport; readonly from: PullRequestReading } | null;
  /** The linear ask under way and the answer of gh's it reads from; a caller reading from the same answer shares it. */
  issuesRead: { readonly from: PullRequestReading; readonly read: Promise<IssuesReport> } | undefined;
  /**
   * How many times, while the worktree was tracked, another branch was
   * checked out or the remote-tracking ref of the one gh answered for moved.
   */
  moves: number;
  /** Pushed to the worktree's boards after every ask of either source, because every ask moves a report's date. */
  readonly linksEvents: SessionEventSource;
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

/**
 * An agent moving items, or a lead joining its workers to an epic one command
 * each, writes sessions in a burst, and the index reads every row once it
 * settles: longer than a board's settle, since the index's read is every
 * board's, and short enough to follow a command at once.
 */
const indexSettleMilliseconds = 500;

/** Writes that never let the index's settle go quiet still reach it this often. */
const indexCeilingMilliseconds = 2_000;

/** How long a watch that stopped waits before it watches its directory again. */
const watchRestart = '2 seconds';

/**
 * A watch the daemon keeps for as long as its directory is there. When it
 * stops, on a failure of the platform's watch or of what a change set off, it
 * says why in the log and watches again a moment later, so one failure never
 * leaves a directory unwatched for the rest of the daemon's life. A directory
 * that has gone ends it quietly, and so does an interruption, which is how the
 * daemon lets a watch go.
 */
const keepWatching = <E, R>(
  directory: string,
  watch: Effect.Effect<void, E, R>,
): Effect.Effect<void, never, R | FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    const exit = yield* Effect.exit(watch);
    if (Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)) return;
    if (!(yield* fs.exists(directory).pipe(Effect.orElseSucceed(() => false)))) return;
    if (Exit.isFailure(exit)) yield* Effect.logError(`Watch stopped for ${directory}; watching it again`, exit.cause);
    yield* Effect.sleep(watchRestart);
    yield* keepWatching(directory, watch);
  });

/** What the agent sources fire: any change in the directories they keep. */
const watchDirectory = (directory: string, events: SessionEventSource) =>
  keepWatching(
    directory,
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem;
      yield* fs.watch(directory, { recursive: true }).pipe(
        Stream.runForEach(() => Effect.sync(() => events.changed())),
      );
    }),
  );

/**
 * The parts of a session the index shows nothing of: what agents keep in
 * `context/`, the ledger's entries, and the history under `archive/` and
 * `ignore/`. A change anywhere else can change a row: an item file moves its
 * counts, its batch and its newest item, `meta/epic` its epic, and
 * `meta/rank` its place.
 */
const indexQuiet: ReadonlySet<string> = new Set([contextDirectory, ledgerDirectory, archiveDirectory, ignoreDirectory]);

/** Whether a change under a session, by its path there, can change what the index shows of it. */
const showsOnIndex = (event: FileSystem.WatchEvent): boolean =>
  !indexQuiet.has(event.path.split(/[\\/]/u)[0] ?? '');

/**
 * A tracked worktree's session, watched once for both of its readers: its
 * boards follow every change, the pages under them included, and the index
 * the ones a row shows, which the daemon settles across every worktree before
 * the index reads its rows again.
 */
const watchSession = (directory: string, readers: {
  readonly boards: SessionEventSource;
  readonly index: SessionEventSource;
}) =>
  keepWatching(
    directory,
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem;
      yield* fs.watch(directory, { recursive: true }).pipe(
        Stream.runForEach((event) =>
          Effect.sync(() => {
            readers.boards.changed();
            if (showsOnIndex(event)) readers.index.changed();
          })
        ),
      );
    }),
  );

/** A commit, an amend, a rebase or a push writes Git's logs in a burst. */
const trailerSettle = '500 millis';

/**
 * Which of a worktree's watches a change came from. A remote-tracking ref's
 * change names the ref, by its log's path under `logs/refs/remotes`, such as
 * `origin/feat/x`.
 */
type Change =
  | { readonly kind: 'session' }
  | { readonly kind: 'reflog' }
  | { readonly kind: 'remotes'; readonly ref: string };

/**
 * The parts of a session no trailer depends on: what agents keep in
 * `context/`, the entries in `ledger/` and the facts in `meta/` can neither
 * make an item exist nor bring one back, so a change there never asks for a
 * pass that runs Git.
 */
const trailerQuiet: ReadonlySet<string> = new Set([contextDirectory, ledgerDirectory, metaDirectory]);

/** Whether a change under the session, by its path there, can affect a trailer pass. */
const touchesItems = (event: FileSystem.WatchEvent): boolean =>
  !trailerQuiet.has(event.path.split(/[\\/]/u)[0] ?? '');

/**
 * A worktree's watches, each change tagged with the watch it came from, as one
 * stream that both of its loops read: the trailer passes read every change,
 * and the link re-reads only the remote-tracking refs. It is shared, so each
 * directory is watched once however many loops follow it. The session outside
 * `context/`, `ledger/` and `meta/` can make a named item exist or bring one
 * back, and a change under those three is dropped here; the worktree's own
 * reflog is where Git records a commit; and the remote-tracking logs the
 * repository shares move on a push, which takes a commit out of the unpushed
 * range, and on a fetch that learned something new. A log that does not exist
 * yet is not watched.
 */
const worktreeChanges = (session: WorktreeSession) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    const watched: ReadonlyArray<{
      readonly directory: string;
      readonly recursive: boolean;
      readonly kind: Change['kind'];
    }> = [
      { directory: session.directory, recursive: true, kind: 'session' },
      ...(session.git === null ? [] : [
        { directory: join(session.git.directory, 'logs'), recursive: false, kind: 'reflog' as const },
        { directory: join(session.git.common, 'logs', 'refs', 'remotes'), recursive: true, kind: 'remotes' as const },
      ]),
    ];
    const streams: Array<Stream.Stream<Change, PlatformError>> = [];
    for (const { directory, recursive, kind } of watched) {
      if (yield* fs.exists(directory)) {
        streams.push(
          fs.watch(directory, { recursive }).pipe(
            Stream.filter((event) => kind !== 'session' || touchesItems(event)),
            Stream.map((event): Change => (kind === 'remotes' ? { kind, ref: event.path } : { kind })),
          ),
        );
      }
    }
    // Sliding, because a loop still busy with one answer needs only the latest change.
    return yield* Stream.mergeAll(streams, { concurrency: 'unbounded' }).pipe(
      Stream.share({ capacity: 16, strategy: 'sliding' }),
    );
  });

/**
 * One worktree's trailer passes, one at a time: once at the start, to catch up
 * on whatever landed while nothing was watching, and on every change after it.
 * A burst is answered by one pass once it settles, and whatever happens during
 * a pass by one pass after it.
 */
const reconcileLoop = (changes: Stream.Stream<Change, PlatformError>, pass: Effect.Effect<void>) =>
  Stream.succeed<Change | 'start'>('start').pipe(
    Stream.merge(changes),
    Stream.debounce(trailerSettle),
    Stream.runForEach(() => pass),
  );

/**
 * How old gh's answer for a worktree may be before gh is asked again. linear
 * is asked again whenever gh has been, so the issues are never older.
 */
const linksFreshnessMilliseconds = 60_000;

/** How often the clock asks whether a worktree's links have reached that age. */
const linksCheck = '10 seconds';

/** A push, a fetch or a checkout writes its logs in a burst; one ask answers it. */
const linksSettle = '500 millis';

type LinksTrigger = 'clock' | 'refs' | 'reflog';

/**
 * One worktree's link re-reads, one at a time: on the clock, when the
 * remote-tracking ref of the branch gh last answered for moves, and when the
 * worktree's own reflog does, which is where a checkout of another branch
 * shows up. A fetch that moves the repository's other refs is not a trigger,
 * because it moves no answer of this worktree's; every worktree of a
 * repository watches the same refs, and each would otherwise ask at once.
 * Nothing on this machine says that a check finished or a review landed, so
 * the clock is what keeps an open board or index current; nothing in the
 * session's files says anything about either, so the session's own changes
 * are never a trigger.
 */
const linksLoop = (changes: Stream.Stream<Change, PlatformError>, loops: {
  /** Whether a moved remote-tracking ref is the one of the branch gh last answered for. */
  readonly answeredRef: (ref: string) => boolean;
  readonly onTrigger: (trigger: LinksTrigger) => Effect.Effect<void>;
}) =>
  Stream.tick(linksCheck).pipe(
    Stream.map((): LinksTrigger => 'clock'),
    Stream.merge(
      changes.pipe(
        Stream.filter((change) => change.kind === 'remotes' && loops.answeredRef(change.ref)),
        Stream.debounce(linksSettle),
        Stream.map((): LinksTrigger => 'refs'),
      ),
    ),
    Stream.merge(
      changes.pipe(
        Stream.filter((change) => change.kind === 'reflog'),
        Stream.debounce(linksSettle),
        Stream.map((): LinksTrigger => 'reflog'),
      ),
    ),
    Stream.runForEach(loops.onTrigger),
  );

/**
 * A tracked worktree's two loops over its one set of watches, kept as one: a
 * loop's own work catches what it can fail at, so what stops one is its
 * watches, and then both stop, the watches close, and the pair starts again
 * as `keepWatching` has it. Interrupting it stops both and closes the watches.
 */
const worktreeLoops = (session: WorktreeSession, loops: {
  readonly pass: Effect.Effect<void>;
  readonly answeredRef: (ref: string) => boolean;
  readonly onLinksTrigger: (trigger: LinksTrigger) => Effect.Effect<void>;
}) =>
  keepWatching(
    session.directory,
    Effect.scoped(
      Effect.gen(function*() {
        const changes = yield* worktreeChanges(session);
        yield* Effect.all(
          [
            reconcileLoop(changes, loops.pass),
            linksLoop(changes, { answeredRef: loops.answeredRef, onTrigger: loops.onLinksTrigger }),
          ],
          { concurrency: 'unbounded', discard: true },
        );
      }),
    ),
  );

/**
 * gh's answer for a worktree, when it can be served as it is: asked within the
 * last minute, and not before a move. The moves are counted rather than timed,
 * because a move and the ask it causes can land in one millisecond.
 */
const freshPullRequest = (entry: Tracked, now: number) =>
  entry.pullRequest !== null &&
    entry.pullRequest.moves === entry.moves &&
    now - entry.pullRequest.askedAt < linksFreshnessMilliseconds
    ? entry.pullRequest.reading
    : null;

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

/**
 * A row's facts, each read on its own from its file in `meta/`, so a row whose
 * items or Git cannot be read keeps its epic and its place, and a file the
 * rules reject puts the row in no epic, or leaves it unranked, with the
 * sentence `check` gives, and the row is served all the same: the files are
 * about the index, not about the work.
 */
const rowFacts = (repository: SessionRepository) =>
  Effect.all({ epic: repository.epic.pipe(Effect.result), rank: repository.rank.pipe(Effect.result) }).pipe(
    Effect.map(({ epic, rank }) => ({
      epic: Result.isSuccess(epic) ? epic.success : null,
      epicProblem: Result.isFailure(epic) ? epic.failure.message : null,
      rank: Result.isSuccess(rank) ? rank.success : null,
      rankProblem: Result.isFailure(rank) ? rank.failure.message : null,
    })),
  );

/** Why a worktree has no board: another tracked worktree owns the key its name gives it. */
const keyConflict = (input: { readonly path: string; readonly key: string; readonly owner: string }) =>
  `${input.path} has no board: its key ${input.key} already belongs to ${input.owner}.`;

/**
 * A file of the built app, and the shell for a path without an extension,
 * which is a page the app draws itself. Nothing outside the build is served.
 */
const staticFile = async (url: URL, method: string) => {
  if (method !== 'GET' && method !== 'HEAD') return json({ error: 'Method not allowed.' }, 405);
  const requested = url.pathname.slice(1);
  if (!requested.includes('.')) return await shellResponse({ shell: shellFile, method });
  const path = resolve(distDirectory, requested);
  if (path !== distDirectory && !path.startsWith(`${distDirectory}/`)) {
    return json({ error: 'Not found.' }, 404);
  }
  const candidate = file(path);
  if (!(await candidate.exists())) return json({ error: 'Not found.' }, 404);
  return method === 'HEAD' ? new Response(null) : new Response(candidate);
};

// eslint-disable-next-line max-lines-per-function -- The registry, its routes and its lifecycle are one object; the closures share the map.
export const runDaemon = async () => {
  const [settings, stamp] = await Promise.all([runNode(daemonSettings), runNode(sourceStamp)]);
  const startedAt = DateTime.formatIso(await Effect.runPromise(DateTime.now));
  const tracked = new Map<string, Tracked>();
  /**
   * The paths held until Git answers, each with Git's line: ones the state
   * file or a take-on named that Git could not be asked about, or would not
   * answer for, as when it cannot run. They stay in the state file, are served
   * as rows no repository holds, and are asked about again at every take-on
   * and rescan. A path Git refuses is not held, nor one whose session is gone.
   */
  const unresolved = new Map<string, string>();

  // The agents overlay is derived, never owned: one listing for every tracked
  // worktree, kept only so a board and the index can read the same answer.
  let agents: { at: number; byPath: ReadonlyMap<string, AgentsSummary> } = { at: 0, byPath: new Map() };
  const agentsEvents = makeSessionEvents({ settle: 0 });
  const worktreeEvents = makeSessionEvents({ settle: 0 });
  /**
   * A change under any tracked worktree's session that a row shows, settled
   * across all of them, since the index reads every row again, and passed on
   * to it as `worktrees`: without it the index learnt of new counts, a batch
   * or an epic only when something unrelated made it read.
   */
  const sessionChanges = makeSessionEvents({ settle: indexSettleMilliseconds, ceiling: indexCeilingMilliseconds });
  sessionChanges.subscribe(() => worktreeEvents.changed());
  /** Pushed after gh is asked about any tracked worktree, to the index, which shows every row's pull request. */
  const pullRequestEvents = makeSessionEvents();
  /**
   * The asks the index starts wait here for a turn, this many at once: the
   * index wants every row, and a process per row at once is the fan-out
   * `worktreeConcurrency` exists to prevent. A board's own asks do not wait
   * behind them, since a board wants one answer, now.
   */
  const indexAsks = Semaphore.makeUnsafe(worktreeConcurrency);

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

  /**
   * The tracked set as it is when the write starts, one write at a time, so
   * worktrees dropped together each write the file whole, the last standing.
   */
  const persistence = Semaphore.makeUnsafe(1);
  const persist = () =>
    runNode(persistence.withPermit(Effect.suspend(() =>
      writeState(settings, { worktrees: [...tracked.keys(), ...unresolved.keys()] })
    )));

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

  /**
   * Ask gh again. An ask is shared by every caller that arrives while it runs,
   * so a page opening mid-ask waits for this answer rather than starting a
   * second one, and every ask is pushed to the worktree's boards and to the
   * index.
   */
  const askPullRequest = (entry: Tracked): Promise<PullRequestReading> => {
    if (entry.pullRequestRead !== undefined) return entry.pullRequestRead;
    const read = (async () => {
      try {
        const asked = await runNode(Effect.gen(function*() {
          const moves = entry.moves;
          const askedAt = yield* Clock.currentTimeMillis;
          const reading = yield* pullRequestFor({ path: entry.path, git: entry.session.git !== null });
          return { reading, askedAt, moves };
        }));
        entry.pullRequest = asked;
        entry.linksEvents.changed();
        pullRequestEvents.changed();
        return asked.reading;
      } finally {
        entry.pullRequestRead = undefined;
      }
    })();
    entry.pullRequestRead = read;
    return read;
  };

  /** gh's answer while it is fresh, else a new ask. */
  const currentPullRequest = async (entry: Tracked): Promise<PullRequestReading> =>
    freshPullRequest(entry, await runNode(Clock.currentTimeMillis)) ?? await askPullRequest(entry);

  /**
   * Ask linear about the issues the branch and one answer of gh's name. An ask
   * from the same answer is shared. Issues read from an answer that is no
   * longer gh's newest go back to their caller but are not kept, so they can
   * never replace issues read from a newer one.
   */
  const askIssues = (entry: Tracked, from: PullRequestReading): Promise<IssuesReport> => {
    if (entry.issuesRead?.from === from) return entry.issuesRead.read;
    const read = (async () => {
      try {
        const report = await runNode(issuesFor({
          worktree: { path: entry.path, git: entry.session.git !== null },
          pullRequest: from,
        }));
        if (entry.pullRequest?.reading === from) {
          entry.issues = { report, from };
          entry.linksEvents.changed();
        }
        return report;
      } finally {
        if (entry.issuesRead?.from === from) entry.issuesRead = undefined;
      }
    })();
    entry.issuesRead = { from, read };
    return read;
  };

  /**
   * What a board is served: gh's answer while it is fresh, else a new ask, and
   * the issues read from that same answer, else a new ask of linear.
   */
  const linksOf = async (entry: Tracked): Promise<Links> => {
    const reading = await currentPullRequest(entry);
    const issues = entry.issues?.from === reading ? entry.issues.report : await askIssues(entry, reading);
    return { pullRequest: pullRequestReport(reading), issues };
  };

  /** Whether the index is listening, and so wants this worktree's pull request; a row that is not served shows none. */
  const indexWants = (entry: Tracked) => entry.conflict === null && pullRequestEvents.watched();

  /**
   * One row's pull request for the index, asked in its turn, and only if by
   * then a page still wants it and it is still old: a page that closed while
   * the ask waited spawns nothing, and a board that asked in the meantime has
   * already answered it.
   */
  const freshenForIndex = (entry: Tracked) =>
    runNode(indexAsks.withPermit(Effect.promise(async () => {
      if (!indexWants(entry) && !entry.linksEvents.watched()) return;
      if (freshPullRequest(entry, await runNode(Clock.currentTimeMillis)) !== null) return;
      await askPullRequest(entry);
    })));

  /** Whether a moved remote-tracking ref, named as `<remote>/<branch>`, is the one of the branch gh last answered for. */
  const answeredRef = (path: string, ref: string) => {
    const branch = tracked.get(path)?.pullRequest?.reading.branch ?? null;
    return branch !== null && ref.slice(ref.indexOf('/') + 1) === branch;
  };

  /**
   * Whether a trigger moved the worktree's answer: a moved ref always did,
   * since it was filtered to the answered branch's own; a reflog change did
   * when another branch is checked out now than the one gh answered for.
   */
  const moved = async (entry: Tracked, trigger: LinksTrigger) => {
    if (trigger === 'refs') return true;
    if (trigger === 'clock' || entry.pullRequest === null) return false;
    return (await runNode(checkedOutBranch(entry.path))) !== entry.pullRequest.reading.branch;
  };

  /**
   * What a trigger does to a worktree's links. A move makes the last answer
   * old whether or not anything listens, so the next page to open asks again.
   * With no page listening, which is no board of the worktree open and no
   * index open, nothing is asked. With a board open, gh is asked again once
   * its answer is no longer fresh, after any ask already under way, which may
   * have begun before the move, and linear whenever gh's answer is newer than
   * the issues; with only the index open, gh is asked in the index's turn.
   */
  const onLinksTrigger = async (path: string, trigger: LinksTrigger) => {
    const entry = tracked.get(path);
    if (entry === undefined) return;
    try {
      if (await moved(entry, trigger)) entry.moves += 1;
      const board = entry.linksEvents.watched();
      if (!board && !indexWants(entry)) return;
      await entry.pullRequestRead;
      if (board) await linksOf(entry);
      else await freshenForIndex(entry);
    } catch (error) {
      // The pages already show the last answer; the next trigger tries again.
      console.error(`${entry.path}: links not read: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  /**
   * Ask gh about every row the index shows whose answer is not fresh, as an
   * index begins to listen: each answer is pushed to it as it lands, and none
   * can land before the stream that announces it.
   */
  const freshenPullRequests = async () => {
    const now = await runNode(Clock.currentTimeMillis);
    const stale = [...tracked.values()].filter((entry) =>
      entry.conflict === null && freshPullRequest(entry, now) === null
    );
    await Promise.all(stale.map(async (entry) => {
      try {
        await freshenForIndex(entry);
      } catch (error) {
        console.error(`${entry.path}: pull request not read: ${error instanceof Error ? error.message : String(error)}`);
      }
    }));
  };

  /** gh's last answer for every row the index shows, by the worktree's path; a worktree not yet asked about is absent. */
  const pullRequestReports = (): PullRequestReports =>
    Object.fromEntries(
      [...tracked.values()].flatMap((entry) =>
        entry.conflict === null && entry.pullRequest !== null
          ? [[entry.path, pullRequestReport(entry.pullRequest.reading)]]
          : []
      ),
    );

  const untrack = (path: string) => {
    const entry = tracked.get(path);
    if (entry === undefined) return;
    // Out of the map first, so a trailer pass or a link re-read already under
    // way finds nothing to write its answer to.
    tracked.delete(path);
    Effect.runFork(entry.watcher.pipe(Fiber.interrupt));
    Effect.runFork(entry.loops.pipe(Fiber.interrupt));
    entry.events.close();
    entry.trailerEvents.close();
    entry.linksEvents.close();
    // A key it owned passes to the next worktree that claimed it, as a restart
    // would give it, so that one's board is served, and any others still
    // waiting on the key name their new owner.
    if (entry.conflict !== null) return;
    const claimants = [...tracked.values()].filter((candidate) => candidate.key === entry.key);
    const [next, ...waiting] = claimants;
    if (next === undefined) return;
    next.conflict = null;
    for (const claimant of waiting) claimant.conflict = keyConflict({ path: claimant.path, key: entry.key, owner: next.path });
  };

  /** In the caller's order: the first worktree to claim a key owns it. */
  const insert = (path: string, session: WorktreeSession, repository: SessionRepository) => {
    if (tracked.has(path)) return;
    const key = encodeWorktreeKey(session.worktree.name);
    const owner = [...tracked.values()].find((entry) => entry.key === key);
    const conflict = owner === undefined ? null : keyConflict({ path, key, owner: owner.path });
    if (conflict !== null) console.error(conflict);
    const events = makeSessionEvents();
    tracked.set(path, {
      path,
      key,
      session,
      repository,
      conflict,
      handler: undefined,
      events,
      watcher: forkNode(watchSession(session.directory, { boards: events, index: sessionChanges })),
      loops: forkNode(worktreeLoops(session, {
        pass: Effect.promise(() => reconcile(path)),
        answeredRef: (ref) => answeredRef(path, ref),
        onLinksTrigger: (trigger) => Effect.promise(() => onLinksTrigger(path, trigger)),
      })),
      trailerProblems: [],
      trailerEvents: makeSessionEvents({ settle: 0 }),
      pullRequest: null,
      pullRequestRead: undefined,
      issues: null,
      issuesRead: undefined,
      moves: 0,
      linksEvents: makeSessionEvents({ settle: 0 }),
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

  /**
   * A failed drop is logged rather than thrown into the watch that asked for
   * it: the watch goes on, and the next change there, or the next read of the
   * index, asks again.
   */
  const dropGoneUnder = async (parent: string) => {
    const under = [...tracked.keys()].filter((path) => dirname(path) === parent);
    try {
      await Promise.all(under.map((path) => dropIfGone(path)));
    } catch (error) {
      console.error(`${parent}: a worktree that has gone was not dropped: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const watchParent = (parent: string) =>
    keepWatching(
      parent,
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem;
        yield* fs.watch(parent, { recursive: false }).pipe(
          Stream.runForEach(() => Effect.promise(() => dropGoneUnder(parent))),
        );
      }),
    );

  /**
   * Watch the directories that hold tracked worktrees, and only those, and
   * watch again one whose watch has ended, as it does when its directory went
   * away for a while. It runs where worktrees are taken on, never where one is
   * dropped: a watcher must not be interrupted from inside its own callback.
   */
  const syncParentWatchers = () => {
    const parents = new Set([...tracked.keys()].map((path) => dirname(path)));
    for (const [parent, fiber] of parentWatchers) {
      if (parents.has(parent)) continue;
      Effect.runFork(fiber.pipe(Fiber.interrupt));
      parentWatchers.delete(parent);
    }
    for (const parent of parents) {
      const watcher = parentWatchers.get(parent);
      if (watcher !== undefined && watcher.pollUnsafe() === undefined) continue;
      parentWatchers.set(parent, forkNode(watchParent(parent)));
    }
  };

  /**
   * Every tracked worktree, and every path held until Git answers, re-asked
   * at once. The watchers above push the common case; this is what makes the
   * answer right whatever happened, and the index is the one read that would
   * otherwise show a row that is gone.
   */
  const sweepTracked = async () => {
    const checked = await mapWorktrees([...tracked.keys(), ...unresolved.keys()], async (path) => ({
      path,
      gone: !(await isTrackable(path)),
    }));
    const gone = checked.filter((entry) => entry.gone);
    if (gone.length === 0) return;
    for (const entry of gone) {
      untrack(entry.path);
      unresolved.delete(entry.path);
    }
    await persist();
    worktreeEvents.changed();
  };

  /**
   * Resolve every new path at once, then take them in order. A path arrives
   * from a local client, the state file or Git's listing, so the daemon only
   * ever tracks what it can serve. A path Git refuses, such as a linked
   * worktree moved by hand, is let go, with the reason on the log. A path Git
   * could not answer for is held with Git's line, which keeps it in the state
   * file, and is asked about again at the next take-on or rescan. Neither
   * keeps the other paths out, or the daemon from starting.
   */
  const track = async (paths: ReadonlyArray<string>) => {
    const fresh: string[] = [];
    for (const path of new Set(paths.map((entry) => resolve(entry)))) {
      if (!tracked.has(path)) fresh.push(path);
    }
    const checked = await mapWorktrees(fresh, async (path) => ({ path, usable: await isTrackable(path) }));
    const usable: string[] = [];
    for (const entry of checked) {
      if (entry.usable) usable.push(entry.path);
      else unresolved.delete(entry.path);
    }
    const described = await mapWorktrees(usable, async (path) => {
      const resolved = await runNode(resolveWorktreeSession(path).pipe(Effect.result));
      if (Result.isSuccess(resolved)) {
        const session = resolved.success;
        return [{ path, session, repository: await runNode(makeRepository(session.directory)) }];
      }
      const { failure } = resolved;
      if (failure.kind === 'refused') {
        unresolved.delete(path);
        console.error(`${path}: not tracked: ${failure.message}`);
      } else {
        unresolved.set(path, failure.message);
        console.error(`${path}: held until Git answers: ${failure.message}`);
      }
      return [];
    });
    for (const entry of described.flat()) {
      unresolved.delete(entry.path);
      insert(entry.path, entry.session, entry.repository);
    }
    syncParentWatchers();
  };

  /**
   * Git knows the siblings, all but the main worktree of a submodule or a
   * separate Git directory, which Git lists by that directory, so only a
   * command run in it takes it on. A worktree joins the index once it has a
   * session, and every path held until Git answers is asked about again.
   */
  const discover = async () => {
    const known = [...tracked.values()];
    const [probed, listings] = await Promise.all([
      mapWorktrees(known, async (entry) => ({ entry, trackable: await isTrackable(entry.path) })),
      runNode(listRepositories({ sessions: known.map((entry) => entry.session), concurrency: worktreeConcurrency })),
    ]);
    for (const item of probed) if (!item.trackable) untrack(item.entry.path);
    // A repository's worktrees are still worth knowing even as one of them leaves.
    const candidates = new Set<string>();
    for (const listing of listings.values()) {
      if (Result.isSuccess(listing)) for (const sibling of listing.success) candidates.add(sibling.path);
    }
    const sessions = await mapWorktrees([...candidates], async (path) => ({
      path,
      ready: await isTrackable(path),
    }));
    const ready: string[] = [];
    for (const candidate of sessions) if (candidate.ready) ready.push(candidate.path);
    await track([...unresolved.keys(), ...ready]);
    await persist();
  };

  /**
   * One row of the index. What the worktree has checked out, and the
   * repository it belongs to with what that repository's main worktree has
   * checked out, come from its repository's listing, which the route asked
   * once for all of that repository's rows. Its epic and its rank are read on
   * their own, as `rowFacts` has it. Whether it is main was settled by Git
   * when it was taken on, since a path that is its repository's main worktree
   * stays one for as long as it exists.
   */
  const summarize = async (entry: Tracked, listings: ReadonlyMap<string, RepositoryListing>): Promise<WorktreeSummary> => {
    const counts: Record<Stage, number> = { Triage: 0, Design: 0, Batch: 0, Queue: 0, Execute: 0 };
    // The overlay comes from the listing the route just ran, so every row on
    // one index answer describes the same moment.
    const overlay = agents.byPath.get(entry.path) ?? await runNode(notListed);
    const facts = await runNode(rowFacts(entry.repository));
    const base = {
      key: entry.key,
      name: entry.session.worktree.name,
      path: entry.path,
      branch: entry.session.worktree.branch,
      detached: entry.session.worktree.detached,
      agents: overlay,
      trailerProblems: entry.trailerProblems,
      ...facts,
      main: entry.session.worktree.main,
      resolved: true,
      repository: repositoryIn({ listings, session: entry.session }),
    };
    try {
      const checkout = Result.getOrThrow(checkoutIn({ listings, session: entry.session }));
      const loaded = await runNode(
        Effect.all({ session: entry.repository.load, lastChange: entry.repository.lastChange }),
      );
      for (const stage of loaded.session.stages) counts[stage.stage] = stage.items.length;
      // The batch in Execute names the work under way; a batch with no name is
      // nothing to render, so it reads as an empty Execute rather than a blank.
      const execute = loaded.session.stages.find((stage) => stage.stage === 'Execute');
      const batch = execute?.items[0]?.group ?? null;
      return {
        ...base,
        ...checkout,
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

  /**
   * The row of a path held until Git answers: Git's line as why it is not
   * served, and the agents in it, but nothing only Git could say, so it names
   * no repository, and it is no folder outside Git either.
   */
  const unresolvedRow = async ([path, line]: readonly [string, string]): Promise<WorktreeSummary> => {
    const overlay = agents.byPath.get(path) ?? await runNode(notListed);
    const name = basename(path);
    return {
      key: encodeWorktreeKey(name),
      name,
      path,
      branch: null,
      detached: false,
      executing: null,
      counts: { Triage: 0, Design: 0, Batch: 0, Queue: 0, Execute: 0 },
      lastChange: null,
      activity: activityOf(overlay, null),
      conflict: line,
      agents: overlay,
      trailerProblems: [],
      epic: null,
      epicProblem: null,
      rank: null,
      rankProblem: null,
      main: false,
      resolved: false,
      repository: null,
    };
  };

  /**
   * Every row of the index, from one `git worktree list` per repository rather
   * than one per row, and a row for every path held until Git answers.
   */
  const summaries = async () => {
    const rows = [...tracked.values()];
    const listings = await runNode(
      listRepositories({ sessions: rows.map((entry) => entry.session), concurrency: worktreeConcurrency }),
    );
    const served = await mapWorktrees(rows, (entry) => summarize(entry, listings));
    return [...served, ...(await mapWorktrees([...unresolved], unresolvedRow))];
  };

  const handlerFor = async (entry: Tracked) => {
    if (entry.handler !== undefined) return entry.handler;
    await runNode(ensureSession(entry.session));
    entry.handler = await runNode(makeRequestHandler({
      repository: entry.repository,
      shell: shellFile,
      session: entry.session,
      events: entry.events,
      agents: {
        read: () => overlayFor(entry.path),
        focus: (pid) => runNode(focus(pid)),
        events: agentsEvents,
      },
      trailers: { read: () => entry.trailerProblems, events: entry.trailerEvents },
      links: { read: () => linksOf(entry), events: entry.linksEvents },
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

  /**
   * The names portless routes to this daemon, kept once seen: an alias
   * registered after the daemon started is answered from its first request.
   */
  const aliases = new Set<string>();

  /**
   * The addresses this daemon answers at: its own port on 127.0.0.1 and on
   * localhost, and its portless alias. A request naming any other host is
   * refused before any route runs, so a page elsewhere that points a name of
   * its own at this machine can read nothing from it.
   */
  const answersTo = async (host: string | null): Promise<boolean> => {
    if (host === null || !URL.canParse(`http://${host}`)) return false;
    const { hostname, port } = new URL(`http://${host}`);
    if ((hostname === '127.0.0.1' || hostname === 'localhost') && port === String(settings.port)) return true;
    if (aliases.has(hostname)) return true;
    for (const alias of await runNode(aliasHostnames(settings.port))) aliases.add(alias);
    return aliases.has(hostname);
  };

  /** Who the daemon is, which the CLI checks, and what it can do for a page, which a page checks. */
  const describe = async (): Promise<DaemonInfo & DaemonCapabilities> => ({
    pid: process.pid,
    port: settings.port,
    startedAt,
    sourceStamp: stamp,
    terminal: await runNode(cmuxOnPath),
    zed: await runNode(zedOnPath),
  });

  /**
   * A tracked worktree that is still there. One whose session has gone opens
   * nothing and leaves the index at once, rather than send a path cmux or Zed
   * cannot open, which Zed would read as a file and open in the window of
   * another worktree.
   */
  const liveWorktree = async (path: string): Promise<Tracked | null> => {
    const entry = tracked.get(resolve(path));
    if (entry === undefined) return null;
    if (await isTrackable(entry.path)) return entry;
    await dropIfGone(entry.path);
    return null;
  };

  /** A terminal in a tracked worktree; undefined for a path the daemon does not track or that is gone. */
  const terminalAt = async (path: string) => {
    const entry = await liveWorktree(path);
    return entry === null
      ? undefined
      : await runNode(openTerminal({ path: entry.path, worktrees: [...tracked.keys()] }));
  };

  /** Zed on a tracked worktree; undefined for a path the daemon does not track or that is gone. */
  const zedAt = async (path: string) => {
    const entry = await liveWorktree(path);
    return entry === null ? undefined : await runNode(openInZed(entry.path));
  };

  /**
   * One write of a fact at a time, a worktree's epic or its place, since an
   * epic write takes a rank away and a placement reads the ranks of an epic's
   * worktrees: two drags, in two tabs, never interleave. A command writes in
   * its own process, which the engine's re-read before every placement meets.
   */
  const factWrites = Semaphore.makeUnsafe(1);

  /**
   * Set a worktree's epic for the index's drags, as `session join` and
   * `session leave` set it, by the worktree's path, as a terminal and Zed are
   * asked for: every row the index lists has one of its own, served or not,
   * so no key two rows share can send a write to the wrong worktree. The write
   * is refused when the file names another epic than the one the index read. A
   * path the daemon does not track, or whose session has gone, is not written,
   * and a session is never brought back by it. Nothing else is converged:
   * `meta/epic` depends on no stage, so an old session that every command
   * refuses can still be dragged into an epic and out of one, and `setEpic`
   * makes `meta/` itself. The watch on the session is what tells the index.
   */
  const setEpicAt = async (input: EpicWrite): Promise<WorktreeEpic> => {
    const entry = await liveWorktree(input.path);
    if (entry === null) {
      throw new RepositoryError({ kind: 'not-found', message: 'The daemon tracks no worktree at that path; reload the index.' });
    }
    await runNode(factWrites.withPermit(setWorktreeEpic({
      session: entry.session,
      repository: entry.repository,
      epic: input.epic,
      from: input.from,
    })));
    return { epic: input.epic === null ? null : input.epic.trim() };
  };

  /**
   * Rename an epic for the index's rename icon: every tracked worktree in it
   * takes the new name, under the lock the other fact writes take, and the
   * worktrees the daemon tracks say whether the name was another epic's.
   */
  const renameAt = (input: EpicRename): Promise<EpicRenamed> =>
    runNode(factWrites.withPermit(renameEpic({ from: input.from, to: input.to, tracked: [...tracked.values()] })));

  /**
   * Place a worktree among its siblings for the index's drags, as `session
   * order` places it, by the worktree's path, as its epic is set: a path the
   * daemon does not track, or whose session has gone, is not written, and a
   * sibling is one of the worktrees it tracks, so `before` must name one of
   * them. The rank's file depends on no stage, so nothing is converged first.
   * The watch on each session it writes is what tells the index.
   */
  const setRankAt = async (input: OrderWrite): Promise<WorktreeRank> => {
    const entry = await liveWorktree(input.path);
    if (entry === null) {
      throw new RepositoryError({ kind: 'not-found', message: 'The daemon tracks no worktree at that path; reload the index.' });
    }
    const placed = await runNode(factWrites.withPermit(setRank({
      worktree: entry,
      tracked: [...tracked.values()],
      before: input.before === null ? null : resolve(input.before),
      after: input.after.map((path) => resolve(path)),
    })));
    return { rank: placed.rank };
  };

  /**
   * The index's stream. It subscribes as it is made, so an index that listens
   * for pull requests hears every answer to the asks it starts.
   */
  const indexEvents = (url: URL) => {
    const channels = namedChannels({
      url,
      channels: [
        { name: 'agents', events: agentsEvents },
        { name: 'worktrees', events: worktreeEvents },
        { name: 'pull-requests', events: pullRequestEvents },
      ],
    });
    const stream = eventStream(channels);
    if (channels.some((channel) => channel.name === 'pull-requests')) void freshenPullRequests();
    return stream;
  };

  /**
   * The writes the root takes, by their path: the ones a board and the index
   * both make, and the index's drags, each for a worktree named by its path.
   * - The index has no board to scope a focus to, and the session it acts on
   *   may be in any worktree it lists, so the root serves the board's own route.
   * - A board and the index both ask for a terminal, and for Zed, by the
   *   worktree's path.
   * - The index's drags set a worktree's epic, and its place, by its path, as a
   *   terminal is asked for.
   */
  const rootWrites: ReadonlyMap<string, (request: Request) => Promise<Response>> = new Map([
    ['/api/agents/focus', (request) => focusResponse({ request, focus: (pid) => runNode(focus(pid)) })],
    ['/api/terminal', (request) => openResponse({ request, open: terminalAt })],
    ['/api/zed', (request) => openResponse({ request, open: zedAt })],
    ['/api/worktrees/epic', (request) => epicResponse({ request, write: setEpicAt })],
    ['/api/worktrees/rename', (request) => renameResponse({ request, write: renameAt })],
    ['/api/worktrees/order', (request) => orderResponse({ request, write: setRankAt })],
  ]);

  const handle = async (request: Request): Promise<Response> => {
    try {
      if (!(await answersTo(request.headers.get('host')))) {
        return json({
          error: `This daemon answers only at 127.0.0.1:${settings.port}, localhost:${settings.port} and its portless name.`,
        }, 403);
      }
      const url = new URL(request.url);
      if (request.method === 'GET' && url.pathname === '/api/daemon') return json(await describe());
      if (request.method === 'GET' && url.pathname === '/api/events') return indexEvents(url);
      if (request.method === 'GET' && url.pathname === '/api/pull-requests') return json(pullRequestReports());
      if (request.method === 'GET' && url.pathname === '/api/worktrees') {
        await sweepTracked();
        await freshenAgents();
        return json(await summaries());
      }
      const write = request.method === 'POST' ? rootWrites.get(url.pathname) : undefined;
      if (write !== undefined) return await write(request);
      if (request.method === 'POST' && url.pathname === '/api/worktrees/refresh') {
        const body = await request.json().catch(() => ({}));
        const path = typeof body === 'object' && body !== null && 'path' in body ? body.path : undefined;
        if (typeof path === 'string') await track([path]);
        await discover();
        await listAgents();
        const rows = await summaries();
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
