import * as Effect from 'effect/Effect';
import * as Schema from 'effect/Schema';
import type { ChildProcessSpawner } from 'effect/unstable/process/ChildProcessSpawner';
import type { LinearIssue } from '../../contract.ts';
import { capture } from '../command.ts';

/**
 * The Linear issues a worktree names, as the `linear` CLI reports them. A name
 * is only text: the branch and the pull request are read for anything written
 * the way Linear writes an identifier, and each one is asked for with
 * `linear issue view`, so an issue is drawn only once linear has said it
 * exists, and a word that merely looks like one draws nothing.
 */

/** What linear said, or the sentence saying why it said nothing. */
export type IssuesAnswer = {
  readonly issues: ReadonlyArray<LinearIssue>;
  readonly notice: string | null;
};

const unavailable = 'linear did not answer, so issues are not shown.';

const unauthenticated = 'linear is not authenticated, so issues are not shown.';

/** Why an ask produced no list; the sentence is the one the board shows in its place. */
type Unanswered = typeof unavailable | typeof unauthenticated;

/** A network round trip for one issue. */
const budget = '15 seconds';

/** How many issues are asked for at once, so a pull request that names many is not a burst of processes. */
const concurrency = 4;

/** Its warnings are coloured unless it is asked not to, and its stderr is read here rather than shown. */
const quiet = { NO_COLOR: '1' };

/**
 * Anything written the way Linear writes an identifier: a team key that starts
 * with a letter, a hyphen, and the issue's number, which linear's own parser
 * requires to start with 1 to 9. It is found anywhere in a text and in any
 * case, so `jason/hea-5454-upgrade` and `Linear: HEA-5454.` both name
 * `HEA-5454`.
 */
const identifierPattern = /\b[A-Za-z][A-Za-z0-9]+-[1-9]\d*\b/gu;

/** Every identifier the texts name, uppercased as Linear writes it, once each, in the order first named. */
export const identifiersIn = (texts: ReadonlyArray<string>): ReadonlyArray<string> => {
  const named = new Set<string>();
  for (const text of texts) {
    for (const [identifier] of text.matchAll(identifierPattern)) named.add(identifier.toUpperCase());
  }
  return [...named];
};

/**
 * The part of `linear issue view --json` the board shows. linear prints the
 * whole issue its query returns, and every other field is ignored.
 */
const ViewJson = Schema.Struct({
  identifier: Schema.String,
  url: Schema.String,
  title: Schema.String,
  state: Schema.Struct({ name: Schema.String }),
}).pipe(Schema.fromJsonString);

/**
 * How linear 2.6.0 says it holds no API key, whichever place it looked: the
 * environment, the project's `.linear.toml`, or the credentials `linear auth
 * login` stores.
 */
const noKey = 'No API key configured';

/**
 * Linear's two ways of saying an issue does not exist, which linear prints as
 * Linear gave them: the message meant for people, `Could not find referenced
 * Issue.`, and the raw one, `Entity not found: Issue`, when there is no other.
 */
const missing = ['could not find referenced', 'entity not found'];

/**
 * One identifier, asked of linear in the worktree, so the worktree's own
 * linear configuration picks the workspace: the issue, or null when linear
 * says there is no such issue. Any other answer fails with the sentence the
 * board shows instead of the list.
 */
const issueNamed = (identifier: string, worktree: string): Effect.Effect<LinearIssue | null, Unanswered, ChildProcessSpawner> =>
  Effect.gen(function*() {
    const result = yield* capture({
      command: 'linear',
      args: ['issue', 'view', identifier, '--json', '--no-comments'],
      cwd: worktree,
      env: quiet,
      timeout: budget,
    }).pipe(Effect.mapError((): Unanswered => unavailable));
    if (result.exitCode === 0) {
      const view = yield* Schema.decodeEffect(ViewJson)(result.stdout).pipe(
        Effect.mapError((): Unanswered => unavailable),
      );
      return { id: view.identifier, url: view.url, title: view.title, state: view.state.name } satisfies LinearIssue;
    }
    if (result.stderr.includes(noKey)) return yield* Effect.fail<Unanswered>(unauthenticated);
    const said = result.stderr.toLowerCase();
    if (missing.some((words) => said.includes(words))) return null;
    // The notice cannot say what linear said, so the daemon's log does.
    yield* Effect.logWarning(`linear issue view ${identifier}: ${result.stderr}`);
    return yield* Effect.fail<Unanswered>(unavailable);
  });

/**
 * Every issue among the identifiers, in their order, each once. Linear files
 * a moved issue under its new identifier and still answers to the old one, so
 * two names can be one issue, which is listed once, under the identifier
 * linear gives it now.
 */
const distinct = (found: ReadonlyArray<LinearIssue | null>): ReadonlyArray<LinearIssue> => {
  const byId = new Map<string, LinearIssue>();
  for (const issue of found) if (issue !== null && !byId.has(issue.id)) byId.set(issue.id, issue);
  return [...byId.values()];
};

/**
 * The issues the identifiers name, as linear reports them, and a notice when
 * linear could not say. One identifier linear cannot answer for leaves the
 * list unknown, because a partial list would read as the whole one, so the
 * first such answer ends the ask. Mixed answers cannot arise in one ask: a
 * linear without a key says so for every identifier before it asks Linear
 * anything. With no identifier, linear is not asked at all.
 */
export const issuesOf = (input: {
  readonly identifiers: ReadonlyArray<string>;
  readonly worktree: string;
}): Effect.Effect<IssuesAnswer, never, ChildProcessSpawner> =>
  Effect.forEach(input.identifiers, (identifier) => issueNamed(identifier, input.worktree), { concurrency }).pipe(
    Effect.map((found): IssuesAnswer => ({ issues: distinct(found), notice: null })),
    Effect.catch((notice) => Effect.succeed<IssuesAnswer>({ issues: [], notice })),
    // A defect here must not take the pull request down with it.
    Effect.catchCause(() => Effect.succeed<IssuesAnswer>({ issues: [], notice: unavailable })),
  );
