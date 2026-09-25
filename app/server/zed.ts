import { basename, dirname } from 'node:path';
import { which } from 'bun';
import * as Config from 'effect/Config';
import * as Effect from 'effect/Effect';
import * as FileSystem from 'effect/FileSystem';
import * as Option from 'effect/Option';
import type { ChildProcessSpawner } from 'effect/unstable/process/ChildProcessSpawner';
import type { OpenResult } from '../contract.ts';
import { capture, say } from './command.ts';

/**
 * A worktree in Zed, in a window of its own, as if the user had opened it.
 *
 * `zed --classic` picks the window whatever the user's
 * `cli_default_open_behavior`. Zed brings forward the window one of whose
 * projects has the worktree itself as a root. A window on a folder that holds
 * the worktree matches only while that project has not scanned the worktree
 * as a folder yet, or excludes it from scanning. A folder that no window has
 * opens in a new window, never in another window's sidebar. Without an
 * explicit behavior, a CLI that no one can answer settles on the existing
 * window: Zed then writes that choice into the user's settings and puts the
 * worktree in the active window's sidebar.
 *
 * The CLI hands Zed its whole environment, and Zed gives it to the new
 * window's terminals, tasks and language servers in place of the one it would
 * load for the folder. So the CLI runs where Zed would look: in the user's
 * login shell, the one their user record names, started from what launchd
 * gives every app and moved into the worktree, never with the daemon's own
 * environment.
 */

/** A login shell, then Zed, which may have to start and load the project, before it answers. */
const openBudget = '30 seconds';

/** What launchd hands every app the user opens, which is where Zed's own look at a folder's environment starts. */
const launchdVariables = ['HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'SSH_AUTH_SOCK', '__CF_USER_TEXT_ENCODING'];
const launchdPath = '/usr/bin:/bin:/usr/sbin:/sbin';

/** The Zed CLI on the daemon's own PATH, looked up in the same environment a spawn reads; null when there is none. */
const zedCli = Effect.gen(function*() {
  return which('zed', { PATH: yield* Config.String('PATH') });
}).pipe(Effect.orElseSucceed(() => null));

/** Whether the Zed action can run. Read when asked; nothing is remembered. */
export const zedOnPath = zedCli.pipe(Effect.map((cli) => cli !== null));

/**
 * A string as one word in fish, zsh and bash alike: single quotes, with each
 * quote inside closed, escaped and reopened. Fish also reads `\\` and `\'`
 * inside single quotes, which a Git worktree's path does not hold.
 */
const word = (text: string) => `'${text.replaceAll("'", String.raw`'\''`)}'`;

/**
 * What the login shell runs. It moves into the worktree the way Zed moves into
 * a folder to learn its environment, so the shell's directory hooks run. Fish,
 * whose direnv and asdf hooks wait for a prompt, is given one. Then the shell
 * becomes the CLI.
 */
const openCommand = (input: { readonly shell: string; readonly cli: string; readonly path: string }) =>
  `${basename(input.shell) === 'fish' ? 'emit fish_prompt; ' : ''}cd ${word(input.path)}; exec ${word(input.cli)} --classic ${word(input.path)}`;

/** The environment a login starts from: launchd's variables, with launchd's PATH. */
const launchdEnvironment = Effect.gen(function*() {
  const environment: Record<string, string> = { PATH: launchdPath };
  for (const name of launchdVariables) {
    const value = yield* Config.String(name).pipe(Config.option);
    if (Option.isSome(value)) environment[name] = value.value;
  }
  return environment;
});

/**
 * The user's login shell as their user record names it, which is the shell
 * launchd gives an app. The daemon's own `SHELL` is whatever started it, an
 * agent's shell among them, so it is only the fallback.
 */
const loginShell = (user: string) =>
  capture({ command: 'dscl', args: ['.', '-read', `/Users/${user}`, 'UserShell'], timeout: '5 seconds' }).pipe(
    Effect.map((result) => (result.exitCode === 0 ? /^UserShell:\s*(\S+)/mu.exec(result.stdout)?.[1] ?? null : null)),
    Effect.orElseSucceed(() => null),
  );

/** The app bundle a CLI drives: the `.app` its real path lies in; null when it lies in none. */
const appOf = (cli: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    for (let current = yield* fs.realPath(cli); current !== dirname(current); current = dirname(current)) {
      if (current.endsWith('.app')) return current;
    }
    return null;
  }).pipe(Effect.orElseSucceed(() => null));

/**
 * Open the worktree at `path` in Zed, then bring forward the app that CLI
 * drives through LaunchServices, as the terminal action brings cmux forward.
 * Zed activates itself for the CLI, but a request that starts in a background
 * process cannot count on reaching the front by that alone.
 */
export const openInZed = (path: string): Effect.Effect<OpenResult, never, ChildProcessSpawner | FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const cli = yield* zedCli;
    if (cli === null) return { ok: false, line: 'zed is not on the daemon’s PATH.' } satisfies OpenResult;
    const environment = yield* launchdEnvironment.pipe(
      Effect.orElseSucceed((): Record<string, string> => ({ PATH: launchdPath })),
    );
    const user = environment['USER'] ?? environment['LOGNAME'];
    const shell = (user === undefined ? null : yield* loginShell(user)) ?? environment['SHELL'] ?? '/bin/sh';
    const opened = yield* say({
      command: shell,
      args: ['-l', '-i', '-c', openCommand({ shell, cli, path })],
      cwd: environment['HOME'],
      env: { ...environment, SHELL: shell },
      extendEnv: false,
      timeout: openBudget,
      name: 'zed --classic',
    });
    if (!opened.ok) return opened;
    const app = yield* appOf(cli);
    return app === null ? opened : yield* say({ command: 'open', args: ['-a', app] });
  });
