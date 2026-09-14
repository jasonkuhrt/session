import * as Effect from 'effect/Effect';
import * as FileSystem from 'effect/FileSystem';

/**
 * Agents report the working directory they were started in, and the daemon
 * tracks the path a user handed it. A symlink anywhere between the two makes
 * the same worktree look like two, so both sides are resolved before they are
 * compared. A path that cannot be resolved is used as written: it is still the
 * best name anyone has for it.
 */
export const realPaths = (paths: Iterable<string>) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    const resolved = new Map<string, string>();
    yield* Effect.forEach(
      new Set(paths),
      (path) =>
        fs.realPath(path).pipe(
          Effect.orElseSucceed(() => path),
          Effect.map((real) => resolved.set(path, real)),
        ),
      { concurrency: 8, discard: true },
    );
    return resolved;
  });
