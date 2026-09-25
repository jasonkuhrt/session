import { which } from 'bun';
import * as Config from 'effect/Config';
import * as Effect from 'effect/Effect';
import type * as FileSystem from 'effect/FileSystem';
import * as Schema from 'effect/Schema';
import type { ChildProcessSpawner } from 'effect/unstable/process/ChildProcessSpawner';
import type { OpenResult } from '../contract.ts';
import { list, say } from './cmux.ts';
import { ownerOf, realPaths } from './paths.ts';

/**
 * A terminal in a worktree, and only one: the cmux workspace already working
 * in it is brought forward, and a workspace is opened there only when cmux
 * is known to hold none. A look that fails is not an empty answer, so it never
 * opens one; opening on a failed look would open another workspace on every
 * click.
 */

/** A filesystem to resolve directories with, and a way to spawn the CLI. */
type Services = FileSystem.FileSystem | ChildProcessSpawner;

/** Opening a directory goes through LaunchServices and may start the app, which cmux allows ten seconds. */
const openBudget = '15 seconds';

/**
 * Whether the terminal action can run: the daemon spawns `cmux` from its own
 * PATH, so that is where it has to be, looked up in the same environment a
 * spawn reads. Read when asked; nothing is remembered.
 */
export const cmuxOnPath = Effect.gen(function*() {
  return which('cmux', { PATH: yield* Config.String('PATH') }) !== null;
}).pipe(Effect.orElseSucceed(() => false));

/** A window, as `cmux --json list-windows` lists it. */
const WindowsJson = Schema.Array(Schema.Struct({ id: Schema.String })).pipe(Schema.fromJsonString);

/**
 * A window's workspaces, as `cmux --json list-workspaces` describes them: the
 * directory is the one the workspace is working in, and a remote workspace's
 * is a directory on another machine.
 */
const WorkspacesJson = Schema.Struct({
  workspaces: Schema.Array(Schema.Struct({
    id: Schema.String,
    current_directory: Schema.String.pipe(Schema.NullOr, Schema.optionalKey),
    remote: Schema.Struct({ enabled: Schema.Boolean.pipe(Schema.optionalKey) }).pipe(Schema.NullOr, Schema.optionalKey),
  })),
}).pipe(Schema.fromJsonString);

/** A workspace and the window it is in, by the ids cmux lists them under. */
type Workspace = { readonly window: string; readonly workspace: string; readonly directory: string };

/** What looking for the worktree's workspace came to: one, none, or no answer, with cmux's line. */
type Search =
  | { readonly kind: 'found'; readonly workspace: Workspace }
  | { readonly kind: 'none' }
  | { readonly kind: 'refused'; readonly line: string };

/**
 * The workspace a person would call this worktree's. Its directory belongs to
 * the worktree the way an agent's does, by the longest tracked path holding
 * it, so a workspace in a nested worktree is that worktree's and not its
 * parent's. One whose directory is the worktree itself comes first; failing
 * that, one working somewhere inside it; the first of either in cmux's own
 * order. Each window is listed on its own, because a listing without a window
 * names only the caller's, and a daemon has no window of its own to be in. A
 * window that cannot be listed may hold the workspace, so its refusal is the
 * answer rather than "none".
 */
const workspaceIn = (path: string, worktrees: ReadonlyArray<string>) =>
  Effect.gen(function*() {
    const windows = yield* list({ args: ['--json', 'list-windows'], schema: WindowsJson });
    if (!windows.ok) return { kind: 'refused', line: windows.line } satisfies Search;
    const workspaces: Workspace[] = [];
    for (const window of windows.value) {
      const listing = yield* list({ args: ['--json', 'list-workspaces', '--window', window.id], schema: WorkspacesJson });
      if (!listing.ok) return { kind: 'refused', line: listing.line } satisfies Search;
      for (const workspace of listing.value.workspaces) {
        const directory = workspace.current_directory;
        if (workspace.remote?.enabled === true || directory === undefined || directory === null || directory === '') {
          continue;
        }
        workspaces.push({ window: window.id, workspace: workspace.id, directory });
      }
    }
    const roots = yield* realPaths([path, ...worktrees]);
    const directories = yield* realPaths(workspaces.map((entry) => entry.directory));
    const root = roots.get(path) ?? path;
    let inside: Workspace | null = null;
    for (const entry of workspaces) {
      const real = directories.get(entry.directory) ?? entry.directory;
      if (ownerOf({ roots, directory: real }) !== path) continue;
      if (real === root) return { kind: 'found', workspace: entry } satisfies Search;
      inside ??= entry;
    }
    return (inside === null ? { kind: 'none' } : { kind: 'found', workspace: inside }) satisfies Search;
  });

/**
 * Bring a workspace forward: its window, then the workspace in it, then cmux
 * itself, because selecting inside an app that is not frontmost changes
 * nothing on screen. The answer carries the last line cmux printed.
 */
const focusWorkspace = (found: Workspace) =>
  Effect.gen(function*() {
    const sequence: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
      ['cmux', ['focus-window', '--window', found.window]],
      ['cmux', ['select-workspace', '--workspace', found.workspace, '--window', found.window]],
      ['open', ['-b', 'com.cmuxterm.app']],
    ];
    let line = '';
    for (const [command, args] of sequence) {
      const result = yield* say({ command, args });
      if (!result.ok) return result;
      if (command === 'cmux' && result.line !== '') line = result.line;
    }
    return { ok: true, line } satisfies OpenResult;
  });

/**
 * A terminal in a worktree: its workspace brought forward when cmux names one,
 * and a new workspace opened with `cmux <path>` only when the listing worked
 * and named none, or when `cmux ping` fails, because a cmux that is not
 * running holds no workspace and `cmux <path>` is what starts it. When cmux
 * answers the ping but not the listing, its refusal is the answer. Either way
 * the line is cmux's own. `worktrees` is every tracked path, which says
 * whether a workspace inside this one belongs to a worktree nested in it.
 */
export const openTerminal = ({ path, worktrees }: {
  readonly path: string;
  readonly worktrees: ReadonlyArray<string>;
}): Effect.Effect<OpenResult, never, Services> =>
  Effect.gen(function*() {
    const search = yield* workspaceIn(path, worktrees);
    if (search.kind === 'found') return yield* focusWorkspace(search.workspace);
    if (search.kind === 'none') return yield* say({ command: 'cmux', args: [path], timeout: openBudget });
    const ping = yield* say({ command: 'cmux', args: ['ping'] });
    if (ping.ok) return { ok: false, line: search.line } satisfies OpenResult;
    return yield* say({ command: 'cmux', args: [path], timeout: openBudget });
  }).pipe(Effect.catchCause(() => Effect.succeed<OpenResult>({ ok: false, line: 'The terminal could not be reached.' })));
