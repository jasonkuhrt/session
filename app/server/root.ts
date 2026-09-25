import type { Stage } from '../contract.ts';
import { stageDirectory, stageNames } from '../contract.ts';
import { entryName } from './layout.ts';

/**
 * The session root's rules: the entries it may hold, what `meta/` may hold,
 * and the fix for a stage kept under a name that is not its directory's.
 */

/** Archived items live here, outside the agent's context like `ignore/`. */
export const archiveDirectory = 'archive';

/** Whatever `ignore/` holds, at any depth, no reader of the session looks at. */
export const ignoreDirectory = 'ignore';

/** Supporting material for agents: any file, any layout, no lifecycle. */
export const contextDirectory = 'context';

/** The session's shared log, one immutable entry per file. */
export const ledgerDirectory = 'ledger';

/** The user's standing rules for the session. */
export const rulesFile = 'RULES.md';

/** Facts about this worktree's session, one file each. */
export const metaDirectory = 'meta';

/** The facts `meta/` may hold, by file name. None is defined yet, so whatever it holds is reported. */
const metaFacts: ReadonlySet<string> = new Set<string>();

/**
 * The session root is closed: it holds the stages, these directories and
 * `RULES.md`, each as its own kind, and entries whose name starts with a dot,
 * which this rule leaves alone, as the stage directories and the ledger do.
 * They are not hidden everywhere: refresh lists them and the files route
 * serves them.
 */
const rootEntries: ReadonlyMap<string, 'directory' | 'file'> = new Map([
  ...stageNames.map((stage) => [stageDirectory(stage), 'directory'] as const),
  [archiveDirectory, 'directory'],
  [ignoreDirectory, 'directory'],
  [contextDirectory, 'directory'],
  [ledgerDirectory, 'directory'],
  [metaDirectory, 'directory'],
  [rulesFile, 'file'],
]);

/** The one-file-per-stage layout's file for a stage, `TRIAGE.md`, from before stages were directories. */
export const leftoverStageFile = (stage: Stage): string => `${stage.toUpperCase()}.md`;

/**
 * The stage a directory of the root holds under a name that is not its
 * directory's: the stage's name in any case, bare, as the stages were named
 * before they were numbered (`TRIAGE`), or behind a prefix, in another case or
 * at a place that is not its own (`1-triage`, `2-Triage`). Undefined for the
 * stage's own directory and for any other name.
 */
export const misnamedStage = (name: string): Stage | undefined => {
  const bare = (entryName.exec(name)?.[2] ?? name).toLowerCase();
  return stageNames.find((stage) => stage.toLowerCase() === bare && stageDirectory(stage) !== name);
};

/**
 * What to do about a directory of the root that holds a stage under another
 * name: rename it to the stage's directory, or, when that directory is in
 * `names` already, move what it holds across. Null for any other name.
 */
export const misnamedStageProblem = (name: string, names: ReadonlySet<string>): string | null => {
  const stage = misnamedStage(name);
  if (stage === undefined) return null;
  const directory = stageDirectory(stage);
  return names.has(directory)
    ? `${name}/ does not belong in the session root beside ${directory}/; move what it holds into ${directory}/, then delete it.`
    : `${name}/ does not belong in the session root; rename it to ${directory}/.`;
};

const shownEntry = (entry: { readonly name: string; readonly type: string }): string =>
  entry.type === 'directory' ? `${entry.name}/` : entry.name;

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
  if (entry.type === expected) return null;
  return expected === 'directory'
    ? `${entry.name} must be a directory; rename it, then move it under ${contextDirectory}/ or delete it.`
    : `${entry.name} must be a file; move this ${entry.type === 'directory' ? 'directory' : 'entry'} under ${contextDirectory}/ or delete it.`;
};

/**
 * Why an entry of `meta/` does not belong there, or null when it does: it
 * holds the facts the session defines, a file each, and names starting with a
 * dot are outside the rule, as everywhere else in the session.
 */
export const metaEntryProblem = (
  entry: { readonly name: string; readonly type: 'directory' | 'file' | 'other' },
): string | null =>
  entry.name.startsWith('.') || metaFacts.has(entry.name)
    ? null
    : `${metaDirectory}/${shownEntry(entry)} is not a fact the session defines; move it under ${contextDirectory}/ or delete it.`;
