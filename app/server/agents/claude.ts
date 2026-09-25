import { join } from 'node:path';
import * as Config from 'effect/Config';
import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';
import * as FileSystem from 'effect/FileSystem';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';
import type { ChildProcessSpawner } from 'effect/unstable/process/ChildProcessSpawner';
import type { ClaudeSession, ContextFill } from '../../contract.ts';
import { capture } from '../command.ts';
import { terminalsFor, type Terminal } from '../cmux.ts';
import { ownerOf, realPaths } from '../paths.ts';
import { contextOf } from './transcript.ts';

/**
 * The Claude Code sessions under a worktree, from Claude Code's own listing.
 * `claude agents --json` is the supported way to read session state from
 * outside, and it already drops sessions whose process is gone, so nothing here
 * second-guesses liveness. Two files beside it are read for each live session,
 * for what the listing omits: its registry file, for when its status last
 * changed and where its name came from, and the tail of its transcript, for
 * what is in its context.
 */

type Services = FileSystem.FileSystem | ChildProcessSpawner;

/** Sessions per tracked worktree path, and why the list may be empty. */
export type ClaudeListing = {
  readonly byWorktree: ReadonlyMap<string, ReadonlyArray<ClaudeSession>>;
  readonly notice: string | null;
};

const unavailable = 'Claude Code did not answer, so its sessions are not listed.';

/** One spawn of a 200 MB executable; slower than this is a machine in trouble. */
const budget = '5 seconds';

/**
 * Only what the board renders. `cwd`, `kind` and `startedAt` are documented as
 * always present; everything else depends on the kind of session, and an
 * unknown field is ignored so a newer Claude Code still lists.
 */
const RowSchema = Schema.Struct({
  cwd: Schema.String,
  kind: Schema.String,
  startedAt: Schema.Finite,
  pid: Schema.Int.pipe(Schema.optionalKey),
  id: Schema.String.pipe(Schema.optionalKey),
  sessionId: Schema.String.pipe(Schema.optionalKey),
  name: Schema.String.pipe(Schema.optionalKey),
  status: Schema.String.pipe(Schema.optionalKey),
  state: Schema.String.pipe(Schema.optionalKey),
  waitingFor: Schema.String.pipe(Schema.optionalKey),
});
type Row = typeof RowSchema.Type;
const ListingJson = RowSchema.pipe(Schema.Array, Schema.fromJsonString);

/** The registry holds a session's whole state; the board reads two of its fields. */
const RegistryJson = Schema.Struct({
  statusUpdatedAt: Schema.Finite.pipe(Schema.NullOr, Schema.optionalKey),
  nameSource: Schema.String.pipe(Schema.NullOr, Schema.optionalKey),
}).pipe(Schema.fromJsonString);

/**
 * `~/.claude`, or `CLAUDE_CONFIG_DIR` when it is set: where Claude Code keeps
 * its session registry and its transcripts.
 */
const configDirectory = Effect.gen(function*() {
  const override = yield* Config.String('CLAUDE_CONFIG_DIR').pipe(Effect.orElseSucceed(() => null));
  if (override !== null) return override;
  return join(yield* Config.String('HOME'), '.claude');
}).pipe(Effect.orElseSucceed(() => null));

/** The session registry, `sessions/` there. The daemon watches it, so it is resolved in one place. */
export const registryDirectory = configDirectory.pipe(
  Effect.map((directory) => (directory === null ? null : join(directory, 'sessions'))),
);

/** The transcripts, a directory per project under `projects/` there. */
const projectsDirectory = configDirectory.pipe(
  Effect.map((directory) => (directory === null ? null : join(directory, 'projects'))),
);

const listRows = capture({ command: 'claude', args: ['agents', '--json'], timeout: budget }).pipe(
  Effect.orElseSucceed(() => null),
  Effect.flatMap((result) =>
    result === null || result.exitCode !== 0
      ? Effect.succeed(null)
      : Schema.decodeEffect(ListingJson)(result.stdout).pipe(Effect.orElseSucceed(() => null)),
  ),
);

/** Epoch milliseconds as the listing and the registry give them; a value no date can hold is no moment. */
const isoFrom = (value: number | null | undefined): string | null =>
  typeof value === 'number'
    ? DateTime.make(value).pipe(Option.map((moment) => DateTime.formatIso(moment)), Option.getOrNull)
    : null;

/**
 * A background session is reattached by its listing id; every other kind is
 * resumed by its session id. A name is never a handle: Claude Code makes one up
 * for every session nobody named.
 */
const resumeCommand = (row: Row): string | null => {
  if (row.kind === 'background') return row.id === undefined ? null : `claude attach ${row.id}`;
  return row.sessionId === undefined ? null : `claude --resume ${row.sessionId}`;
};

/** What is read beside the listing for one live session. */
type LiveFacts = {
  readonly statusChangedAt: string | null;
  readonly nameSource: string | null;
  readonly context: ContextFill | null;
};

