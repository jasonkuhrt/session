import { basename, dirname, join, resolve } from 'node:path';
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import * as Stream from 'effect/Stream';
import * as ChildProcess from 'effect/unstable/process/ChildProcess';

export type WorktreeMetadata = {
  readonly name: string;
  readonly path: string;
  readonly branch: string | null;
};

export type WorktreeSession = {
  readonly directory: string;
  readonly worktree: WorktreeMetadata;
};

export class WorktreeError extends Data.TaggedError('WorktreeError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

type GitWorktree = {
  readonly path: string;
  readonly branch: string | null;
};

const runGit = (workingDirectory: string, args: ReadonlyArray<string>) =>
  Effect.scoped(
    Effect.gen(function*() {
      const handle = yield* ChildProcess.make('git', [...args], { cwd: workingDirectory });
      const [stdout, stderr, exitCode] = yield* Effect.all(
        [
          handle.stdout.pipe(Stream.decodeText(), Stream.mkString),
          handle.stderr.pipe(Stream.decodeText(), Stream.mkString),
          handle.exitCode,
        ],
        { concurrency: 'unbounded' },
      );
      return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode: Number(exitCode) };
    }),
  ).pipe(
    Effect.mapError(
      (cause) => new WorktreeError({ message: 'Could not inspect the Git worktree.', cause }),
    ),
  );

const readGitWorktrees = (worktreePath: string) =>
  Effect.gen(function*() {
    const result = yield* runGit(worktreePath, ['worktree', 'list', '--porcelain', '-z']);
    if (result.exitCode !== 0) {
      return yield* new WorktreeError({
        message: result.stderr || 'Could not list Git worktrees.',
      });
    }
    return yield* Effect.try({
      try: () =>
        result.stdout
          .split('\0\0')
          .filter((record) => record !== '')
          .map((record): GitWorktree => {
            const fields = record.split('\0');
            const worktree = fields.find((field) => field.startsWith('worktree '));
            const branch = fields.find((field) => field.startsWith('branch refs/heads/'));
            if (worktree === undefined) throw new Error('Missing worktree field.');
            return {
              path: resolve(worktree.slice('worktree '.length)),
              branch: branch?.slice('branch refs/heads/'.length) ?? null,
            };
          }),
      catch: (cause) =>
        new WorktreeError({ message: 'Git returned a malformed worktree list.', cause }),
    });
  });

export const refreshWorktreeMetadata = (metadata: WorktreeMetadata) =>
  Effect.gen(function*() {
    const topLevel = yield* runGit(metadata.path, ['rev-parse', '--show-toplevel']);
    if (topLevel.exitCode !== 0) return { ...metadata, branch: null };
    const worktrees = yield* readGitWorktrees(metadata.path);
    const current = worktrees.find((worktree) => worktree.path === metadata.path);
    if (current === undefined) {
      return yield* new WorktreeError({
        message: 'The served path is no longer a registered Git worktree.',
      });
    }
    return { ...metadata, branch: current.branch };
  });

export const resolveWorktreeSession = (input: string) =>
  Effect.gen(function*() {
    const candidate = resolve(input);
    const topLevel = yield* runGit(candidate, ['rev-parse', '--show-toplevel']);
    if (topLevel.exitCode !== 0) {
      return {
        directory: join(candidate, '.session'),
        worktree: { name: basename(candidate), path: candidate, branch: null },
      } satisfies WorktreeSession;
    }

    const worktreePath = resolve(topLevel.stdout);
    const worktrees = yield* readGitWorktrees(worktreePath);
    const mainWorktree = worktrees[0];
    const current = worktrees.find((worktree) => worktree.path === worktreePath);
    if (mainWorktree === undefined || current === undefined) {
      return yield* new WorktreeError({
        message: 'Git did not list the requested worktree.',
      });
    }
    const mainWorktreePath = mainWorktree.path;
    const leaf = basename(worktreePath);
    const name =
      worktreePath === mainWorktreePath
        ? leaf
        : leaf === basename(mainWorktreePath)
          ? `${basename(dirname(worktreePath))}/${leaf}`
          : leaf;

    return {
      // Join only after Git identifies the lexical worktree. `.session` may be a
      // symlink into a shared session store and must not define worktree identity.
      directory: join(worktreePath, '.session'),
      worktree: {
        name,
        path: worktreePath,
        branch: current.branch,
      },
    } satisfies WorktreeSession;
  });
