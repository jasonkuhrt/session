import { join } from 'node:path';
import { which } from 'bun';
import * as Config from 'effect/Config';
import * as Effect from 'effect/Effect';
import * as FileSystem from 'effect/FileSystem';
import * as Schema from 'effect/Schema';
import type { ChildProcessSpawner } from 'effect/unstable/process/ChildProcessSpawner';
import type { FocusResult, TerminalResult } from '../contract.ts';
import { capture, type Command } from './command.ts';
import { ownerOf, realPaths } from './paths.ts';

/**
 * cmux, the one window manager the board knows: where a session's terminal
 * is and how to bring it forward, and how to reach a terminal in a worktree.
 * A session running anywhere else simply has no terminal, which is an ordinary
 * state and never a failure.
 */

/** A filesystem to find the socket and resolve directories with, and a way to spawn the CLI. */
type Services = FileSystem.FileSystem | ChildProcessSpawner;

/** The cmux refs that name one panel: the surface, and where it is docked. */
export type Terminal = {
  readonly surface: string;
  readonly workspace: string;
  readonly window: string;
};

/** cmux is a local socket call; nothing here should ever take seconds. */
const budget = '5 seconds';

/** Opening a directory goes through LaunchServices and may start the app, which cmux allows ten seconds. */
const openBudget = '15 seconds';

/** Its CLI prints a banner on first contact, and a notice on a legacy verb, unless it is asked not to. */
const quiet = { CMUX_QUIET: '1' };

/** A window holds a workspace holds a pane holds a surface holds a process. */
const depthLimit = 8;

/**
 * Whether the terminal action can run: the daemon spawns `cmux` from its own
 * PATH, so that is where it has to be, looked up in the same environment a
 * spawn reads. Read when asked; nothing is remembered.
 */
export const cmuxOnPath = Effect.gen(function*() {
  return which('cmux', { PATH: yield* Config.String('PATH') }) !== null;
}).pipe(Effect.orElseSucceed(() => false));

/** One socket per uid. Without it cmux is not running for this user. */
const runningSocket = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const uid = process.getuid?.();
  if (uid === undefined) return null;
  const home = yield* Config.String('HOME');
  const path = join(home, '.local/state/cmux', `cmux-${uid}.sock`);
  return (yield* fs.exists(path)) ? path : null;
}).pipe(Effect.orElseSucceed(() => null));

type Node = { readonly kind: string; readonly parent: string };

/**
 * `cpu | bytes | count | kind | ref | parent | label`: the running tree,
 * flattened one row per node. A process hangs off its surface, or off the
 * process that spawned it; a surface off a pane, a pane off a workspace, a
 * workspace off a window. Walking that chain answers where a pid lives from one
 * call, and it is the only thing that does: `cmux identify --surface` answers
 * `"caller": null`, at exit 0, for a surface outside the caller's own
 * workspace, which on a machine with several windows is most of them. The
 * format is undocumented, so a row in an unexpected shape is skipped rather
 * than guessed at.
 */
const parseTree = (tsv: string): ReadonlyMap<string, Node> => {
  const tree = new Map<string, Node>();
  for (const line of tsv.split('\n')) {
    const fields = line.split('\t');
    if (fields.length !== 7) continue;
    const [, , , kind, ref, parent] = fields;
    if (kind === undefined || ref === undefined || parent === undefined) continue;
    if (ref === '' || parent === '') continue;
    tree.set(ref, { kind, parent });
  }
  return tree;
};

/** The panel a pid runs in, or nothing: not every session lives in cmux. */
const terminalOf = (tree: ReadonlyMap<string, Node>, pid: number): Terminal | null => {
  let surface: string | undefined;
  let workspace: string | undefined;
  let node = tree.get(String(pid));
  for (let depth = 0; depth < depthLimit && node !== undefined; depth += 1) {
    const parent = tree.get(node.parent);
    if (parent === undefined) break;
    if (parent.kind === 'surface') surface = node.parent;
    if (parent.kind === 'workspace') workspace = node.parent;
    if (parent.kind === 'window' && surface !== undefined && workspace !== undefined) {
      return { surface, workspace, window: node.parent };
    }
    node = parent;
  }
  return null;
};

const runningTree = Effect.gen(function*() {
  const socket = yield* runningSocket;
  if (socket === null) return null;
  const listing = yield* capture({
    command: 'cmux',
    args: ['top', '--all', '--processes', '--format', 'tsv'],
    env: quiet,
    timeout: budget,
  }).pipe(Effect.orElseSucceed(() => null));
  if (listing === null || listing.exitCode !== 0) return null;
  return parseTree(listing.stdout);
});

/**
 * The terminal holding each of these pids. A pid cmux does not know, a cmux
 * that is not running, and a listing in a shape this does not recognise all
 * answer the same way: no terminal, and no notice — most sessions on a machine
 * without cmux are perfectly healthy.
 */
export const terminalsFor = (
  pids: ReadonlyArray<number>,
): Effect.Effect<ReadonlyMap<number, Terminal>, never, Services> =>
  Effect.gen(function*() {
    const found = new Map<number, Terminal>();
    if (pids.length === 0) return found;
    const tree = yield* runningTree;
    if (tree === null) return found;
    for (const pid of pids) {
      const terminal = terminalOf(tree, pid);
      if (terminal !== null) found.set(pid, terminal);
    }
    return found;
  });

