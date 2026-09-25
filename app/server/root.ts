import type { Stage } from '../contract.ts';
import { stageDirectory, stageNames } from '../contract.ts';
import { contextDirectory, entryName, epicFact, metaDirectory, rootEntries } from './layout.ts';
import { nameRuleBroken, quote } from './model.ts';

/**
 * The session root's rules: whether an entry belongs there, what `meta/` may
 * hold, and the fix for a stage kept under a name that is not its directory's.
 * `layout.ts` names the entries the root holds.
 */

/**
 * The facts `meta/` may hold, each by its name and kind, as the root's entries
 * are: `epic`, the file naming the epic this worktree is in. Whatever else it
 * holds is reported.
 */
const metaFacts: ReadonlyMap<string, 'directory' | 'file'> = new Map([[epicFact, 'file']]);

/** The epic's file as a refusal names it. */
const epicPath = `${metaDirectory}/${epicFact}`;

/** How a broken epic's file is mended, by the two commands that write it whole. */
const epicFix = 'rewrite it with `session join "<epic>"`, or remove it with `session leave`';

/**
 * Why a name cannot be an epic's, or null when it can. An epic's name follows
 * a group's rules, and it is one line of a file, so it holds no line break.
 * The line break is asked about first: a file saved with Windows line endings
 * ends its name in a carriage return, which is a line break before it is a
 * surrounding space. The clause starts in lower case, for a caller to lead
 * into it.
 */
export const epicNameProblem = (name: string): string | null => {
  if (/[\n\r]/u.test(name)) return `an epic’s name is one line, and ${quote(name)} holds a line break`;
  const broken = nameRuleBroken(name);
  if (broken === 'blank') return 'an epic’s name must be non-empty and free of surrounding spaces';
  return broken === 'slash' ? `an epic’s name must not contain "/", and ${quote(name)} does` : null;
};

/**
 * The epic a `meta/epic` file names, or the rule it breaks, with its fix: the
 * file is one line, the epic's name, ending in a newline, and nothing else.
 */
export const parseEpicFile = (content: string): { readonly epic: string } | { readonly problem: string } => {
  const end = content.indexOf('\n');
  if (end === -1 || end !== content.length - 1) {
    return { problem: `${epicPath} holds one line, the epic’s name, ending in a newline; ${epicFix}.` };
  }
  const epic = content.slice(0, end);
  const problem = epicNameProblem(epic);
  return problem === null ? { epic } : { problem: `${epicPath}: ${problem}; ${epicFix}.` };
};

/** Why `meta` may not be a link: a worktree's facts are its own, and a link would share them or put them elsewhere. */
export const metaLinkProblem =
  `${metaDirectory} is a link; a worktree’s facts are its own, so make ${metaDirectory}/ a directory of its own.`;

/** Why `meta/epic` may not be a link: each worktree names its epic in a file of its own. */
export const epicLinkProblem = `${epicPath} is a link; each worktree names its epic in a file of its own, so ${epicFix}.`;

/** The one-file-per-stage layout's file for a stage, `TRIAGE.md`, from before stages were directories. */
export const leftoverStageFile = (stage: Stage): string => `${stage.toUpperCase()}.md`;

/**
 * The stage a directory of the root holds under a name that is not its
 * directory's: the stage's name in any case, bare, as the stages were named
 * before they were numbered (`TRIAGE`), or behind a prefix, in another case or
 * at a place that is not its own (`1-triage`, `2-Triage`). Undefined for the
 * stage's own directory and for any other name.
 */
const misnamedStage = (name: string): Stage | undefined => {
  const bare = (entryName.exec(name)?.[2] ?? name).toLowerCase();
  return stageNames.find((stage) => stage.toLowerCase() === bare && stageDirectory(stage) !== name);
};

/**
 * What to do about a directory of the root that holds this stage under
 * another name: rename it to the stage's directory, or, when that directory is
 * in `names` already, move what it holds across.
 */
const misnamedFix = (name: string, stage: Stage, names: ReadonlySet<string>): string => {
  const directory = stageDirectory(stage);
  return names.has(directory)
    ? `${name}/ does not belong in the session root beside ${directory}/; move what it holds into ${directory}/, then delete it.`
    : `${name}/ does not belong in the session root; rename it to ${directory}/.`;
};

/** The fix for a directory of the root that holds a stage under another name; null for any other name. */
const misnamedStageProblem = (name: string, names: ReadonlySet<string>): string | null => {
  const stage = misnamedStage(name);
  return stage === undefined ? null : misnamedFix(name, stage, names);
};

/**
 * Every name of the root that holds a stage under another name, with its fix,
 * in the flow's order of the stages they hold, so an old session is told of
 * `TRIAGE/` first. Whether each is a directory is the caller's to ask.
 */
export const misnamedStages = (
  names: ReadonlyArray<string>,
): ReadonlyArray<{ readonly name: string; readonly problem: string }> => {
  const present = new Set(names);
  return stageNames.flatMap((stage) =>
    names.filter((name) => misnamedStage(name) === stage).map((name) => ({ name, problem: misnamedFix(name, stage, present) }))
  );
};

const shownEntry = (entry: { readonly name: string; readonly type: string }): string =>
  entry.type === 'directory' ? `${entry.name}/` : entry.name;

/** The fix for an entry that has a name the rules know and the wrong kind, named as `shown`. */
const wrongKind = (
  shown: string,
  expected: 'directory' | 'file',
  type: 'directory' | 'file' | 'other',
): string =>
  expected === 'directory'
    ? `${shown} must be a directory; rename it, then move it under ${contextDirectory}/ or delete it.`
    : `${shown} must be a file; move this ${type === 'directory' ? 'directory' : 'entry'} under ${contextDirectory}/ or delete it.`;

/**
 * Why an entry of the session root does not belong there, with the fix, or
 * null when it does. `other` is anything that is neither a file nor a
 * directory, such as a link that leads nowhere. `names` is every name in the
 * root, which says whether a stage under another name can be renamed to its
 * own directory.
 */
export const rootEntryProblem = (
  entry: { readonly name: string; readonly type: 'directory' | 'file' | 'other' },
  names: ReadonlySet<string>,
): string | null => {
  if (entry.name.startsWith('.')) return null;
  const expected = rootEntries.get(entry.name);
  if (expected === undefined) {
    const misnamed = entry.type === 'directory' ? misnamedStageProblem(entry.name, names) : null;
    if (misnamed !== null) return misnamed;
    const meant = [...rootEntries].find(([name]) => name.toLowerCase() === entry.name.toLowerCase());
    return meant === undefined
      ? `${shownEntry(entry)} does not belong in the session root; move it under ${contextDirectory}/ or delete it.`
      : `${shownEntry(entry)} does not belong in the session root; rename it to ${shownEntry({ name: meant[0], type: meant[1] })}.`;
  }
  return entry.type === expected ? null : wrongKind(entry.name, expected, entry.type);
};

/**
 * Why an entry of `meta/` does not belong there, or null when it does: it
 * holds the facts the session defines, each as its own kind, and names
 * starting with a dot are outside the rule, as everywhere else in the session.
 */
export const metaEntryProblem = (
  entry: { readonly name: string; readonly type: 'directory' | 'file' | 'other' },
): string | null => {
  if (entry.name.startsWith('.')) return null;
  const expected = metaFacts.get(entry.name);
  if (expected === undefined) {
    return `${metaDirectory}/${shownEntry(entry)} is not a fact the session defines; move it under ${contextDirectory}/ or delete it.`;
  }
  return entry.type === expected ? null : wrongKind(`${metaDirectory}/${entry.name}`, expected, entry.type);
};
