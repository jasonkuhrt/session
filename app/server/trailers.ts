import * as Arr from 'effect/Array';
import * as Effect from 'effect/Effect';
import * as Schema from 'effect/Schema';
import type { TrailerProblem } from '../contract.ts';
import { doneTrailer } from '../contract.ts';
import { capture } from './command.ts';
import { isItemId } from './model.ts';
import type { SessionRepository } from './repository.ts';

/**
 * Items closed by the commits that finish them.
 *
 * A commit whose message ends with `Session-Done: <ID>` says it finished that
 * item, and the engine files the item as done. Git's own trailer parser reads
 * the message, so what counts as a trailer here is what counts as one to
 * `git interpret-trailers`. A value holds ids only, separated by commas or
 * spaces: a line whose value holds any other word is prose, or a slip, and is
 * reported whole, with none of its ids filed.
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

/** Every `Session-Done:` line of a text, as written, and the words of its value, which commas or spaces split. */
const doneLines = (text: string) =>
  [...text.matchAll(doneLine)].map((match) => ({
    line: match[0].trimEnd(),
    words: (match[1] ?? '').split(/[\s,]+/u).filter((word) => word !== ''),
  }));

/** What one commit says it finished: its full hash, its subject, and the ids its `Session-Done` trailers name. */
export const CommitClaimSchema = Schema.Struct({
  hash: Schema.String,
  subject: Schema.String,
  ids: Schema.Array(Schema.String),
});
export type CommitClaim = typeof CommitClaimSchema.Type;

/** A `Session-Done:` line whose value holds words that are not ids: the line as written, and those words. */
const NotIdsSchema = Schema.Struct({
  line: Schema.String,
  words: Schema.NonEmptyArray(Schema.String),
});
type NotIds = typeof NotIdsSchema.Type;

/**
 * What a commit says it finished, the ids it names on `Session-Done:` lines
 * Git does not read as trailers, and its lines that hold words that are not ids.
 */
const ClaimSchema = Schema.Struct({
  ...CommitClaimSchema.fields,
  strays: Schema.Array(Schema.String),
  notIds: Schema.Array(NotIdsSchema),
});
type Claim = typeof ClaimSchema.Type;

const decodeClaims = Schema.decodeUnknownEffect(Schema.Array(ClaimSchema));

/** A line's ids, or, when its value holds any other word, the line with those words. */
const readLine = ({ line, words }: { readonly line: string; readonly words: ReadonlyArray<string> }) => {
  const others = words.filter((word) => !isItemId(word));
  return Arr.isArrayNonEmpty(others) ? { ids: [], notIds: { line, words: others } } : { ids: words, notIds: null };
};

/**
 * `git log`'s records, one per commit, each read into the claim it makes; the
 * caller decodes them. Git's trailer block ends the message, so its
 * `Session-Done` trailers are the message's last `Session-Done:` lines, in
 * order, and every such line before them is outside the block, where Git reads
 * no trailer.
 */
const parseClaims = (stdout: string): Claim[] => {
  const claims: Claim[] = [];
  for (const record of stdout.split('\0')) {
    const [hash, subject, trailers, message] = record.split(unitSeparator);
    if (hash === undefined || hash === '' || subject === undefined) continue;
    const trailed = doneLines(trailers ?? '').map((line) => readLine(line));
    const written = doneLines(message ?? '');
    const outside = written.slice(0, Math.max(0, written.length - trailed.length)).map((line) => readLine(line));
    const ids = new Set(trailed.flatMap((read) => read.ids));
    const strays = new Set(outside.flatMap((read) => read.ids).filter((id) => !ids.has(id)));
    // A line written twice is one problem, as an id named twice is one claim.
    const notIds = Arr.dedupeWith(
      [...outside, ...trailed].flatMap((read): NotIds[] => (read.notIds === null ? [] : [read.notIds])),
      (left, right) => left.line === right.line,
    );
    if (ids.size > 0 || strays.size > 0 || notIds.length > 0) {
      claims.push({ hash, subject, ids: [...ids], strays: [...strays], notIds });
    }
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
    Effect.flatMap((stdout) => (stdout === null ? Effect.succeed<ReadonlyArray<Claim>>([]) : decodeClaims(parseClaims(stdout)))),
  );

/** Act on every unpushed claim, and say which ones could not be acted on. */
export const reconcileTrailers = (input: { readonly worktree: string; readonly repository: SessionRepository }) =>
  Effect.gen(function*() {
    const claims = yield* unpushedClaims(input.worktree);
    if (claims.length === 0) return [];
    const outcomes = yield* input.repository.closeFromCommits(claims);
    const problems: TrailerProblem[] = [];
    for (const claim of claims) {
      for (const { line, words } of claim.notIds) {
        problems.push({ commit: claim.hash, subject: claim.subject, kind: 'not-ids', line, words });
      }
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
