import * as Effect from 'effect/Effect';
import * as FileSystem from 'effect/FileSystem';

/**
 * Which worktree a directory belongs to. Agents report the working directory
 * they were started in, cmux reports the one each workspace is in, and the
 * daemon tracks the path a user handed it; the agents overlay and the terminal
 * action both have to say which worktree such a directory is in, and they say
 * it the same way.
 */

/**
 * A symlink anywhere between two paths makes the same worktree look like two,
 * so both sides are resolved before they are compared. A path that cannot be
 * resolved is used as written: it is still the best name anyone has for it.
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

/**
 * The worktree a directory belongs to: the one whose path is the directory or
 * contains it at a segment boundary, longest first. Without the boundary a
 * worktree would swallow its own siblings — `…/Heartbeat` would claim
 * `…/Heartbeat-alch` — and without longest-wins a nested worktree would report
 * to its parent. `roots` maps each tracked path to its real path, and the
 * directory is a real path too.
 */
export const ownerOf = ({ roots, directory }: {
  readonly roots: ReadonlyMap<string, string>;
  readonly directory: string;
}): string | null => {
  let owner: string | null = null;
  let length = -1;
  for (const [path, real] of roots) {
    if (directory !== real && !directory.startsWith(`${real}/`)) continue;
    if (real.length > length) {
      owner = path;
      length = real.length;
    }
  }
  return owner;
};
