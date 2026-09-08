import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'bun:test';
import { NodeServices } from '@effect/platform-node';
import * as Effect from 'effect/Effect';
import { refreshWorktreeMetadata, resolveWorktreeSession } from './worktree.ts';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

const git = async (directory: string, ...args: string[]) => {
  const process = Bun.spawn(['git', '-c', 'core.hooksPath=/dev/null', ...args], {
    cwd: directory,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [exitCode, stderr] = await Promise.all([
    process.exited,
    new Response(process.stderr).text(),
  ]);
  if (exitCode !== 0) throw new Error(stderr);
};

test('keeps a linked worktree identity when its session is a central symlink', async () => {
  const root = await mkdtemp(join(tmpdir(), 'session-worktree-'));
  directories.push(root);
  const main = join(root, 'main/Heartbeat');
  const linked = join(root, 'worktrees/feature/Heartbeat');
  const centralSession = join(root, 'sessions/feature');
  await mkdir(main, { recursive: true });
  await mkdir(join(root, 'worktrees/feature'), { recursive: true });
  await mkdir(centralSession, { recursive: true });
  await git(main, 'init', '--initial-branch=main');
  await git(main, 'config', 'user.email', 'test@example.com');
  await git(main, 'config', 'user.name', 'Session Test');
  await writeFile(join(main, 'README.md'), 'test');
  await git(main, 'add', 'README.md');
  await git(main, 'commit', '-m', 'initial');
  await git(main, 'worktree', 'add', '-b', 'feature', linked);
  await symlink(centralSession, join(linked, '.session'));

  const resolved = await Effect.runPromise(
    resolveWorktreeSession(linked).pipe(Effect.provide(NodeServices.layer)),
  );
  const canonicalLinked = await realpath(linked);

  expect(resolved).toEqual({
    directory: join(canonicalLinked, '.session'),
    worktree: {
      name: 'feature/Heartbeat',
      path: canonicalLinked,
      branch: 'feature',
    },
  });

  await git(linked, 'switch', '-c', 'renamed');
  const refreshed = await Effect.runPromise(
    refreshWorktreeMetadata(resolved.worktree).pipe(Effect.provide(NodeServices.layer)),
  );
  expect(refreshed.branch).toBe('renamed');

  const nonGit = join(root, 'scratch');
  await mkdir(nonGit);
  expect(
    await Effect.runPromise(
      resolveWorktreeSession(nonGit).pipe(Effect.provide(NodeServices.layer)),
    ),
  ).toEqual({
    directory: join(nonGit, '.session'),
    worktree: { name: 'scratch', path: nonGit, branch: null },
  });
});
