import * as Data from 'effect/Data';
import type { Item, Stage } from '../contract.ts';
import { isBatchedStage, stageDirectory } from '../contract.ts';
import { requiredSections, scanFences, sectionHasContent } from '../stage-rules.ts';

export class SessionError extends Data.TaggedError('SessionError')<{
  readonly kind: 'conflict' | 'io' | 'not-found' | 'validation';
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** An item before its file has a place: the path follows from the stage's order. */
export type ItemDraft = Omit<Item, 'path'>;

/** What an item id may be, as a pattern source for every reader that finds one in text. */
export const itemIdSource = '[A-Za-z0-9][A-Za-z0-9._-]*';

const itemHeading = new RegExp(`^## (${itemIdSource}) — (\\S(?:.*\\S)?)$`, 'u');
const itemIdExactly = new RegExp(`^${itemIdSource}$`, 'u');
const groupHeading = /^# (\S(?:.*\S)?)$/u;

export const fail = (message: string): never => {
  throw new SessionError({ kind: 'validation', message });
};

/** Quote a name inside a message without reaching for JSON. */
export const quote = (value: string): string => `"${value}"`;

const summarize = (body: string, title: string): string => {
  const line = body
    .split(/\r?\n/u)
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate !== '' && !candidate.startsWith('#'));
  if (line === undefined) return title;
  return line.replace(/^[-*>\d.\s]+/u, '').slice(0, 180);
};

/** What a stage calls its groups: in Queue and Execute a group is a batch. */
export const groupNoun = (stage: Stage): 'batch' | 'group' => (isBatchedStage(stage) ? 'batch' : 'group');

/**
 * A group's name is the rest of its directory's name, so it must survive
 * being one: non-empty, without surrounding spaces, and without `/`. `where`
 * is what a refusal names, the directory itself when one is being read.
 */
export const validateGroupName = (stage: Stage, name: string, where: string = stage): string => {
  const noun = groupNoun(stage);
  if (name.trim() !== name || name === '') {
    fail(`${where}: ${noun} names must be non-empty and free of surrounding spaces.`);
  }
  if (name.includes('/')) {
    fail(`${where}: ${noun} name ${quote(name)} must not contain "/".`);
  }
  return name;
};

/** Structure: what every reader of the files must be able to rely on. */
export const validateItem = (stage: Stage, item: ItemDraft): void => {
  if (!itemIdExactly.test(item.id)) {
    fail(`${stage}: invalid item ID ${quote(item.id)}.`);
  }
  if (item.title.trim() === '') fail(`${stageDirectory(stage)}/${item.id}: title is empty.`);
  if (item.body.trim() === '') fail(`${stageDirectory(stage)}/${item.id}: body is empty.`);
  if (item.group !== null) validateGroupName(stage, item.group);
  else if (isBatchedStage(stage)) fail(`${stageDirectory(stage)}/${item.id}: every ${stage} item belongs to a batch.`);
};

/**
 * Content: the sections a stage requires of the items it holds. A mutation
 * checks the stage it places an item in, and `check` checks where each item
 * sits. Loading does not, so an item file can be rewritten for its next stage
 * and moved there afterwards.
 */
export const validateItemSections = (stage: Stage, item: ItemDraft): void => {
  for (const section of requiredSections[stage]) {
    if (!sectionHasContent(item.body, section)) {
      fail(`${stageDirectory(stage)}/${item.id}: ### ${section} requires content.`);
    }
  }
};

export const makeItem = (input: {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly group: string | null;
}): ItemDraft => {
  const body = input.body.trim();
  return {
    id: input.id,
    title: input.title,
    body,
    summary: summarize(body, input.title),
    group: input.group,
  };
};

/** One item's Markdown chunk: its heading and body, as stored in an item file. */
export const renderItem = (item: ItemDraft): string =>
  `## ${item.id} — ${item.title}\n\n${item.body.trim()}`;

/** One item file of a stage directory: its group, when it has one, comes from the directory name. */
export const parseItemFile = (input: {
  readonly stage: Stage;
  readonly path: string;
  readonly id: string;
  readonly group: string | null;
  readonly content: string;
}): Item => {
  const lines = input.content.replaceAll('\r\n', '\n').split('\n');
  const heading: RegExpExecArray = itemHeading.exec(lines[0] ?? '') ??
    fail(`${input.path}:1: an item file starts with \`## ${input.id} — <title>\`.`);
  if (heading[1] !== input.id) {
    fail(`${input.path}:1: heading ID ${heading[1]!} does not match the file name ID ${input.id}.`);
  }

  for (const [index, line] of scanFences(lines.slice(1)).entries()) {
    if (line.place !== 'prose') continue;
    if (groupHeading.test(line.text)) {
      fail(`${input.path}:${index + 2}: a group, a batch included, is named by its directory, not by a \`# \` heading.`);
    }
    if (itemHeading.test(line.text)) {
      fail(`${input.path}:${index + 2}: an item file holds exactly one item.`);
    }
  }

  const draft = makeItem({
    id: input.id,
    title: heading[2]!,
    body: lines.slice(1).join('\n'),
    group: input.group,
  });
  validateItem(input.stage, draft);
  return { ...draft, path: input.path };
};

export const findRequiredItem = (
  stages: ReadonlyArray<{ stage: Stage; items: ReadonlyArray<Item> }>,
  id: string,
): { stage: Stage; item: Item } => {
  for (const stage of stages) {
    const item = stage.items.find((candidate) => candidate.id === id);
    if (item !== undefined) return { stage: stage.stage, item };
  }
  throw new SessionError({
    kind: 'not-found',
    message: `Item ${id} does not exist.`,
  });
};

export const validateUniqueIds = (
  stages: ReadonlyArray<{ stage: Stage; items: ReadonlyArray<ItemDraft> }>,
): void => {
  const owners = new Map<string, Stage>();
  for (const stage of stages) {
    for (const item of stage.items) {
      const owner = owners.get(item.id);
      if (owner === stage.stage) fail(`${stage.stage}: duplicate item ID ${item.id}.`);
      if (owner !== undefined) {
        fail(`Item ID ${item.id} appears in both ${owner} and ${stage.stage}.`);
      }
      owners.set(item.id, stage.stage);
    }
  }
};
