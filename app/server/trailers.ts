import * as Effect from 'effect/Effect';
import type { TrailerProblem } from '../contract.ts';
import { doneTrailer } from '../contract.ts';
import { capture } from './command.ts';
import type { CommitClaim, SessionRepository } from './repository.ts';

/**
 * Items closed by the commits that finish them.
 *
 * A commit whose message ends with `Session-Done: <ID>` says it finished that
 * item, and the engine files the item as done. Git's own trailer parser reads
 * the message, so what counts as a trailer here is what counts as one to
 * `git interpret-trailers`.
 *
 * Only commits no remote has yet are read. Those are the commits a wrong
 * trailer can still be fixed on, so a problem is reported exactly while it is
 * fixable; and the unpushed range is what a restarted daemon has to catch up
 * on, so a commit made while it was down is honoured when it comes back.
 * Every pass is derived from the history and the files as they are.
 */

/** A branch's unpushed history rarely runs to dozens; this bounds a stray one. */
const commitLimit = 200;

const unitSeparator = '\u001F';

/** Hash, subject, the trailer's values one per line, and the whole message for stray lines. */
const logFormat = ['%H', '%s', `%(trailers:key=${doneTrailer},valueonly)`, '%B'].join('%x1f');

/** A trailer's value may name several items, split by commas or spaces. */
const idsIn = (value: string): string[] => value.split(/[\s,]+/u).filter((id) => id !== '');

/** Every id on a `Session-Done:` line anywhere in a message; keys match as Git's do, ignoring case. */
const linedIds = (message: string): string[] =>
  [...message.matchAll(new RegExp(`^${doneTrailer}:(.*)$`, 'gimu'))].flatMap((match) => idsIn(match[1] ?? ''));

/** What a commit says it finished, and the ids it names where Git does not read a trailer. */
type Claim = CommitClaim & { readonly strays: readonly string[] };

const parseClaims = (stdout: string): Claim[] => {
  const claims: Claim[] = [];
  for (const record of stdout.split('\0')) {
    const [hash, subject, trailers, message] = record.split(unitSeparator);
    if (hash === undefined || hash === '' || subject === undefined) continue;
    const ids = idsIn(trailers ?? '');
    const trailed = new Set(ids);
    const strays = linedIds(message ?? '').filter((id) => !trailed.has(id));
    if (ids.length > 0 || strays.length > 0) claims.push({ hash, subject, ids, strays });
  }
  return claims;
};

/**
 * This branch's commits that no remote has, oldest first. First parent only,
 * so a merge brings in no other branch's claims; a repository Git cannot read
 * has no claims.
 */
const unpushedClaims = (worktree: string) =>
  capture({
    command: 'git',
    args: [
      'log',
      '-z',
      '--reverse',
      '--first-parent',
      `--max-count=${commitLimit}`,
      `--format=${logFormat}`,
      'HEAD',
      '--not',
      '--remotes',
    ],
    cwd: worktree,
    timeout: '10 seconds',
  }).pipe(
    Effect.map((result) => (result.exitCode === 0 ? parseClaims(result.stdout) : [])),
    Effect.orElseSucceed((): Claim[] => []),
  );

/** Act on every unpushed claim, and say which ones could not be acted on. */
export const reconcileTrailers = (input: { readonly worktree: string; readonly repository: SessionRepository }) =>
  Effect.gen(function*() {
    const claims = yield* unpushedClaims(input.worktree);
    if (claims.length === 0) return [];
    const outcomes = yield* input.repository.closeFromCommits(claims);
    const problems: TrailerProblem[] = [];
    for (const claim of claims) {
      for (const id of claim.strays) {
        problems.push({ commit: claim.hash, subject: claim.subject, id, kind: 'outside-trailers', detail: null });
      }
    }
    for (const { claim, id, outcome } of outcomes) {
      if (outcome.kind === 'honoured') continue;
      problems.push({
        commit: claim.hash,
        subject: claim.subject,
        id,
        kind: outcome.kind === 'unknown' ? 'unknown' : 'close-failed',
        detail: outcome.kind === 'failed' ? outcome.message : null,
      });
    }
    return problems;
  });
