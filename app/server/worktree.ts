import { basename, dirname, join, resolve } from 'node:path';
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import * as Result from 'effect/Result';
import type { ChildProcessSpawner } from 'effect/unstable/process/ChildProcessSpawner';
import type { Repository } from '../contract.ts';
import { capture } from './command.ts';
import { makeRepository } from './repository.ts';

/** What a worktree has checked out, as Git lists it. */
export type Checkout = {
  /** The branch; null on a detached HEAD, and outside Git. */
  readonly branch: string | null;
  /** True when Git has a commit checked out rather than a branch. */
  readonly detached: boolean;
};

/** Outside Git nothing is checked out. */
const outsideGit: Checkout = { branch: null, detached: false };

export type WorktreeMetadata = Checkout & {
  readonly name: string;
  readonly path: string;
  /**
   * Whether this is its repository's main worktree, which `git worktree` will
   * not move, lock or remove: the one whose Git directory is the repository's
   * own, which every linked worktree shares. Git lists it first, by its own
   * path, or by that Git directory's when the directory is kept apart from it,
   * as a submodule's or a separate one is. False outside Git.
   */
  readonly main: boolean;
  /**
   * What Git listed first for its repository when this worktree was taken
   * on: the main worktree's path, which is its own when it is main, or the
   * Git directory Git lists in its place; null outside Git. It names the
   * repository when Git cannot list it later.
   */
  readonly mainPath: string | null;
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

type GitWorktree = Checkout & {
  readonly path: string;
  /** Git marks the entry bare: a bare repository's own directory, which it lists first and which is no worktree. */
  readonly bare: boolean;
};

const runGit = (workingDirectory: string, args: ReadonlyArray<string>) =>
  capture({ command: 'git', args, cwd: workingDirectory }).pipe(
    Effect.mapError(
      (cause) => new WorktreeError({ message: 'Could not inspect the Git worktree.', cause }),
    ),
  );

/**
 * Every worktree Git knows about, as seen from one of them, or from the Git
 * directory they share.
 */
export const listGitWorktrees = (workingDirectory: string) =>
  Effect.gen(function*() {
    const result = yield* runGit(workingDirectory, ['worktree', 'list', '--porcelain', '-z']);
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
              detached: fields.includes('detached'),
              bare: fields.includes('bare'),
            };
          }),
      catch: (cause) =>
        new WorktreeError({ message: 'Git returned a malformed worktree list.', cause }),
    });
  });

/** A repository's worktrees as Git lists them, or why it could not. */
export type RepositoryListing = Result.Result<ReadonlyArray<GitWorktree>, WorktreeError>;

/**
 * The worktrees of every repository these sessions belong to, keyed by the Git
 * directory each repository's worktrees share, from one `git worktree list`
 * per repository, run in that directory. Sibling worktrees share one list, so
 * asking in each of them asked the same question once per sibling, and the
 * shared directory still answers when a worktree's own directory cannot.
 */
export const listRepositories = (input: {
  readonly sessions: ReadonlyArray<WorktreeSession>;
  readonly concurrency: number;
}): Effect.Effect<ReadonlyMap<string, RepositoryListing>, never, ChildProcessSpawner> => {
  const shared = new Set(input.sessions.flatMap((session) => (session.git === null ? [] : [session.git.common])));
  return Effect.forEach(
    shared,
    (common) => listGitWorktrees(common).pipe(Effect.result, Effect.map((listing) => [common, listing] as const)),
    { concurrency: input.concurrency },
  ).pipe(Effect.map((listings) => new Map(listings)));
};

/**
 * A worktree's own entry in its repository's listing. Git lists the main
 * worktree first, by its own path or by its Git directory's, so the main's
 * entry is the first whatever path it carries. Any other is found by its path,
 * and is missing when the repository's record of it names another, as it does
 * once the worktree is moved by hand.
 */
const entryIn = (
  worktrees: ReadonlyArray<GitWorktree>,
  worktree: { readonly main: boolean; readonly path: string },
): GitWorktree | undefined =>
  worktree.main ? worktrees[0] : worktrees.find((candidate) => candidate.path === worktree.path);

