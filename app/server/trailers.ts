import * as Arr from 'effect/Array';
import * as Effect from 'effect/Effect';
import * as Schema from 'effect/Schema';
import type { TrailerProblem } from '../contract.ts';
import { doneTrailer } from '../contract.ts';
import { capture } from './command.ts';
import type { SessionRepository } from './repository.ts';

/**
 * Items closed by the commits that finish them.
 *
 * A commit whose message ends with `Session-Done: <ID>` says it finished that
 * item, and the engine files the item as done. Git's own trailer parser reads
 * the message, so what counts as a trailer here is what counts as one to
 * `git interpret-trailers`. A value is ids separated by commas or spaces, and a
 * line is filed whole or not at all: a word on it that names no item of the
 * session, which prose after an id is, files nothing on the line and is
 * reported with the line.
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

/**
 * Hash, subject, the `Session-Done` trailers Git reads, one per line with its
 * key and its value unfolded, and the whole message for the lines it does not.
 */
const logFormat = ['%H', '%s', `%(trailers:key=${doneTrailer},unfold)`, '%B'].join('%x1f');

/**
 * A `Session-Done:` line: the key in any case, as Git matches keys, and the
 * spaces Git allows before the colon, then the value.
 */
const doneLine = new RegExp(`^${doneTrailer}[ \\t]*:(.*)$`, 'gimu');

/**
 * Every `Session-Done:` line of a text, as written, with the words of its
 * value, which commas or spaces split, once each, and whether Git reads the
 * lines of this text as trailers.
 */
const doneLines = (text: string, trailer: boolean) =>
  [...text.matchAll(doneLine)].map((match) => ({
    line: match[0].trimEnd(),
    words: Arr.dedupe((match[1] ?? '').split(/[\s,]+/u).filter((word) => word !== '')),
    trailer,
  }));

/** One `Session-Done:` line of a commit: the line as written, the words of its value, and whether Git reads it as a trailer. */
export const DoneLineSchema = Schema.Struct({
  line: Schema.String,
  words: Schema.Array(Schema.String),
  trailer: Schema.Boolean,
});
export type DoneLine = typeof DoneLineSchema.Type;

/** What one commit says it finished: its full hash, its subject, and its `Session-Done:` lines in the order written. */
export const CommitClaimSchema = Schema.Struct({
  hash: Schema.String,
  subject: Schema.String,
  lines: Schema.Array(DoneLineSchema),
});
export type CommitClaim = typeof CommitClaimSchema.Type;

const decodeClaims = Schema.decodeUnknownEffect(Schema.Array(CommitClaimSchema));

/**
 * `git log`'s records, one per commit, each read into the claim it makes; the
 * caller decodes them. Git's trailer block ends the message, so its
 * `Session-Done` trailers are the message's last `Session-Done:` lines, in
 * order, and every such line before them is outside the block, where Git reads
 * no trailer. A line written twice is one line, and so is a line outside the
 * block that a trailer repeats word for word, which says nothing the trailer
 * does not.
 */
const parseClaims = (stdout: string): CommitClaim[] => {
  const claims: CommitClaim[] = [];
  for (const record of stdout.split('\0')) {
    const [hash, subject, trailers, message] = record.split(unitSeparator);
    if (hash === undefined || hash === '' || subject === undefined) continue;
    const trailed = doneLines(trailers ?? '', true);
    const written = doneLines(message ?? '', false);
    const repeated = new Set(trailed.map((line) => line.words.join(' ')));
    const outside = written
      .slice(0, Math.max(0, written.length - trailed.length))
      .filter((line) => !repeated.has(line.words.join(' ')));
    const lines = Arr.dedupeWith(
      [...outside, ...trailed],
      (left, right) => left.line === right.line && left.trailer === right.trailer,
    );
    if (lines.length > 0) claims.push({ hash, subject, lines });
  }
  return claims;
};

/**
 * This branch's commits that no remote has, oldest first, read from Git's log
 * and decoded. First parent only, so a merge brings in no other branch's
 * claims; a repository Git cannot read has no claims. The claims are strings
 * the reading has already checked, so only a flaw of this reading fails the
 * decode, and then the pass, which the daemon's log says.
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
    Effect.map((result) => (result.exitCode === 0 ? result.stdout : null)),
    Effect.orElseSucceed(() => null),
    Effect.flatMap((stdout) =>
      stdout === null ? Effect.succeed<ReadonlyArray<CommitClaim>>([]) : decodeClaims(parseClaims(stdout))
    ),
  );

/**
 * Act on every unpushed claim, and say which lines could not be acted on, in
 * the order the commits and their lines were written. An id on a line outside
 * the block that a trailer of the same commit names too needs no report of
 * its own.
 */
export const reconcileTrailers = (input: { readonly worktree: string; readonly repository: SessionRepository }) =>
  Effect.gen(function*() {
    const claims = yield* unpushedClaims(input.worktree);
    if (claims.length === 0) return [];
    const outcomes = yield* input.repository.closeFromCommits(claims);
    const problems: TrailerProblem[] = [];
    const reportedOutside = new Set<string>();
    for (const { claim, line, outcome } of outcomes) {
      const commit = { commit: claim.hash, subject: claim.subject };
      if (outcome.kind === 'empty') {
        problems.push({ ...commit, kind: 'empty', line: line.line });
        continue;
      }
      if (outcome.kind === 'unknown') {
        problems.push({ ...commit, kind: 'unknown', line: line.line, words: outcome.words });
        continue;
      }
      if (outcome.kind === 'filed') {
        for (const { id, message } of outcome.failures) problems.push({ ...commit, kind: 'close-failed', id, detail: message });
        continue;
      }
      const trailed = new Set(claim.lines.flatMap((other) => (other.trailer ? other.words : [])));
      for (const id of line.words) {
        if (trailed.has(id) || reportedOutside.has(`${claim.hash} ${id}`)) continue;
        reportedOutside.add(`${claim.hash} ${id}`);
        problems.push({ ...commit, kind: 'outside-trailers', id, detail: null });
      }
    }
    return problems;
  });
