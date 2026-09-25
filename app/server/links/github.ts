import * as Effect from 'effect/Effect';
import * as Schema from 'effect/Schema';
import type { ChildProcessSpawner } from 'effect/unstable/process/ChildProcessSpawner';
import type { PullRequest } from '../../contract.ts';
import { capture } from '../command.ts';

/**
 * The pull request for a worktree's branch, as `gh pr view` reports it. gh
 * answers for the branch checked out where it runs, which is exactly the
 * question, so nothing here looks the branch up or matches it against
 * anything: the pull request is the one gh names at the moment it is asked.
 */

/** What gh said, or the sentence saying why it said nothing. */
export type PullRequestAnswer = {
  readonly pr: PullRequest | null;
  /**
   * The pull request's description as gh gave it, which is read for the
   * issues it names and never sent to a page; empty without a pull request.
   */
  readonly body: string;
  readonly notice: string | null;
};

const unavailable = 'gh did not answer, so the pull request is not shown.';

/** A network round trip, with the rollup paged to its end. */
const budget = '15 seconds';

/** Nobody is there to answer a prompt, and an upgrade notice is not an answer. */
const quiet = { GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1' };

const fields = ['number', 'url', 'title', 'body', 'state', 'isDraft', 'reviewDecision', 'statusCheckRollup'].join(',');

/**
 * The refusals that are answers: the branch has no pull request, the worktree
 * is on no branch at all, or the repository has no remote on GitHub, so no
 * pull request can exist. gh 2.96.0 words them this way, and each one means
 * there is nothing to show rather than something wrong.
 */
const nothingToShow = [
  'no pull requests found for branch',
  'could not determine current branch',
  'no git remotes found',
  'none of the git remotes configured for this repository point to a known GitHub host',
];

/**
 * One entry of the rollup. A check run has a `status`, and a `conclusion` once
 * it has completed, which gh writes as an empty string before then; a commit
 * status, such as a deployment's, has only a `state`.
 */
const CheckSchema = Schema.Struct({
  __typename: Schema.String,
  status: Schema.String.pipe(Schema.optionalKey),
  conclusion: Schema.String.pipe(Schema.optionalKey),
  state: Schema.String.pipe(Schema.optionalKey),
});
type Check = typeof CheckSchema.Type;

const ViewJson = Schema.Struct({
  number: Schema.Int,
  url: Schema.String,
  title: Schema.String,
  body: Schema.String,
  state: Schema.Literals(['OPEN', 'MERGED', 'CLOSED']),
  isDraft: Schema.Boolean,
  // gh writes an empty string when there is no decision.
  reviewDecision: Schema.String.pipe(Schema.NullOr),
  // Null when the pull request has no commit to hang checks on.
  statusCheckRollup: Schema.Array(CheckSchema).pipe(Schema.NullOr),
}).pipe(Schema.fromJsonString);

/** A check run that completed this way passed; one that completed any other way failed. */
const passingConclusions = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);

/** A commit status in one of these failed; `SUCCESS` passed, and `PENDING` or `EXPECTED` is still to come. */
const failingStates = new Set(['FAILURE', 'ERROR']);

const outcomeOf = ({ __typename: kind, status, conclusion, state }: Check): keyof PullRequest['checks'] => {
  // A commit status has no run to complete: its state is its outcome, which is
  // how gh reads it too. Counted as a run, every deployment's status would sit
  // under pending for ever.
  if (kind === 'StatusContext') {
    if (state === 'SUCCESS') return 'passed';
    return failingStates.has(state ?? '') ? 'failed' : 'pending';
  }
  if (status !== 'COMPLETED') return 'pending';
  return passingConclusions.has(conclusion ?? '') ? 'passed' : 'failed';
};

/** Every entry gh listed, counted once: nothing is merged, deduplicated or dropped. */
const countChecks = (rollup: ReadonlyArray<Check> | null): PullRequest['checks'] => {
  const checks = { passed: 0, failed: 0, pending: 0 };
  for (const check of rollup ?? []) checks[outcomeOf(check)] += 1;
  return checks;
};

/**
 * The branch's pull request, `null` when it has none or the worktree is on no
 * branch, and a notice for any other way gh can fail: missing from PATH, not
 * signed in, offline, or slower than its budget.
 */
export const pullRequestOf = (worktree: string): Effect.Effect<PullRequestAnswer, never, ChildProcessSpawner> =>
  Effect.gen(function*() {
    const result = yield* capture({
      command: 'gh',
      args: ['pr', 'view', '--json', fields],
      cwd: worktree,
      env: quiet,
      timeout: budget,
    });
    if (result.exitCode !== 0) {
      const answered = nothingToShow.some((sentence) => result.stderr.includes(sentence));
      return { pr: null, body: '', notice: answered ? null : unavailable } satisfies PullRequestAnswer;
    }
    const view = yield* Schema.decodeEffect(ViewJson)(result.stdout);
    return {
      pr: {
        number: view.number,
        url: view.url,
        title: view.title,
        state: view.state,
        isDraft: view.isDraft,
        reviewDecision: view.reviewDecision === null || view.reviewDecision === '' ? null : view.reviewDecision,
        checks: countChecks(view.statusCheckRollup),
      },
      body: view.body,
      notice: null,
    } satisfies PullRequestAnswer;
  }).pipe(Effect.catchCause(() => Effect.succeed<PullRequestAnswer>({ pr: null, body: '', notice: unavailable })));
