import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';
import type { ChildProcessSpawner } from 'effect/unstable/process/ChildProcessSpawner';
import type { Links } from '../../contract.ts';
import { capture } from '../command.ts';
import { pullRequestOf } from './github.ts';
import { identifiersIn, issuesOf } from './linear.ts';

/**
 * Where a worktree's work lives outside its files, asked of the tools that
 * know: gh, for the pull request on its branch, and linear, for the issues the
 * branch and that pull request name. Every source answers with what it found
 * or with a sentence saying why it found nothing, so a source that is down
 * never reads as a worktree with nothing linked. Nothing here is kept: the
 * daemon holds the last answer only so a board and its next re-read share one.
 */

/** The branch checked out in the worktree when it is asked; null on a detached head, or when Git cannot say. */
const branchOf = (worktree: string) =>
  capture({ command: 'git', args: ['branch', '--show-current'], cwd: worktree }).pipe(
    Effect.map((result) => (result.exitCode === 0 && result.stdout !== '' ? result.stdout : null)),
    Effect.orElseSucceed(() => null),
  );

export const linksFor = (worktree: {
  readonly path: string;
  /** False for a folder outside Git, which is on no branch, so it has no pull request and names no issue. */
  readonly git: boolean;
}): Effect.Effect<Links, never, ChildProcessSpawner> =>
  Effect.gen(function*() {
    const reportedAt = DateTime.formatIso(yield* DateTime.now);
    if (!worktree.git) return { pr: null, issues: [], notices: [], reportedAt } satisfies Links;
    const [github, branch] = yield* Effect.all([pullRequestOf(worktree.path), branchOf(worktree.path)], {
      concurrency: 'unbounded',
    });
    // Named first by the branch, then by the pull request's title and body.
    // Without an answer from gh, the branch is all there is to read.
    const identifiers = identifiersIn([branch ?? '', github.pr?.title ?? '', github.body]);
    const linear = yield* issuesOf({ identifiers, worktree: worktree.path });
    return {
      pr: github.pr,
      issues: linear.issues,
      notices: [github.notice, linear.notice].filter((notice) => notice !== null),
      reportedAt,
    } satisfies Links;
  });