/**
 * What a session's worktree has checked out, as its repository's listing
 * says: nothing outside Git, and an error when Git could not list the
 * repository or no longer lists the worktree.
 */
export const checkoutIn = (input: {
  readonly listings: ReadonlyMap<string, RepositoryListing>;
  readonly session: WorktreeSession;
}): Result.Result<Checkout, WorktreeError> => {
  const { git, worktree } = input.session;
  if (git === null) return Result.succeed(outsideGit);
  const listing = input.listings.get(git.common) ??
    Result.fail(new WorktreeError({ message: 'Git was not asked about this worktree’s repository.' }));
  return listing.pipe(Result.flatMap((worktrees) => {
    const current = entryIn(worktrees, worktree);
    return current === undefined
      ? Result.fail(new WorktreeError({ message: 'The served path is no longer a registered Git worktree.' }))
      : Result.succeed({ branch: current.branch, detached: current.detached });
  }));
};

/**
 * The repository a session's worktree belongs to, by what Git lists first for
 * it, from the same listing as the worktree's own checkout, or, when Git could
 * not list it, by what it listed when the worktree was taken on, with nothing
 * known checked out there. That entry is the Git directory the worktrees
 * share, `bare`, where Git lists that in the main worktree's place: a bare
 * repository's, which has none, and a submodule's or a separate one's, whose
 * main worktree is elsewhere. Null outside Git.
 */
export const repositoryIn = (input: {
  readonly listings: ReadonlyMap<string, RepositoryListing>;
  readonly session: WorktreeSession;
}): Repository | null => {
  const { git, worktree } = input.session;
  if (git === null || worktree.mainPath === null) return null;
  const listing = input.listings.get(git.common);
  const main = listing !== undefined && Result.isSuccess(listing) ? listing.success[0] : undefined;
  const path = main?.path ?? worktree.mainPath;
  return {
    name: basename(path),
    path,
    bare: main?.bare === true || path === resolve(git.common),
    checkout: main === undefined ? null : { branch: main.branch, detached: main.detached },
  };
};

/** What one session's worktree has checked out now, from one listing of its repository. */
export const checkoutOf = (session: WorktreeSession) =>
  listRepositories({ sessions: [session], concurrency: 1 }).pipe(
    Effect.flatMap((listings) => Effect.fromResult(checkoutIn({ listings, session }))),
  );

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

/**
 * The worktree a path belongs to, its session, and the name the daemon keys
 * it by. The main worktree is the one whose own Git directory is the one its
 * repository's worktrees share, as `git rev-parse` says, since the listing
 * cannot: Git lists the main first, but by that directory's path rather than
 * its own when the directory is kept apart from it, as a submodule's or a
 * separate one is. The main keeps its folder's name and is the one never in
 * an epic. What Git lists first names the repository, and a linked worktree
 * whose folder shares that name takes its parent's before it.
 */
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
        worktree: { name: basename(start), path: start, main: false, mainPath: null, ...outsideGit },
        git: null,
      } satisfies WorktreeSession;
    }

    const worktreePath = resolve(located.topLevel);
    const main = resolve(located.git.directory) === resolve(located.git.common);
    const worktrees = yield* listGitWorktrees(worktreePath);
    const mainWorktree = worktrees[0];
    const current = entryIn(worktrees, { main, path: worktreePath });
    if (mainWorktree === undefined || current === undefined) {
      return yield* new WorktreeError({
        message: `Git lists no worktree at ${worktreePath}; \`git worktree repair\` run there mends one that was moved by hand.`,
      });
    }
    const leaf = basename(worktreePath);
    const name =
      main
        ? leaf
        : leaf === basename(mainWorktree.path)
          ? `${basename(dirname(worktreePath))}/${leaf}`
          : leaf;

    return {
      // Join only after Git identifies the lexical worktree. `.session` must not
      // define worktree identity.
      directory: isSessionDirectory ? candidate : join(worktreePath, '.session'),
      worktree: {
        name,
        path: worktreePath,
        main,
        mainPath: mainWorktree.path,
        branch: current.branch,
        detached: current.detached,
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
