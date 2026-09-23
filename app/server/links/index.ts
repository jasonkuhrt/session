import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';
import type { ChildProcessSpawner } from 'effect/unstable/process/ChildProcessSpawner';
import type { Links } from '../../contract.ts';
import { pullRequestOf } from './github.ts';

/**
 * Where a worktree's work lives outside its files, asked of the tools that
 * know: gh, for the pull request on its branch. Every source answers with what
 * it found or with a sentence saying why it found nothing, so a source that is
 * down never reads as a worktree with nothing linked. Nothing here is kept:
 * the daemon holds the last answer only so a board and its next re-read share
 * one.
 */
export const linksFor = (worktree: {
  readonly path: string;
  /** False for a folder outside Git, which is on no branch and so has no pull request. */
  readonly git: boolean;
}): Effect.Effect<Links, never, ChildProcessSpawner> =>
  Effect.gen(function*() {
    const reportedAt = DateTime.formatIso(yield* DateTime.now);
    const github = worktree.git ? yield* pullRequestOf(worktree.path) : { pr: null, notice: null };
    return {
      pr: github.pr,
      issues: [],
      notices: github.notice === null ? [] : [github.notice],
      reportedAt,
    } satisfies Links;
  });
