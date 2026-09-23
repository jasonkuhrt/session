import { join } from 'node:path';
import * as Config from 'effect/Config';
import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';
import * as FileSystem from 'effect/FileSystem';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';
import type { ChildProcessSpawner } from 'effect/unstable/process/ChildProcessSpawner';
import type { ClaudeSession } from '../../contract.ts';
import { capture } from '../command.ts';
import { terminalsFor, type Terminal } from '../cmux.ts';
import { ownerOf, realPaths } from '../paths.ts';

/**
 * The Claude Code sessions under a worktree, from Claude Code's own listing.
 * `claude agents --json` is the supported way to read session state from
 * outside, and it already drops sessions whose process is gone, so nothing here
 * second-guesses liveness. The registry file beside each session is read for
 * the one fact the listing omits: when its status last changed.
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

/** The registry holds a session's whole state; the board reads its two stamps. */
const RegistryJson = Schema.Struct({
  statusUpdatedAt: Schema.Finite.pipe(Schema.NullOr, Schema.optionalKey),
  updatedAt: Schema.Finite.pipe(Schema.NullOr, Schema.optionalKey),
}).pipe(Schema.fromJsonString);

/**
 * `~/.claude/sessions`, or the same directory under `CLAUDE_CONFIG_DIR`. The
 * daemon watches this, so it is resolved in one place.
 */
export const registryDirectory = Effect.gen(function*() {
  const override = yield* Config.String('CLAUDE_CONFIG_DIR').pipe(Effect.orElseSucceed(() => null));
  if (override !== null) return join(override, 'sessions');
  return join(yield* Config.String('HOME'), '.claude/sessions');
}).pipe(Effect.orElseSucceed(() => null));

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
 * resumed by its session id. A name is never a handle: half of them are derived.
 */
const resumeCommand = (row: Row): string | null => {
  if (row.kind === 'background') return row.id === undefined ? null : `claude attach ${row.id}`;
  return row.sessionId === undefined ? null : `claude --resume ${row.sessionId}`;
};

/**
 * When a session's status last changed, from its registry file. `updatedAt` is
 * the wider stamp the registry always carries, so it stands in when the
 * narrower one is absent; neither is a heartbeat. A file that cannot be read
 * knows nothing.
 */
const statusChangedAtFor = (directory: string | null, pid: number) =>
  Effect.gen(function*() {
    if (directory === null) return null;
    const fs = yield* FileSystem.FileSystem;
    const record = yield* Schema.decodeEffect(RegistryJson)(
      yield* fs.readFileString(join(directory, `${pid}.json`)),
    );
    return isoFrom(record.statusUpdatedAt) ?? isoFrom(record.updatedAt);
  }).pipe(Effect.orElseSucceed(() => null));

const describe = (
  row: Row,
  moment: string,
  statusChangedAt: string | null,
  terminal: Terminal | undefined,
): ClaudeSession => ({
  kind: row.kind,
  pid: row.pid ?? null,
  sessionId: row.sessionId ?? null,
  backgroundId: row.id ?? null,
  name: row.name ?? null,
  status: row.status ?? null,
  state: row.state ?? null,
  waitingFor: row.waitingFor ?? null,
  startedAt: moment,
  statusChangedAt,
  terminal: terminal ?? null,
  resume: resumeCommand(row),
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
    const empty = new Map<string, ReadonlyArray<ClaudeSession>>();
    const rows = yield* listRows;
    if (rows === null) return { byWorktree: empty, notice: unavailable };

    const roots = yield* realPaths(worktrees);
    const cwds = yield* realPaths(rows.map((row) => row.cwd));
    const owned: Array<{ readonly owner: string; readonly row: Row; readonly startedAt: string }> = [];
    for (const row of rows) {
      const owner = ownerOf({ roots, directory: cwds.get(row.cwd) ?? row.cwd });
      const moment = isoFrom(row.startedAt);
      if (owner !== null && moment !== null) owned.push({ owner, row, startedAt: moment });
    }

    const directory = yield* registryDirectory;
    const pids = [...new Set(owned.flatMap((entry) => entry.row.pid ?? []))];
    const [terminals, statusChanges] = yield* Effect.all(
      [
        terminalsFor(pids),
        Effect.forEach(
          pids,
          (pid) => statusChangedAtFor(directory, pid).pipe(Effect.map((changedAt) => [pid, changedAt] as const)),
          { concurrency: 8 },
        ).pipe(Effect.map((entries) => new Map(entries))),
      ],
      { concurrency: 2 },
    );

    const byWorktree = new Map<string, ClaudeSession[]>();
    for (const { owner, row, startedAt: moment } of owned) {
      const pid = row.pid;
      const changedAt = pid === undefined ? null : statusChanges.get(pid) ?? null;
      const sessions = byWorktree.get(owner) ?? [];
      sessions.push(describe(row, moment, changedAt, pid === undefined ? undefined : terminals.get(pid)));
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
