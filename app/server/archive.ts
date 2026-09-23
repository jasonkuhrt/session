import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';
import { stageNames } from '../contract.ts';
import { archiveDirectory } from './layout.ts';
import { itemIdSource } from './model.ts';

/**
 * Archived records: how a filed item's file is named, how that name is read
 * back, and the note a commit that closed an item leaves in its text. The
 * directory is flat, one file per filed item.
 */

/** The archive day, in the machine's own zone: this is a human's filing. */
export const archiveDay = DateTime.now.pipe(
  Effect.map((now) => DateTime.formatIsoDate(now.pipe(DateTime.setZone(DateTime.zoneMakeLocal())))),
);

/** A name that reads on its own: the day, the item, and the state it left. */
export const archiveFilePath = (input: {
  readonly day: string;
  readonly id: string;
  readonly title: string;
  readonly state: string;
}): string =>
  `${archiveDirectory}/${input.day} ${input.id} — ${input.title.replaceAll('/', '-')} (${input.state}).md`;

/** The state a record left in: `done`, or the stage it was filed from. */
const archiveStates = ['done', ...stageNames.map((stage) => stage.toLowerCase())];

const archivedName = new RegExp(
  `^(\\d{4}-\\d{2}-\\d{2}) (${itemIdSource}) — (?:(\\S(?:.*\\S)?) \\((${archiveStates.join('|')})\\)\\.md$)?`,
  'u',
);

/**
 * What an archived record's name says: the day it was filed and the item, and,
 * when the rest of the name is the one `archiveFilePath` writes, the title and
 * the state it left in.
 */
export type ArchiveName = {
  readonly day: string;
  readonly id: string;
  readonly title: string | null;
  readonly state: string | null;
};

/** The one reader of archive names; null for a name that does not start the way `archiveFilePath` writes one. */
export const parseArchiveName = (name: string): ArchiveName | null => {
  const match = archivedName.exec(name);
  if (match === null) return null;
  return { day: match[1]!, id: match[2]!, title: match[3] ?? null, state: match[4] ?? null };
};

const closedHeading = '### Closed by commit';

/**
 * The note a commit that closed an item leaves in the item's own text: the
 * commit's full hash and its subject, under a heading of its own. It travels
 * with the item wherever the file goes, into the archive and back out of it.
 */
export const closedByCommitNote = (commit: { readonly hash: string; readonly subject: string }): string =>
  `${closedHeading}\n\n\`${commit.hash}\` ${commit.subject}`;

const closedLine = /^`([0-9a-f]{40,64})` /u;

/** The commits whose notes an item's text carries: the reader of `closedByCommitNote`. */
export const commitsThatClosed = (text: string): ReadonlySet<string> => {
  const hashes = new Set<string>();
  const lines = text.split('\n');
  for (const [index, line] of lines.entries()) {
    if (line.trimEnd() !== closedHeading) continue;
    const hash = closedLine.exec(lines[index + 2] ?? '')?.[1];
    if (hash !== undefined) hashes.add(hash);
  }
  return hashes;
};
