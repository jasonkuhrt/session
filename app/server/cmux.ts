import * as Effect from 'effect/Effect';
import * as Schema from 'effect/Schema';
import type { ChildProcessSpawner } from 'effect/unstable/process/ChildProcessSpawner';
import type { FocusResult } from '../contract.ts';
import { capture, type Command, refusal, say } from './command.ts';

/**
 * cmux, the one window manager the board knows: the calls every use of it
 * shares, and where a session's terminal is and how to bring it forward. A
 * session running anywhere else simply has no terminal, which is an ordinary
 * state and never a failure. The terminal action for a worktree is in
 * `terminal.ts`.
 */

/** A way to spawn the CLI, which finds cmux's socket for itself. */
type Services = ChildProcessSpawner;

/** The cmux refs that name one panel: the surface, and where it is docked. */
export type Terminal = {
  readonly surface: string;
  readonly workspace: string;
  readonly window: string;
};

/** cmux is a local socket call; nothing here should ever take seconds. */
const budget = '5 seconds';

/** Its CLI prints a banner on first contact, and a notice on a legacy verb, unless it is asked not to. */
const quiet = { CMUX_QUIET: '1' };

/** A window holds a workspace holds a pane holds a surface holds a process. */
const depthLimit = 8;

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

/**
 * The running tree, or the line cmux refused with. cmux finds its own socket,
 * which has moved between releases, so nothing here guesses at where it is: a
 * cmux that is not running is a listing that fails, and says why.
 */
const runningTree = capture({
  command: 'cmux',
  args: ['top', '--all', '--processes', '--format', 'tsv'],
  env: quiet,
  timeout: budget,
}).pipe(
  Effect.map((listing) => (listing.exitCode === 0 ? parseTree(listing.stdout) : refusal({ command: 'cmux top', result: listing }))),
  Effect.catchTag('CommandError', (error) => Effect.succeed(error.message)),
);

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
    if (typeof tree === 'string') return found;
    for (const pid of pids) {
      const terminal = terminalOf(tree, pid);
      if (terminal !== null) found.set(pid, terminal);
    }
    return found;
  });

/** One step of cmux's, quiet and within cmux's budget, and what it printed. */
export const cmuxSay = ({ command, args, timeout = budget }: {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly timeout?: Command['timeout'];
}) => say({ command, args, env: quiet, timeout });

/** One command of the focus sequence: `null` when it worked, else why not. */
const step = (command: string, args: ReadonlyArray<string>) =>
  cmuxSay({ command, args }).pipe(Effect.map((result) => (result.ok ? null : result.line)));

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
    if (typeof tree === 'string') return refuse(tree);
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

/** A cmux listing as it came back: what it listed, or the line that says why it did not. */
export type Listing<A> = { readonly ok: true; readonly value: A } | { readonly ok: false; readonly line: string };

/**
 * One cmux listing, decoded. When cmux refuses, the answer is the line it
 * refused with; when it answers in a shape this build does not read, a
 * sentence that says so. Neither is ever read as an empty listing.
 */
export const list = <A>({ args, schema }: {
  readonly args: ReadonlyArray<string>;
  readonly schema: Schema.Codec<A, string>;
}): Effect.Effect<Listing<A>, never, Services> =>
  Effect.gen(function*() {
    const result = yield* capture({ command: 'cmux', args, env: quiet, timeout: budget });
    if (result.exitCode !== 0) return { ok: false, line: refusal({ command: `cmux ${args.join(' ')}`, result }) } as const;
    return { ok: true, value: yield* Schema.decodeEffect(schema)(result.stdout) } as const;
  }).pipe(
    Effect.catchTags({
      CommandError: (error) => Effect.succeed({ ok: false, line: error.message } as const),
      SchemaError: () =>
        Effect.succeed({ ok: false, line: `cmux ${args.join(' ')} answered in a shape this build does not read.` } as const),
    }),
  );