/** What cmux said went wrong, verbatim, or the plainest true sentence about it. */
const refusal = (
  command: string,
  result: { readonly stderr: string; readonly exitCode: number },
): string => {
  const line = result.stderr.split('\n').find((candidate) => candidate.trim() !== '');
  return line ?? `${command} exited ${result.exitCode}.`;
};

/**
 * One command, and what it printed: its first line when it worked, the line
 * it complained with when it did not, and the plainest true sentence when it
 * never ran or never finished.
 */
const say = (command: string, args: ReadonlyArray<string>, timeout: Command['timeout'] = budget) =>
  capture({ command, args, env: quiet, timeout }).pipe(
    Effect.map((result): TerminalResult =>
      result.exitCode === 0
        ? { ok: true, line: result.stdout.split('\n').find((line) => line.trim() !== '') ?? '' }
        : { ok: false, line: refusal(`${command} ${args[0] ?? ''}`.trim(), result) }
    ),
    Effect.catch((error) => Effect.succeed<TerminalResult>({ ok: false, line: error.message })),
  );

/** One command of the focus sequence: `null` when it worked, else why not. */
const step = (command: string, args: ReadonlyArray<string>) =>
  say(command, args).pipe(Effect.map((result) => (result.ok ? null : result.line)));

/** The two answers the focus route can give, built where their shape is checked. */
const refuse = (reason: string): FocusResult => ({ ok: false, reason });
const focused: FocusResult = { ok: true };

/**
 * Bring a session's terminal forward, from refs read at click time: a surface
 * can have moved workspace since the board drew it. `focus-panel` resolves a
 * surface only inside its own workspace, so the window and the workspace are
 * selected first, and macOS is asked for cmux last because focusing inside an
 * app that is not frontmost changes nothing on screen. The sequence stops at
 * the first refusal and hands back what cmux printed.
 */
export const focus = (pid: number): Effect.Effect<FocusResult, never, Services> =>
  Effect.gen(function*() {
    const tree = yield* runningTree;
    if (tree === null) return refuse('cmux is not running on this machine.');
    const terminal = terminalOf(tree, pid);
    if (terminal === null) return refuse(`cmux has no terminal for pid ${pid}.`);

    const sequence: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
      ['cmux', ['focus-window', '--window', terminal.window]],
      ['cmux', ['select-workspace', '--workspace', terminal.workspace]],
      ['cmux', ['focus-panel', '--panel', terminal.surface, '--workspace', terminal.workspace]],
      ['open', ['-b', 'com.cmuxterm.app']],
    ];
    for (const [command, args] of sequence) {
      const reason = yield* step(command, args);
      if (reason !== null) return refuse(reason);
    }
    return focused;
  }).pipe(Effect.catchCause(() => Effect.succeed(refuse('The terminal could not be reached.'))));

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

/** One cmux listing, decoded; null when cmux could not give it, or gave it in a shape this does not know. */
const list = <A>(args: ReadonlyArray<string>, schema: Schema.Codec<A, string>) =>
  Effect.gen(function*() {
    const result = yield* capture({ command: 'cmux', args, env: quiet, timeout: budget });
    if (result.exitCode !== 0) return null;
    return yield* Schema.decodeEffect(schema)(result.stdout);
  }).pipe(Effect.orElseSucceed(() => null));

/**
 * The workspace a person would call this worktree's. Its directory belongs to
 * the worktree the way an agent's does, by the longest tracked path holding
 * it, so a workspace in a nested worktree is that worktree's and not its
 * parent's. One whose directory is the worktree itself comes first; failing
 * that, one working somewhere inside it; the first of either in cmux's own
 * order. Each window is listed on its own, because a listing without a window
 * names only the caller's, and a daemon has no window of its own to be in.
 */
const workspaceIn = (path: string, worktrees: ReadonlyArray<string>) =>
  Effect.gen(function*() {
    const windows = yield* list(['--json', 'list-windows'], WindowsJson);
    if (windows === null) return null;
    const workspaces: Workspace[] = [];
    for (const window of windows) {
      const listing = yield* list(['--json', 'list-workspaces', '--window', window.id], WorkspacesJson);
      for (const workspace of listing?.workspaces ?? []) {
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
      if (real === root) return entry;
      inside ??= entry;
    }
    return inside;
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
      const result = yield* say(command, args);
      if (!result.ok) return result;
      if (command === 'cmux' && result.line !== '') line = result.line;
    }
    return { ok: true, line } satisfies TerminalResult;
  });

/**
 * A terminal in a worktree: its workspace brought forward when cmux can name
 * one, else a new workspace opened there with `cmux <path>`, which starts cmux
 * when it is not running. Either way the answer carries cmux's own line, so a
 * refusal reads the way cmux put it. `worktrees` is every tracked path, which
 * is what says whether a workspace inside this one belongs to a worktree
 * nested in it instead.
 */
export const openTerminal = ({ path, worktrees }: {
  readonly path: string;
  readonly worktrees: ReadonlyArray<string>;
}): Effect.Effect<TerminalResult, never, Services> =>
  Effect.gen(function*() {
    const found = yield* workspaceIn(path, worktrees);
    return found === null ? yield* say('cmux', [path], openBudget) : yield* focusWorkspace(found);
  }).pipe(Effect.catchCause(() => Effect.succeed<TerminalResult>({ ok: false, line: 'The terminal could not be reached.' })));
