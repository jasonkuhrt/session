import * as Effect from 'effect/Effect';
import * as Result from 'effect/Result';
import type { TrailerProblem } from '../contract.ts';
import { doneTrailer } from '../contract.ts';
import { capture } from './command.ts';
import { makeRepository, type SessionRepository } from './repository.ts';

/**
 * Items closed by the commits that finish them.
 *
 * A commit whose message ends with `Session-Done: <ID>` says it finished that
 * item, and the daemon files the item as done once the commit exists. Git's own
 * trailer parser reads the message, so what counts as a trailer here is what
 * counts as one to `git interpret-trailers`.
 *
 * Only commits no remote has yet are read. Those are the commits a wrong
 * trailer can still be fixed on, so a problem is reported exactly while it is
 * fixable; and the unpushed range is what a restarted daemon has to catch up
 * on, so a commit made while it was down is honoured when it comes back.
 *
 * Every pass is derived from the history and the files as they are, and holds
 * nothing of its own. What makes a second pass harmless is the record itself:
 * closing an item writes the commit into the archived file, so an item that
 * was brought back after a commit filed it is recognised and left alone.
 */

/** A branch's unpushed history rarely runs to dozens; this bounds a stray one. */
const commitLimit = 200;

const unitSeparator = '\u001F';
const recordSeparator = '\u001E';
const valueSeparator = '\u001D';

/** Hash, subject, the trailer's values, and the whole message for stray lines. */
const logFormat = [
  '%H',
  '%s',
  `%(trailers:key=${doneTrailer},valueonly,separator=%x1d)`,
  '%B',
].join('%x1f') + '%x1e';

/** What one commit says it finished. */
type Claim = {
  readonly hash: string;
  readonly subject: string;
  /** Ids from the message's trailer block, which is what Git reads. */
  readonly ids: readonly string[];
  /** Ids on `Session-Done:` lines elsewhere in the message, which Git ignores. */
  readonly strays: readonly string[];
};

/** Between ids: the separator Git was asked for, a comma, or whitespace. */
const idBoundary = new RegExp(`[\\s,${valueSeparator}]+`, 'u');

/** One trailer may name several items, split by commas or spaces. */
const idsIn = (value: string): string[] =>
  value.split(idBoundary).filter((id) => id !== '');

/** Every id on a `Session-Done:` line anywhere in a message; keys match as Git's do, ignoring case. */
const linedIds = (message: string): string[] => {
  const ids: string[] = [];
  for (const match of message.matchAll(new RegExp(`^${doneTrailer}:(.*)$`, 'gimu'))) {
    ids.push(...idsIn(match[1] ?? ''));
  }
  return ids;
};

const parseClaims = (stdout: string): Claim[] => {
  const claims: Claim[] = [];
  for (const record of stdout.split(recordSeparator)) {
    const [hash, subject, trailers, message] = record.replace(/^\n/u, '').split(unitSeparator);
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
    Effect.map((result) => (result.exitCode === 0 ? parseClaims(result.stdout).toReversed() : [])),
    Effect.orElseSucceed((): Claim[] => []),
  );

const isLive = (repository: SessionRepository, id: string) =>
  repository.load.pipe(
    Effect.map((session) => ({
      session,
      live: session.stages.some((stage) => stage.items.some((item) => item.id === id)),
    })),
  );

/**
 * File one named item away. A board can write between the read and the close,
 * which the engine refuses as a changed revision; one fresh read settles that,
 * and a second refusal is a real one.
 */
const closeNamed = (repository: SessionRepository, claim: Claim, id: string) =>
  Effect.gen(function*() {
    const close = Effect.gen(function*() {
      const { session } = yield* isLive(repository, id);
      return yield* repository.closeItem({
        id,
        revision: session.revision,
        commit: { hash: claim.hash, subject: claim.subject },
      });
    });
    const first = yield* close.pipe(Effect.result);
    if (Result.isSuccess(first)) return null;
    const second = yield* close.pipe(Effect.result);
    return Result.isSuccess(second) ? null : second.failure.message;
  });

/** Act on every unpushed claim, and say which ones could not be acted on. */
export const reconcileTrailers = (input: { readonly worktree: string; readonly directory: string }) =>
  Effect.gen(function*() {
    const claims = yield* unpushedClaims(input.worktree);
    if (claims.length === 0) return [];
    const repository = yield* makeRepository(input.directory);
    const problems: TrailerProblem[] = [];
    const report = (claim: Claim, id: string, kind: TrailerProblem['kind'], detail: string | null) => {
      problems.push({ commit: claim.hash, subject: claim.subject, id, kind, detail });
    };

    for (const claim of claims) {
      for (const id of claim.strays) report(claim, id, 'outside-trailers', null);
      for (const id of claim.ids) {
        const { live } = yield* isLive(repository, id);
        if (!live) {
          const archived = (yield* repository.archivedRecords).some((record) => record.id === id);
          if (!archived) report(claim, id, 'unknown', null);
          continue;
        }
        // This commit already filed it once, and a person brought it back.
        if (yield* repository.archivedByCommit({ id, hash: claim.hash })) continue;
        const failure = yield* closeNamed(repository, claim, id);
        if (failure !== null) report(claim, id, 'close-failed', failure);
      }
    }
    return problems;
  });

/** One string per answer, so two passes that found the same problems compare equal. */
export const problemsKey = (problems: readonly TrailerProblem[]): string =>
  problems
    .map((problem) => [problem.commit, problem.id, problem.kind, problem.detail ?? ''].join(unitSeparator))
    .join(recordSeparator);
