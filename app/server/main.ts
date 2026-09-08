import { NodeServices } from '@effect/platform-node';
import * as Effect from 'effect/Effect';
import { startServer } from './http.ts';
import { resolveWorktreeSession } from './worktree.ts';

const args = process.argv.slice(2);
let worktree = process.cwd();
let port = 3210;

for (let index = 0; index < args.length; index += 1) {
  const argument = args[index]!;
  if (argument === '--port') {
    const value = args[index + 1];
    if (value === undefined || !Number.isInteger(Number(value))) {
      throw new Error('--port requires an integer.');
    }
    port = Number(value);
    index += 1;
  } else {
    worktree = argument;
  }
}

const resolved = await Effect.runPromise(
  resolveWorktreeSession(worktree).pipe(Effect.provide(NodeServices.layer)),
);
const server = await startServer({
  directory: resolved.directory,
  worktree: resolved.worktree,
  port,
});
console.log(`Session app: http://${server.hostname}:${server.port}`);
console.log(
  `Worktree: ${resolved.worktree.name} (${resolved.worktree.branch ?? 'detached/non-Git'})`,
);
