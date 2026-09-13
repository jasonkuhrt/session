import { basename, dirname, join, resolve } from 'node:path';
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import * as FileSystem from 'effect/FileSystem';
import * as Option from 'effect/Option';
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
    // A path that already names the session directory is used as given; the
    // worktree it belongs to is its parent.
    const isSessionDirectory = basename(candidate) === '.session';
    const start = isSessionDirectory ? dirname(candidate) : candidate;
    const topLevel = yield* runGit(start, ['rev-parse', '--show-toplevel']);
    if (topLevel.exitCode !== 0) {
      return {
        directory: isSessionDirectory ? candidate : join(start, '.session'),
        worktree: { name: basename(start), path: start, branch: null },
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
      // Join only after Git identifies the lexical worktree. `.session` must not
      // define worktree identity.
      directory: isSessionDirectory ? candidate : join(worktreePath, '.session'),
      worktree: {
        name,
        path: worktreePath,
        branch: current.branch,
      },
    } satisfies WorktreeSession;
  });

const asWorktreeError = (error: unknown): WorktreeError =>
  error instanceof WorktreeError
    ? error
    : new WorktreeError({
        message: error instanceof Error ? error.message : String(error),
        cause: error,
      });

/** `rename` across filesystems fails, so fall back to copying the tree. */
const moveDirectory = (from: string, to: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    const renamed = yield* fs.rename(from, to).pipe(Effect.option);
    if (Option.isSome(renamed)) return;
    yield* fs.copy(from, to);
    yield* fs.remove(from, { recursive: true });
  });

/**
 * Turn a shared, symlinked session into a real `.session` directory at the
 * worktree root. Idempotent: a real directory is left alone. Returns what it
 * did, one line per action.
 */
export const migrateSessionDirectory = (worktree: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    const actions: string[] = [];

    const sessionPath = join(worktree, '.session');
    const link = yield* fs.readLink(sessionPath).pipe(Effect.option);
    if (Option.isSome(link)) {
      const target = resolve(worktree, link.value);
      const info = yield* fs.stat(target).pipe(Effect.option);
      if (Option.isNone(info) || info.value.type !== 'Directory') {
        return yield* new WorktreeError({
          message:
            `${sessionPath} points at ${target}, which is not a directory. Resolve it by hand, then run init again.`,
        });
      }
      yield* fs.remove(sessionPath);
      yield* moveDirectory(target, sessionPath);
      actions.push(`Moved ${target} to ${sessionPath}`);
    }

    // The shared store link is retired; a real `.sessions` directory is not.
    const storePath = join(worktree, '.sessions');
    const storeLink = yield* fs.readLink(storePath).pipe(Effect.option);
    if (Option.isSome(storeLink)) {
      yield* fs.remove(storePath);
      actions.push(`Removed the retired link ${storePath}`);
    }

    return actions;
  }).pipe(Effect.mapError(asWorktreeError));

const archiveSlug = (worktreePath: string, branch: string | null) =>
  Effect.gen(function*() {
    if (branch !== null) return branch.replaceAll('/', '-');
    const head = yield* runGit(worktreePath, ['rev-parse', '--short', 'HEAD']);
    if (head.exitCode !== 0) {
      return yield* new WorktreeError({ message: 'Could not read the detached HEAD.' });
    }
    return `detached-${head.stdout}`;
  });

/** Park a finished worktree's session under the main worktree's `.sessions`. */
export const archiveSessionDirectory = (worktree: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    const sessionPath = join(worktree, '.session');
    const info = yield* fs.stat(sessionPath).pipe(Effect.option);
    if (Option.isNone(info) || info.value.type !== 'Directory') {
      return yield* new WorktreeError({ message: `${sessionPath} is not a directory.` });
    }

    const topLevel = yield* runGit(worktree, ['rev-parse', '--show-toplevel']);
    if (topLevel.exitCode !== 0) {
      return yield* new WorktreeError({ message: 'Archiving a session requires a Git worktree.' });
    }
    const worktreePath = resolve(topLevel.stdout);
    const worktrees = yield* readGitWorktrees(worktreePath);
    const mainWorktree = worktrees[0];
    const current = worktrees.find((entry) => entry.path === worktreePath);
    if (mainWorktree === undefined || current === undefined) {
      return yield* new WorktreeError({ message: 'Git did not list the requested worktree.' });
    }

    const slug = yield* archiveSlug(worktreePath, current.branch);
    const target = join(mainWorktree.path, '.sessions', slug);
    if (yield* fs.exists(target)) {
      return yield* new WorktreeError({
        message: `${target} already exists. Move or remove it before archiving.`,
      });
    }
    yield* fs.makeDirectory(dirname(target), { recursive: true });
    yield* moveDirectory(sessionPath, target);
    return target;
  }).pipe(Effect.mapError(asWorktreeError));
