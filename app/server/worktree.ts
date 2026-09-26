import { basename, dirname, join, resolve } from 'node:path';
import * as Effect from 'effect/Effect';
import * as FileSystem from 'effect/FileSystem';
import * as Option from 'effect/Option';
import * as Result from 'effect/Result';
import type { ChildProcessSpawner } from 'effect/unstable/process/ChildProcessSpawner';
import type { Repository } from '../contract.ts';
import { type Checkout, type GitWorktree, listGitWorktrees, locateGit, WorktreeError } from './git.ts';
import { makeRepository } from './repository.ts';

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
 * worktree first, by its own path, or by its Git directory's when the two are
 * kept apart, so the main's entry is the first when it carries one of those
 * two paths, and there is none when it carries another. Any other worktree is
 * found by its path, and is missing when the repository's record of it names
 * another, as it does once the worktree is moved by hand.
 */
const entryIn = (input: {
  readonly worktrees: ReadonlyArray<GitWorktree>;
  readonly worktree: { readonly main: boolean; readonly path: string };
  readonly common: string;
}): GitWorktree | undefined => {
  const { worktrees, worktree } = input;
  if (!worktree.main) return worktrees.find((candidate) => candidate.path === worktree.path);
  const [first] = worktrees;
  return first !== undefined && (first.path === worktree.path || first.path === resolve(input.common)) ? first : undefined;
};

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
    Result.fail(new WorktreeError({ kind: 'unanswered', message: 'Git was not asked about this worktree’s repository.' }));
  return listing.pipe(Result.flatMap((worktrees) => {
    const current = entryIn({ worktrees, worktree, common: git.common });
    return current === undefined
      ? Result.fail(new WorktreeError({ kind: 'refused', message: 'The served path is no longer a registered Git worktree.' }))
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
 * A worktree's name: its folder's, and for a linked worktree whose folder has
 * the name of what Git lists first, its parent folder's before it.
 */
const nameOf = (input: { readonly main: boolean; readonly path: string; readonly first: string }) => {
  const leaf = basename(input.path);
  return !input.main && leaf === basename(input.first) ? `${basename(dirname(input.path))}/${leaf}` : leaf;
};

/**
 * Why a worktree is not in its repository's listing, in words that say what
 * mends it: a linked worktree whose record names another path, or a main
 * worktree whose Git directory Git lists at a third path, which only a
 * `core.worktree` that names somewhere else leaves.
 */
const notListed = (input: {
  readonly main: boolean;
  readonly path: string;
  readonly first: GitWorktree | undefined;
  readonly common: string;
}) =>
  new WorktreeError({
    kind: 'refused',
    message: input.main && input.first !== undefined
      ? `Git lists no worktree at ${input.path}: its Git directory, ${input.common}, is the one Git lists at ${input.first.path}.`
      : `Git lists no worktree at ${input.path}; \`git worktree repair\` run there mends one that was moved by hand.`,
  });

/**
 * The worktree a path belongs to, its session, and the name the daemon keys
 * it by. The main worktree is the one whose own Git directory is the one its
 * repository's worktrees share, as `git rev-parse` says, since the listing
 * cannot: Git lists the main first, but by that directory's path rather than
 * its own when the directory is kept apart from it, as a submodule's or a
 * separate one is. The main keeps its folder's name and is the one never in
 * an epic. What Git lists first names the repository, and a linked worktree
 * whose folder shares that name takes its parent's before it. It fails as
 * `refused` where there is no directory to ask Git about, where Git lists no
 * worktree at the path and where the path is inside a Git directory, and as
 * `unanswered` where Git could not be asked or would not answer.
 */
export const resolveWorktreeSession = (input: string) =>
  Effect.gen(function*() {
    const candidate = resolve(input);
    // A path that already names the session directory is used as given; the
    // worktree it belongs to is its parent.
    const isSessionDirectory = basename(candidate) === '.session';
    const start = isSessionDirectory ? dirname(candidate) : candidate;
    const found = yield* (yield* FileSystem.FileSystem).stat(start).pipe(Effect.option);
    if (Option.isNone(found) || found.value.type !== 'Directory') {
      const what = Option.isNone(found) ? 'does not exist' : 'is not a directory';
      return yield* new WorktreeError({ kind: 'refused', message: `${start} ${what}.` });
    }
    const located = yield* locateGit(start);
    if (located === null) {
      return {
        directory: isSessionDirectory ? candidate : join(start, '.session'),
        worktree: { name: basename(start), path: start, main: false, mainPath: null, ...outsideGit },
        git: null,
      } satisfies WorktreeSession;
    }

    const worktreePath = resolve(located.topLevel);
    const { common } = located.git;
    const main = resolve(located.git.directory) === resolve(common);
    const worktrees = yield* listGitWorktrees(worktreePath);
    const [mainWorktree] = worktrees;
    const current = entryIn({ worktrees, worktree: { main, path: worktreePath }, common });
    if (mainWorktree === undefined || current === undefined) {
      return yield* notListed({ main, path: worktreePath, first: mainWorktree, common });
    }
    const name = nameOf({ main, path: worktreePath, first: mainWorktree.path });

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
 * The one setup step, and the only one: every command runs it first, and the
 * daemon runs it for every worktree it serves. It scaffolds, it never
 * converts an older session. Returns what it had to create.
 */
export const ensureSession = (session: WorktreeSession) =>
  Effect.gen(function*() {
    const repository = yield* makeRepository(session.directory);
    return yield* repository.initialize;
  });
