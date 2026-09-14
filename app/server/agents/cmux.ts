import { join } from 'node:path';
import * as Config from 'effect/Config';
import * as Effect from 'effect/Effect';
import * as FileSystem from 'effect/FileSystem';
import type { ChildProcessSpawner } from 'effect/unstable/process/ChildProcessSpawner';
import type { FocusResult } from '../../contract.ts';
import { capture } from '../command.ts';

/**
 * Where a session's terminal is, and how to bring it forward. cmux is the only
 * window manager the board knows; a session running anywhere else simply has no
 * terminal, which is an ordinary state and never a failure.
 */

/** A filesystem to find the socket with, and a way to spawn the CLI. */
type Services = FileSystem.FileSystem | ChildProcessSpawner;

/** The cmux refs that name one panel: the surface, and where it is docked. */
export type Terminal = {
  readonly surface: string;
  readonly workspace: string;
  readonly window: string;
};

/** cmux is a local socket call; nothing here should ever take seconds. */
const budget = '5 seconds';

/** Its CLI prints a banner on first contact unless it is asked not to. */
const quiet = { CMUX_QUIET: '1' };

/** A window holds a workspace holds a pane holds a surface holds a process. */
const depthLimit = 8;

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

/** One command of the focus sequence: `null` when it worked, else why not. */
const step = (command: string, args: ReadonlyArray<string>) =>
  capture({ command, args, env: quiet, timeout: budget }).pipe(
    Effect.map((result) => (result.exitCode === 0 ? null : refusal(`${command} ${args[0]}`, result))),
    Effect.orElseSucceed(() => `Could not run ${command}.`),
  );

/** The two answers this route can give, built where their shape is checked. */
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
