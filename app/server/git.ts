import { resolve } from 'node:path';
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import { capture, refusal } from './command.ts';

/**
 * Git, asked about a path: where it puts the path, the worktrees it lists for
 * a repository, and the commit a worktree's HEAD names. Every question runs
 * without the variables that would aim Git at some other repository, so each
 * answer is about the path asked about and nothing else.
 */

/** What a worktree has checked out, as Git lists it. */
export type Checkout = {
  /** The branch; null on a detached HEAD, and outside Git. */
  readonly branch: string | null;
  /** True when Git has a commit checked out rather than a branch. */
  readonly detached: boolean;
};

/**
 * Why Git gave no answer to build on. `refused`: Git answered, and its answer
 * is that no command can work at the path as it stands, since Git lists no
 * worktree there or the path is inside a Git directory; asking again answers
 * the same until someone changes what is on disk. `unanswered`: Git could not
 * be asked, or would not answer, and asking again may.
 */
export class WorktreeError extends Data.TaggedError('WorktreeError')<{
  readonly kind: 'refused' | 'unanswered';
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** One entry of a repository's listing. */
export type GitWorktree = Checkout & {
  readonly path: string;
  /** Git marks the entry bare: a bare repository's own directory, which it lists first and which is no worktree. */
  readonly bare: boolean;
};

/**
 * The variables Git sets for the processes it runs, as `git rev-parse
 * --local-env-vars` lists them, which aim a Git command at one repository
 * whatever directory it runs in. Git is asked about a path with none of them,
 * as the daemon runs everything, so a command started from a hook, or from a
 * shell that set `GIT_DIR`, resolves the worktree its path is in and no other.
 */
export const gitRepositoryVariables = [
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_CONFIG',
  'GIT_CONFIG_COUNT',
  'GIT_CONFIG_PARAMETERS',
  'GIT_DIR',
  'GIT_GRAFT_FILE',
  'GIT_IMPLICIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_NO_REPLACE_OBJECTS',
  'GIT_OBJECT_DIRECTORY',
  'GIT_PREFIX',
  'GIT_REPLACE_REF_BASE',
  'GIT_SHALLOW_FILE',
  'GIT_WORK_TREE',
] as const;

/** The user's environment less those variables; an undefined value unsets one. */
const withoutRepositoryVariables = Object.fromEntries(gitRepositoryVariables.map((name) => [name, undefined]));

/**
 * One question to Git about a path. `english` asks for Git's untranslated
 * words, for the one answer whose words are read rather than shown.
 */
const runGit = (workingDirectory: string, args: ReadonlyArray<string>, english = false) =>
  capture({
    command: 'git',
    args,
    cwd: workingDirectory,
    env: english ? { ...withoutRepositoryVariables, LC_ALL: 'C' } : withoutRepositoryVariables,
  }).pipe(Effect.mapError((cause) => new WorktreeError({ kind: 'unanswered', message: cause.message, cause })));

/**
 * Every worktree Git knows about, as seen from one of them, or from the Git
 * directory they share.
 */
export const listGitWorktrees = (workingDirectory: string) =>
  Effect.gen(function*() {
    const result = yield* runGit(workingDirectory, ['worktree', 'list', '--porcelain', '-z']);
    if (result.exitCode !== 0) {
      return yield* new WorktreeError({
        kind: 'unanswered',
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
        new WorktreeError({ kind: 'unanswered', message: 'Git returned a malformed worktree list.', cause }),
    });
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
 * question, three answers, one per line, all absolute. Null outside Git, which
 * Git says as "not a git repository" and nothing else does. A path inside a
 * Git directory is refused, since it is no worktree and holds no session. Any
 * other answer is Git's line, as a failure to locate the path: Git that could
 * not run, or a repository Git will not open, is no folder outside Git.
 */
export const locateGit = (start: string) =>
  Effect.gen(function*() {
    const located = yield* runGit(
      start,
      ['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-dir', '--git-common-dir'],
      true,
    );
    const [topLevel, directory, common] = located.stdout.split('\n');
    if (located.exitCode === 0 && topLevel !== undefined && directory !== undefined && common !== undefined) {
      return { topLevel, git: { directory, common } };
    }
    if (located.stderr.includes('not a git repository')) return null;
    const inside = yield* runGit(start, ['rev-parse', '--is-inside-git-dir'], true);
    if (inside.exitCode === 0 && inside.stdout === 'true') {
      return yield* new WorktreeError({
        kind: 'refused',
        message: `${start} is inside a Git directory, which is no worktree and holds no session; ` +
          'run this in one of the repository’s worktrees instead.',
      });
    }
    return yield* new WorktreeError({ kind: 'unanswered', message: refusal({ command: 'git rev-parse', result: located }) });
  });
