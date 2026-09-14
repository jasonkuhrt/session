import { join, resolve } from 'node:path';
import type * as Cause from 'effect/Cause';
import * as Effect from 'effect/Effect';
import * as FileSystem from 'effect/FileSystem';
import * as Queue from 'effect/Queue';
import * as Schema from 'effect/Schema';
import * as Stream from 'effect/Stream';
import * as ChildProcess from 'effect/unstable/process/ChildProcess';

/**
 * A conversation with one `codex app-server`, for the length of one refresh.
 * The wire is newline-delimited JSON with no envelope version: a request
 * carries an id, a notification does not, and the server may say things nobody
 * asked for, so a reply is found by its id and everything else is ignored.
 */

const repositoryRoot = resolve(import.meta.dir, '../../..');

/** Enough to see what is live in a worktree without becoming a log. */
const perWorktree = 3;

/**
 * Runs, not sessions to go to, are left out: `exec` and the subagent kinds.
 * What remains is what a person opened, in the Desktop, an editor or the CLI.
 */
const interactiveKinds = ['cli', 'vscode', 'appServer'];

/** Only the fields the board renders; a newer server may send many more. */
export const ThreadSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String.pipe(Schema.NullOr, Schema.optionalKey),
  preview: Schema.String.pipe(Schema.NullOr, Schema.optionalKey),
  source: Schema.String.pipe(Schema.NullOr, Schema.optionalKey),
  originator: Schema.String.pipe(Schema.NullOr, Schema.optionalKey),
  updatedAt: Schema.Finite.pipe(Schema.NullOr, Schema.optionalKey),
  recencyAt: Schema.Finite.pipe(Schema.NullOr, Schema.optionalKey),
});
export type ThreadRow = typeof ThreadSchema.Type;

const ListReplySchema = Schema.Struct({
  result: Schema.Struct({ data: Schema.Array(ThreadSchema) }),
});

const PackageJson = Schema.Struct({
  version: Schema.String.pipe(Schema.optionalKey),
}).pipe(Schema.fromJsonString);

/** The board names itself to the app-server; the version is this project's. */
const clientVersion = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const manifest = yield* Schema.decodeEffect(PackageJson)(
    yield* fs.readFileString(join(repositoryRoot, 'package.json')),
  );
  return manifest.version ?? '0.0.0';
}).pipe(Effect.orElseSucceed(() => '0.0.0'));

const encoder = new TextEncoder();

const parseLine = (line: string): Record<string, unknown> | null => {
  try {
    const parsed: unknown = JSON.parse(line);
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
};

/**
 * `useStateDbOnly` is what makes this a listing and not a repair pass: without
 * it the same query walks every rollout on disk, three seconds instead of six
 * milliseconds. `recency_at` ordering with a small limit is what keeps the
 * board a working set instead of a log that only grows.
 */
const listRequest = (id: number, cwd: string) => ({
  id,
  method: 'thread/list',
  params: {
    cwd: [cwd],
    archived: false,
    useStateDbOnly: true,
    sourceKinds: interactiveKinds,
    sortKey: 'recency_at',
    sortDirection: 'desc',
    limit: perWorktree,
  },
});

/** A live app-server: a line in, the reply to a line, and the way to let it go. */
const connect = Effect.gen(function*() {
  const outbox = yield* Queue.make<Uint8Array, Cause.Done>();
  const handle = yield* ChildProcess.make('codex', ['app-server'], {
    // Spawned at the root because every filter it is sent is an absolute
    // realpath; a relative one would resolve against the daemon's directory.
    cwd: '/',
    stdin: Stream.fromQueue(outbox),
    stderr: 'ignore',
  });
  const inbox = yield* Queue.make<string, Cause.Done>();
  yield* Effect.forkScoped(
    handle.stdout.pipe(
      Stream.decodeText(),
      Stream.splitLines,
      Stream.runForEach((line) => Queue.offer(inbox, line)),
      Effect.andThen(Queue.end(inbox)),
    ),
  );
  return {
    send: (message: unknown) =>
      Queue.offer(outbox, encoder.encode(`${JSON.stringify(message)}\n`)),
    reply: (id: number) =>
      Effect.gen(function*() {
        while (true) {
          const message = parseLine(yield* Queue.take(inbox));
          if (message !== null && message['id'] === id) return message;
        }
      }),
    // Closing stdin asks the server to stop. Nothing waits for it to comply:
    // the rows are already in hand, and the scope kills a server that lingers,
    // so a slow exit can never turn a successful listing into a timeout.
    finish: Queue.end(outbox),
  };
});

/**
 * One spawn, one handshake, one `thread/list` per worktree, keyed back to the
 * path the daemon tracks. A worktree whose reply cannot be read lists nothing
 * rather than failing the refresh for the others.
 */
export const listThreads = (roots: ReadonlyMap<string, string>) =>
  Effect.scoped(
    Effect.gen(function*() {
      const version = yield* clientVersion;
      const codex = yield* connect;
      yield* codex.send({
        id: 1,
        method: 'initialize',
        params: { clientInfo: { name: 'session', title: 'Session board', version } },
      });
      yield* codex.reply(1);
      yield* codex.send({ method: 'initialized' });

      const byWorktree = new Map<string, ReadonlyArray<ThreadRow>>();
      let id = 1;
      for (const [path, real] of roots) {
        id += 1;
        yield* codex.send(listRequest(id, real));
        const decoded = yield* Schema.decodeUnknownEffect(ListReplySchema)(
          yield* codex.reply(id),
        ).pipe(Effect.orElseSucceed(() => null));
        byWorktree.set(path, decoded === null ? [] : decoded.result.data);
      }
      yield* codex.finish;
      return byWorktree;
    }),
  );
