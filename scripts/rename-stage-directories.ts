#!/usr/bin/env bun
import { NodeFileSystem, NodePath, NodeRuntime } from '@effect/platform-node';
import * as Console from 'effect/Console';
import * as Effect from 'effect/Effect';
import * as FileSystem from 'effect/FileSystem';
import * as Option from 'effect/Option';
import * as Path from 'effect/Path';
import type { PlatformError } from 'effect/PlatformError';
import * as Result from 'effect/Result';
import { stageDirectory, stageNames } from '../app/contract.ts';

/**
 * One-off: renames the stage directories of a session made before the stages
 * sorted in flow order, `TRIAGE/` to `EXECUTE/`, to `1-Triage/` to
 * `5-Execute/`. The CLI never migrates a session, so this is the conversion,
 * run by hand once the daemon runs the sources that read the new names. A
 * stage's groups and items move with its directory, nothing else in the
 * session is touched, and running it again renames nothing.
 */

const usage = 'Usage: bun scripts/rename-stage-directories.ts <worktree or .session> ...';

type Rename = { readonly from: string; readonly to: string };

type Outcome =
  | { readonly kind: 'renamed'; readonly renames: ReadonlyArray<Rename> }
  | { readonly kind: 'skipped' | 'refused'; readonly reason: string }
  | { readonly kind: 'failed'; readonly renames: ReadonlyArray<Rename>; readonly reason: string };

const listed = (renames: ReadonlyArray<Rename>): string =>
  renames.map((rename) => `${rename.from}/ to ${rename.to}/`).join(', ');

/** What went wrong in the system's own words, which carry its code, when it gave them. */
const reasonOf = (error: PlatformError): string => (error.cause instanceof Error ? error.cause.message : error.message);

/** A worktree's session is its `.session`; a path that already names one is used as given, as `-C` has it. */
const sessionOf = (path: Path.Path, argument: string): string => {
  const resolved = path.resolve(argument);
  return path.basename(resolved) === '.session' ? resolved : path.join(resolved, '.session');
};

/**
 * The stages this session holds under their old names, and where each goes.
 * An old name is the stage's name bare, in any case. A stage whose directory
 * is there already, in any case, or that two old directories name, refuses
 * the whole session, so no session is ever left half renamed by a refusal.
 */
const plan = (session: string, names: ReadonlyArray<string>) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const renames: Rename[] = [];
    for (const stage of stageNames) {
      const target = stageDirectory(stage);
      const old: string[] = [];
      for (const name of names) {
        if (name.toLowerCase() !== stage.toLowerCase()) continue;
        const info = yield* fs.stat(path.join(session, name)).pipe(Effect.option);
        if (Option.isSome(info) && info.value.type === 'Directory') old.push(name);
      }
      const first = old[0];
      if (first === undefined) continue;
      const taken = names.find((name) => name.toLowerCase() === target.toLowerCase());
      if (taken !== undefined) {
        // The fix lands in the stage's own directory, which `check` asks for even when the one there is another case of it.
        const fix = taken === target ? `move what ${first}/ holds into ${target}/` : `merge them into ${target}/`;
        return Result.fail(`both ${first}/ and ${taken}/ are there; ${fix} by hand, then run this again`);
      }
      if (old.length > 1) {
        return Result.fail(`${old.map((name) => `${name}/`).join(' and ')} each name ${stage}; merge them by hand, then run this again`);
      }
      renames.push({ from: first, to: target });
    }
    return Result.succeed(renames);
  });

const renameIn = (session: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    // A link is no session directory of its own: one that leads somewhere is somebody else's store, and one
    // that leads nowhere holds nothing to rename, which the CLI replaces with a real session.
    if (Option.isSome(yield* fs.readLink(session).pipe(Effect.option))) {
      return { kind: 'skipped', reason: 'it is a link, not a session directory of its own' } satisfies Outcome;
    }
    const info = yield* fs.stat(session).pipe(Effect.option);
    if (Option.isNone(info) || info.value.type !== 'Directory') {
      return { kind: 'skipped', reason: 'there is no session directory' } satisfies Outcome;
    }
    const planned = yield* plan(session, (yield* fs.readDirectory(session)).toSorted());
    if (Result.isFailure(planned)) return { kind: 'refused', reason: planned.failure } satisfies Outcome;
    if (planned.success.length === 0) {
      return { kind: 'skipped', reason: 'no stage directory has an old name' } satisfies Outcome;
    }
    const done: Rename[] = [];
    for (const rename of planned.success) {
      const moved = yield* fs.rename(path.join(session, rename.from), path.join(session, rename.to)).pipe(Effect.result);
      if (Result.isFailure(moved)) {
        return { kind: 'failed', renames: done, reason: reasonOf(moved.failure) } satisfies Outcome;
      }
      done.push(rename);
    }
    return { kind: 'renamed', renames: done } satisfies Outcome;
  }).pipe(
    Effect.catch((error) => Effect.succeed({ kind: 'failed', renames: [], reason: reasonOf(error) } satisfies Outcome)),
  );

/** One line per session: renamed and skipped on stdout, refused and failed on stderr. */
const report = (session: string, outcome: Outcome) => {
  switch (outcome.kind) {
    case 'renamed': {
      return Console.log(`Renamed in ${session}: ${listed(outcome.renames)}`);
    }
    case 'skipped': {
      return Console.log(`Skipped ${session}: ${outcome.reason}`);
    }
    case 'refused': {
      return Console.error(`Refused ${session}: ${outcome.reason}`);
    }
    case 'failed': {
      const before = outcome.renames.length === 0 ? '' : ` after renaming ${listed(outcome.renames)}; run it again to finish`;
      return Console.error(`Failed ${session}: ${outcome.reason}${before}`);
    }
  }
};

/** Every session named once, in the order given, then a count; it exits 1 when any was refused or failed. */
const program = Effect.gen(function*() {
  const path = yield* Path.Path;
  const sessions = [...new Set(process.argv.slice(2).map((argument) => sessionOf(path, argument)))];
  if (sessions.length === 0) {
    yield* Console.error(usage);
    yield* Effect.sync(() => {
      process.exitCode = 1;
    });
    return;
  }
  const counts = { renamed: 0, skipped: 0, refused: 0, failed: 0 };
  for (const session of sessions) {
    const outcome = yield* renameIn(session);
    counts[outcome.kind] += 1;
    yield* report(session, outcome);
  }
  yield* Console.log(
    `${counts.renamed} renamed, ${counts.skipped} skipped, ${counts.refused} refused, ${counts.failed} failed`,
  );
  if (counts.refused + counts.failed > 0) {
    yield* Effect.sync(() => {
      process.exitCode = 1;
    });
  }
});

NodeRuntime.runMain(program.pipe(Effect.provide([NodeFileSystem.layer, NodePath.layer])));
