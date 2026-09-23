import { basename, dirname, join, resolve } from 'node:path';
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import { capture } from './command.ts';
import { makeRepository } from './repository.ts';

export type WorktreeMetadata = {
  readonly name: string;
  readonly path: string;
  readonly branch: string | null;
};

export type WorktreeSession = {
  readonly directory: string;
  readonly worktree: WorktreeMetadata;
  /**
   * Where Git keeps this worktree's own state (its HEAD and reflog) and the
   * state it shares with every worktree of the repository (branches and
   * remote-tracking refs); null outside a Git worktree.
   */
  readonly git: { readonly directory: string; readonly common: string } | null;
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
  capture({ command: 'git', args, cwd: workingDirectory }).pipe(
    Effect.mapError(
      (cause) => new WorktreeError({ message: 'Could not inspect the Git worktree.', cause }),
    ),
  );

/** Every worktree Git knows about, as seen from one of them. */
export const listGitWorktrees = (worktreePath: string) =>
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
    const worktrees = yield* listGitWorktrees(metadata.path);
    const current = worktrees.find((worktree) => worktree.path === metadata.path);
    if (current === undefined) {
      return yield* new WorktreeError({
        message: 'The served path is no longer a registered Git worktree.',
      });
    }
    return { ...metadata, branch: current.branch };
  });

/**
 * The commit a worktree's HEAD names, abbreviated the way Git abbreviates it,
 * or null when there is none to name: outside Git, or before the first commit.
 */
export const headCommit = (worktreePath: string) =>
  runGit(worktreePath, ['rev-parse', '--short', '--verify', '--quiet', 'HEAD']).pipe(
    Effect.map((result) => (result.exitCode === 0 && result.stdout !== '' ? result.stdout : null)),
  );

/**
 * Where Git puts a path: the worktree it belongs to, that worktree's own Git
 * state, and the state it shares with the repository's other worktrees. One
 * question, three answers, one per line, all absolute; null outside Git.
 */
const locateGit = (start: string) =>
  runGit(start, ['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-dir', '--git-common-dir']).pipe(
    Effect.map((located) => {
      const [topLevel, directory, common] = located.stdout.split('\n');
      return located.exitCode !== 0 || topLevel === undefined || directory === undefined || common === undefined
        ? null
        : { topLevel, git: { directory, common } };
    }),
  );

export const resolveWorktreeSession = (input: string) =>
  Effect.gen(function*() {
    const candidate = resolve(input);
    // A path that already names the session directory is used as given; the
    // worktree it belongs to is its parent.
    const isSessionDirectory = basename(candidate) === '.session';
    const start = isSessionDirectory ? dirname(candidate) : candidate;
    const located = yield* locateGit(start);
    if (located === null) {
      return {
        directory: isSessionDirectory ? candidate : join(start, '.session'),
        worktree: { name: basename(start), path: start, branch: null },
        git: null,
      } satisfies WorktreeSession;
    }

    const worktreePath = resolve(located.topLevel);
    const worktrees = yield* listGitWorktrees(worktreePath);
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
      // Join only after Git identifies the lexical worktree. `.session` must not
      // define worktree identity.
      directory: isSessionDirectory ? candidate : join(worktreePath, '.session'),
      worktree: {
        name,
        path: worktreePath,
        branch: current.branch,
      },
      git: located.git,
    } satisfies WorktreeSession;
  });

/**
 * Route key for a worktree: its name, encoded segment by segment so a nested
 * name (`email-backend/Heartbeat`) still addresses one board under `/w/`.
 */
export const encodeWorktreeKey = (name: string): string =>
  name.split('/').map((segment) => encodeURIComponent(segment)).join('/');

/**
 * The one setup step, and the only one: every command runs it first, and the
 * daemon runs it for every worktree it serves. It scaffolds, it never
 * converts an older session. Returns what it had to create.
 */
export const ensureSession = (session: WorktreeSession) =>
  Effect.gen(function*() {
    const repository = yield* makeRepository(session.directory);
    return yield* repository.initialize;
  });
