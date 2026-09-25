import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';
import type { ChildProcessSpawner } from 'effect/unstable/process/ChildProcessSpawner';
import type { IssuesReport, PullRequestReport } from '../../contract.ts';
import { capture } from '../command.ts';
import { type PullRequestAnswer, pullRequestOf } from './github.ts';
import { identifiersIn, issuesOf } from './linear.ts';

/**
 * Where a worktree's work lives outside its files, asked of the tools that
 * know: gh, for the pull request on its branch, and linear, for the issues the
 * branch and that pull request name. The two are asked apart, because the
 * index needs only gh, and each answer is stamped with the moment its tool was
 * asked. Every source answers with what it found or with a sentence saying why
 * it found nothing, so a source that is down never reads as a worktree with
 * nothing linked. Nothing here is kept: the daemon holds the last answers only
 * so the pages reading them share one.
 */

/** A worktree as the sources need it. */
type Worktree = {
  readonly path: string;
  /** False for a folder outside Git, which is on no branch, so it has no pull request and names no issue. */
  readonly git: boolean;
};

/**
 * gh's answer, stamped with when it was asked, and the branch that was checked
 * out then, which is the branch gh answered for. The body and the branch are
 * read for the issues they name and stay on the daemon; a page is sent the
 * report.
 */
export type PullRequestReading = PullRequestAnswer & {
  readonly reportedAt: string;
  readonly branch: string | null;
};

/** The branch checked out in the worktree when it is asked; null on a detached head, or when Git cannot say. */
export const checkedOutBranch = (worktree: string) =>
  capture({ command: 'git', args: ['branch', '--show-current'], cwd: worktree }).pipe(
    Effect.map((result) => (result.exitCode === 0 && result.stdout !== '' ? result.stdout : null)),
    Effect.orElseSucceed(() => null),
  );

/** gh's answer and the branch it is for, read together so the two never describe different moments. */
export const pullRequestFor = (worktree: Worktree): Effect.Effect<PullRequestReading, never, ChildProcessSpawner> =>
  Effect.gen(function*() {
    const reportedAt = DateTime.formatIso(yield* DateTime.now);
    if (!worktree.git) return { pr: null, body: '', notice: null, reportedAt, branch: null } satisfies PullRequestReading;
    const [answer, branch] = yield* Effect.all([pullRequestOf(worktree.path), checkedOutBranch(worktree.path)], {
      concurrency: 'unbounded',
    });
    return { ...answer, reportedAt, branch } satisfies PullRequestReading;
  });

/** What a page is sent of gh's answer: everything but the body. */
export const pullRequestReport = ({ pr, notice, reportedAt }: PullRequestReading): PullRequestReport => ({
  pr,
  notice,
  reportedAt,
});

/**
 * The issues one answer of gh's names, with the branch it was read on. Without
 * a pull request from gh, the branch is all there is to read.
 */
export const issuesFor = (input: {
  readonly worktree: Worktree;
  readonly pullRequest: PullRequestReading;
}): Effect.Effect<IssuesReport, never, ChildProcessSpawner> =>
  Effect.gen(function*() {
    const reportedAt = DateTime.formatIso(yield* DateTime.now);
    if (!input.worktree.git) return { issues: [], notice: null, reportedAt } satisfies IssuesReport;
    // Named first by the branch, then by the pull request's title and body.
    const { branch, pr, body } = input.pullRequest;
    const identifiers = identifiersIn([branch ?? '', pr?.title ?? '', body]);
    return { ...(yield* issuesOf({ identifiers, worktree: input.worktree.path })), reportedAt } satisfies IssuesReport;
  });
