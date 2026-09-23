import { join } from 'node:path';
import * as Cause from 'effect/Cause';
import * as Config from 'effect/Config';
import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';
import * as FileSystem from 'effect/FileSystem';
import * as Option from 'effect/Option';
import type { ChildProcessSpawner } from 'effect/unstable/process/ChildProcessSpawner';
import type { CodexThread } from '../../contract.ts';
import { capture } from '../command.ts';
import { listThreads, type ThreadRow } from './app-server.ts';
import { realPaths } from '../paths.ts';

/**
 * The Codex threads under a worktree.
 *
 * One rule makes this listing true rather than plausible: the thread status the
 * app-server reports is meaningful only inside the process that holds the
 * thread, so a spawned server calls a thread the Desktop is mid-turn on
 * `notLoaded`. It is never read. Whether a thread is loaded somewhere is the
 * writer lock it holds, which any process can see, and that is all this claims.
 */

/**
 * Threads per tracked worktree path, and what could not be answered about
 * them. Two things can fail independently: the listing itself, and the writer
 * locks that say which threads are open, so the notices are a list.
 */
export type CodexListing = {
  readonly byWorktree: ReadonlyMap<string, ReadonlyArray<CodexThread>>;
  readonly notices: ReadonlyArray<string>;
};

const unavailable = 'Codex is not installed, so its threads are not listed.';
const timedOut = 'Codex did not answer in time, so its threads are not listed.';
const locksUnreadable = "Codex's writer locks could not be read, so which threads are open is unknown.";

/** Spawn, handshake and one query per worktree; measured at 75 ms for two. */
const budget = '3 seconds';

/** `~/.codex/thread-writer-locks`. The daemon watches it, so it is named here. */
export const lockDirectory = Effect.gen(function*() {
  return join(yield* Config.String('HOME'), '.codex/thread-writer-locks');
}).pipe(Effect.orElseSucceed(() => null));

/**
 * `lsof` names the pid holding each lock, which a directory listing cannot: a
 * process that died leaves its file behind until the next thread is loaded. An
 * unreadable directory is not "nothing is loaded", so it answers `null` and the
 * board says nothing at all about those threads.
 */
const loadedIds = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const directory = yield* lockDirectory;
  if (directory === null) return null;
  if (!(yield* fs.exists(directory))) return new Set<string>();
  const result = yield* capture({
    command: 'lsof',
    args: ['+D', directory, '-F', 'pn'],
    timeout: '5 seconds',
  }).pipe(Effect.orElseSucceed(() => null));
  if (result === null) return null;
  // Nothing open under the directory is exit 1 with nothing to say; a real
  // complaint means the answer is unknown rather than empty.
  if (result.exitCode !== 0 && result.stderr !== '') return null;
  const held = new Set<string>();
  for (const line of result.stdout.split('\n')) {
    if (!line.startsWith('n') || !line.endsWith('.lock')) continue;
    held.add(line.slice(line.lastIndexOf('/') + 1, -'.lock'.length));
  }
  return held;
}).pipe(Effect.orElseSucceed(() => null));

/** A thread's own name, else the first line of what was said to it. */
const nameOf = (thread: ThreadRow): string => {
  const named = thread.name?.trim();
  if (named !== undefined && named !== '') return named;
  const preview = thread.preview?.split('\n')[0]?.trim();
  return preview === undefined || preview === '' ? thread.id : preview;
};

/** Where the thread is being worked: the Desktop reports itself as an editor. */
const originOf = (thread: ThreadRow): string => {
  if (thread.originator === 'Codex Desktop' || thread.source === 'vscode') return 'Desktop';
  return thread.source === 'cli' ? 'CLI' : 'app-server';
};

/** Recency in whole seconds on the wire; a millisecond value is taken as it is. */
const updatedAtOf = (thread: ThreadRow): string => {
  const stamp = thread.recencyAt ?? thread.updatedAt ?? 0;
  return DateTime.make(Math.abs(stamp) < 1e12 ? stamp * 1000 : stamp).pipe(
    Option.map((moment) => DateTime.formatIso(moment)),
    Option.getOrElse(() => DateTime.formatIso(DateTime.makeUnsafe(0))),
  );
};

const describe = (thread: ThreadRow, loaded: ReadonlySet<string> | null): CodexThread => {
  const isLoaded = loaded === null ? null : loaded.has(thread.id);
  return {
    id: thread.id,
    name: nameOf(thread),
    origin: originOf(thread),
    updatedAt: updatedAtOf(thread),
    loaded: isLoaded,
    link: `codex://threads/${thread.id}`,
    // Resuming a thread another process holds fails on that process's writer
    // lock, so the command is offered only where it would work.
    resume: isLoaded === false ? `codex resume ${thread.id}` : null,
  };
};

const empty = new Map<string, ReadonlyArray<ThreadRow>>();

/**
 * A failed spawn and a stalled one are told apart because they mean different
 * things to the person reading the board: Codex is missing, or Codex is busy.
 */
const rows = (roots: ReadonlyMap<string, string>) =>
  listThreads(roots).pipe(
    Effect.timeout(budget),
    Effect.map((byWorktree) => ({ byWorktree, notice: null as string | null })),
    Effect.catch((error) =>
      Effect.succeed({ byWorktree: empty, notice: Cause.isTimeoutError(error) ? timedOut : unavailable }),
    ),
    Effect.catchCause(() => Effect.succeed({ byWorktree: empty, notice: unavailable })),
  );

/** The listing for every tracked worktree, or the reason there is none. */
export const codexThreads = (
  worktrees: ReadonlyArray<string>,
): Effect.Effect<CodexListing, never, FileSystem.FileSystem | ChildProcessSpawner> =>
  Effect.gen(function*() {
    const roots = yield* realPaths(worktrees);
    const [listing, loaded] = yield* Effect.all([rows(roots), loadedIds], { concurrency: 2 });
    const byWorktree = new Map<string, ReadonlyArray<CodexThread>>();
    for (const [path, threads] of listing.byWorktree) {
      byWorktree.set(path, threads.map((thread) => describe(thread, loaded)));
    }
    // A thread carries `loaded: null` when the locks could not be read. That is
    // an answer the rows cannot give on their own, so the reason is said once
    // here rather than left as an `unknown` nobody can account for.
    const notices = [listing.notice, loaded === null ? locksUnreadable : null].filter(
      (notice) => notice !== null,
    );
    return { byWorktree, notices };
  }).pipe(
    Effect.catchCause(() =>
      Effect.succeed({
        byWorktree: new Map<string, ReadonlyArray<CodexThread>>(),
        notices: [unavailable],
      }),
    ),
  );