type Registered = Omit<LiveFacts, 'context'>;
const unregistered: Registered = { statusChangedAt: null, nameSource: null };

/**
 * A live session's registry file: when its status last changed, which is
 * `statusUpdatedAt` and no other stamp, since the file's `updatedAt` moves for a
 * rename as well, and where its name came from. A file that cannot be read
 * knows nothing.
 */
const registeredFor = (directory: string | null, pid: number) =>
  Effect.gen(function*() {
    if (directory === null) return unregistered;
    const fs = yield* FileSystem.FileSystem;
    const record = yield* Schema.decodeEffect(RegistryJson)(
      yield* fs.readFileString(join(directory, `${pid}.json`)),
    );
    return { statusChangedAt: isoFrom(record.statusUpdatedAt), nameSource: record.nameSource ?? null };
  }).pipe(Effect.orElseSucceed(() => unregistered));

type Directories = { readonly registry: string | null; readonly projects: string | null };

const liveFactsFor = (directories: Directories, row: Row, pid: number) =>
  Effect.all(
    [
      registeredFor(directories.registry, pid),
      row.sessionId === undefined
        ? Effect.succeed(null)
        : contextOf({ projects: directories.projects, cwd: row.cwd, sessionId: row.sessionId }),
    ],
    { concurrency: 2 },
  ).pipe(Effect.map(([registered, context]): LiveFacts => ({ ...registered, context })));

const describe = (
  row: Row,
  moment: string,
  facts: LiveFacts | undefined,
  terminal: Terminal | undefined,
): ClaudeSession => ({
  kind: row.kind,
  pid: row.pid ?? null,
  sessionId: row.sessionId ?? null,
  backgroundId: row.id ?? null,
  name: row.name ?? null,
  nameSource: facts?.nameSource ?? null,
  status: row.status ?? null,
  state: row.state ?? null,
  waitingFor: row.waitingFor ?? null,
  startedAt: moment,
  statusChangedAt: facts?.statusChangedAt ?? null,
  context: facts?.context ?? null,
  terminal: terminal ?? null,
  resume: resumeCommand(row),
});

type Owned = { readonly owner: string; readonly row: Row; readonly startedAt: string };

/** Each row with the tracked worktree it belongs to; one under none is dropped. */
const ownedRows = (worktrees: ReadonlyArray<string>, rows: ReadonlyArray<Row>) =>
  Effect.gen(function*() {
    const roots = yield* realPaths(worktrees);
    const cwds = yield* realPaths(rows.map((row) => row.cwd));
    const owned: Array<Owned> = [];
    for (const row of rows) {
      const owner = ownerOf({ roots, directory: cwds.get(row.cwd) ?? row.cwd });
      const moment = isoFrom(row.startedAt);
      if (owner !== null && moment !== null) owned.push({ owner, row, startedAt: moment });
    }
    return owned;
  });

/** The terminal and the facts beside the listing for every live row, keyed by its pid. */
const liveOf = (owned: ReadonlyArray<Owned>) =>
  Effect.gen(function*() {
    const directories = { registry: yield* registryDirectory, projects: yield* projectsDirectory };
    const live = new Map<number, Row>();
    for (const { row } of owned) if (row.pid !== undefined) live.set(row.pid, row);
    const [terminals, facts] = yield* Effect.all(
      [
        terminalsFor([...live.keys()]),
        Effect.forEach(
          live,
          ([pid, row]) => liveFactsFor(directories, row, pid).pipe(Effect.map((found) => [pid, found] as const)),
          { concurrency: 8 },
        ).pipe(Effect.map((entries) => new Map(entries))),
      ],
      { concurrency: 2 },
    );
    return { terminals, facts };
  });

/**
 * One listing for the whole machine, grouped to the worktrees the daemon
 * tracks. A row under no tracked worktree is dropped: the board only ever
 * speaks for the worktrees it shows.
 */
export const claudeSessions = (
  worktrees: ReadonlyArray<string>,
): Effect.Effect<ClaudeListing, never, Services> =>
  Effect.gen(function*() {
    const rows = yield* listRows;
    if (rows === null) return { byWorktree: new Map<string, ReadonlyArray<ClaudeSession>>(), notice: unavailable };

    const owned = yield* ownedRows(worktrees, rows);
    const { terminals, facts } = yield* liveOf(owned);
    const byWorktree = new Map<string, ClaudeSession[]>();
    for (const { owner, row, startedAt } of owned) {
      const pid = row.pid;
      const sessions = byWorktree.get(owner) ?? [];
      sessions.push(
        describe(
          row,
          startedAt,
          pid === undefined ? undefined : facts.get(pid),
          pid === undefined ? undefined : terminals.get(pid),
        ),
      );
      byWorktree.set(owner, sessions);
    }
    return { byWorktree, notice: null };
  }).pipe(
    Effect.catchCause(() =>
      Effect.succeed({
        byWorktree: new Map<string, ReadonlyArray<ClaudeSession>>(),
        notice: unavailable,
      }),
    ),
  );
