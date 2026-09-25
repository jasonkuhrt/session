import { which } from 'bun';
import * as Config from 'effect/Config';
import * as Effect from 'effect/Effect';
import type { ChildProcessSpawner } from 'effect/unstable/process/ChildProcessSpawner';
import type { OpenResult } from '../contract.ts';
import { say } from './cmux.ts';

/**
 * A worktree in Zed, in a window of its own. `zed --classic` asks for exactly
 * that whatever the user's `cli_default_open_behavior`: Zed brings forward the
 * window one of whose projects has this worktree as a root, matching the root
 * itself and never a folder that holds it or sits beside it, and opens a
 * folder it finds nowhere in a new window rather than in another window's
 * sidebar, so a window on another worktree is never changed. An explicit
 * behaviour also keeps the CLI from stopping to ask which default the user
 * wants, a question a daemon could never answer.
 */

/** Zed may have to start, and then load the project, before it answers. */
const openBudget = '30 seconds';

/** Zed's bundle, which LaunchServices brings forward. */
const zedBundle = 'dev.zed.Zed';

/**
 * Whether the Zed action can run: the daemon spawns `zed` from its own PATH,
 * so that is where it has to be, looked up in the same environment a spawn
 * reads. Read when asked; nothing is remembered.
 */
export const zedOnPath = Effect.gen(function*() {
  return which('zed', { PATH: yield* Config.String('PATH') }) !== null;
}).pipe(Effect.orElseSucceed(() => false));

/**
 * Open the worktree at `path` in Zed, then bring Zed forward through
 * LaunchServices, as the terminal action brings cmux forward: Zed activates
 * itself for the CLI, but a request that starts in a background process
 * cannot count on reaching the front by that alone.
 */
export const openInZed = (path: string): Effect.Effect<OpenResult, never, ChildProcessSpawner> =>
  Effect.gen(function*() {
    const opened = yield* say({ command: 'zed', args: ['--classic', path], timeout: openBudget });
    if (!opened.ok) return opened;
    return yield* say({ command: 'open', args: ['-b', zedBundle] });
  });
