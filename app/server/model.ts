import * as Data from 'effect/Data';
import type { Item, Stage } from '../contract.ts';
import { isBatchedStage } from '../contract.ts';
import { requiredSections, sectionHasContent } from '../stage-rules.ts';

export class SessionError extends Data.TaggedError('SessionError')<{
  readonly kind: 'conflict' | 'io' | 'not-found' | 'validation';
  readonly message: string;
  readonly cause?: unknown;
}> {}

const itemHeading = /^## ([A-Za-z0-9][A-Za-z0-9._-]*) — (\S(?:.*\S)?)$/u;
const batchHeading = /^# (\S(?:.*\S)?)$/u;
const fenceMarker = /^\s*(`{3,}|~{3,})/u;

export const fail = (message: string): never => {
  throw new SessionError({ kind: 'validation', message });
};

/** Quote a name inside a message without reaching for JSON. */
export const quote = (value: string): string => `"${value}"`;

/** The fix a flat stage names when it meets a batch heading. */
const batchFix = 'batches live in QUEUE: run `session batch "<name>" <ID...>`';

const summarize = (body: string, title: string): string => {
  const line = body
    .split(/\r?\n/u)
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate !== '' && !candidate.startsWith('#'));
  if (line === undefined) return title;
  return line.replace(/^[-*>\d.\s]+/u, '').slice(0, 180);
};

export const validateBatchName = (stage: Stage, name: string): string => {
  if (name.trim() !== name || name === '') {
    fail(`${stage}: batch names must be non-empty and free of surrounding spaces.`);
  }
  if (name.includes('/')) {
    fail(`${stage}: batch name ${quote(name)} must not contain "/".`);
  }
  return name;
};

export const validateItem = (stage: Stage, item: Item): void => {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(item.id)) {
    fail(`${stage}: invalid item ID ${quote(item.id)}.`);
  }
  if (item.title.trim() === '') fail(`${stage}/${item.id}: title is empty.`);
  if (item.body.trim() === '') fail(`${stage}/${item.id}: body is empty.`);
  if (isBatchedStage(stage)) {
    if (item.batch === null) fail(`${stage}/${item.id}: every ${stage} item belongs to a batch.`);
    else validateBatchName(stage, item.batch);
  } else if (item.batch !== null) {
    fail(`${stage}/${item.id}: ${batchFix}.`);
  }
  for (const section of requiredSections[stage]) {
    if (!sectionHasContent(item.body, section)) {
      fail(`${stage}/${item.id}: ### ${section} requires content.`);
    }
  }
};

export const makeItem = (input: {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly batch: string | null;
}): Item => {
  const body = input.body.trim();
  return {
    id: input.id,
    title: input.title,
    body,
    summary: summarize(body, input.title),
    batch: input.batch,
  };
};

/** One item's Markdown chunk: its heading and body, as stored in an item file. */
export const renderItem = (item: Item): string =>
  `## ${item.id} — ${item.title}\n\n${item.body.trim()}`;

// This is one state machine: item, batch, and fence transitions must stay adjacent.
// eslint-disable-next-line max-lines-per-function -- Splitting the parser would hide those transitions across helpers.
export const parseStageMarkdown = (stage: Stage, markdown: string): Item[] => {
  if (markdown === '') return [];

  const batched = isBatchedStage(stage);
  const lines = markdown.replaceAll('\r\n', '\n').split('\n');
  const items: Item[] = [];
  const batches = new Set<string>();
  let batch: string | null = null;
  let current:
    | { id: string; title: string; body: string[]; batch: string | null }
    | undefined;
  let batchHasItem = true;
  let fence: { marker: '`' | '~'; length: number } | undefined;

  const finishCurrent = () => {
    if (current === undefined) return;
    const item = makeItem({
      id: current.id,
      title: current.title,
      body: current.body.join('\n'),
      batch: current.batch,
    });
    validateItem(stage, item);
    items.push(item);
    current = undefined;
  };

  for (const [index, line] of lines.entries()) {
    if (current !== undefined) {
      const marker = fenceMarker.exec(line)?.[1];
      if (marker !== undefined) {
        const kind = marker[0] as '`' | '~';
        current.body.push(line);
        if (fence === undefined) fence = { marker: kind, length: marker.length };
        else if (kind === fence.marker && marker.length >= fence.length) fence = undefined;
        continue;
      }
      if (fence !== undefined) {
        current.body.push(line);
        continue;
      }
    }

    const itemMatch = itemHeading.exec(line);
    if (itemMatch !== null) {
      finishCurrent();
      current = { id: itemMatch[1]!, title: itemMatch[2]!, body: [], batch };
      batchHasItem = true;
      continue;
    }

    const batchMatch = batchHeading.exec(line);
    if (batchMatch !== null) {
      if (!batched) fail(`${stage}:${index + 1}: ${batchFix}.`);
      finishCurrent();
      if (!batchHasItem) fail(`${stage}:${index + 1}: batch has no items.`);
      batch = validateBatchName(stage, batchMatch[1]!);
      if (batches.has(batch)) fail(`${stage}:${index + 1}: duplicate batch ${quote(batch)}.`);
      batches.add(batch);
      batchHasItem = false;
      continue;
    }

    if (current !== undefined) {
      current.body.push(line);
      continue;
    }

    if (line.trim() !== '') {
      fail(`${stage}:${index + 1}: content must follow an item heading.`);
    }
  }

  finishCurrent();
  if (!batchHasItem) fail(`${stage}: batch has no items.`);

  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) fail(`${stage}: duplicate item ID ${item.id}.`);
    seen.add(item.id);
  }
  return items;
};

/** One item file of a directory stage: its own chunk, with the batch coming from the directory name. */
export const parseItemFile = (input: {
  readonly stage: Stage;
  readonly path: string;
  readonly id: string;
  readonly batch: string | null;
  readonly content: string;
}): Item => {
  const lines = input.content.replaceAll('\r\n', '\n').split('\n');
  const heading: RegExpExecArray = itemHeading.exec(lines[0] ?? '') ??
    fail(`${input.path}:1: an item file starts with \`## ${input.id} — <title>\`.`);
  if (heading[1] !== input.id) {
    fail(`${input.path}:1: heading ID ${heading[1]!} does not match the file name ID ${input.id}.`);
  }

  let fence: { marker: '`' | '~'; length: number } | undefined;
  for (const [index, line] of lines.slice(1).entries()) {
    const marker = fenceMarker.exec(line)?.[1];
    if (marker !== undefined) {
      const kind = marker[0] as '`' | '~';
      if (fence === undefined) fence = { marker: kind, length: marker.length };
      else if (kind === fence.marker && marker.length >= fence.length) fence = undefined;
      continue;
    }
    if (fence !== undefined) continue;
    if (batchHeading.test(line)) {
      fail(`${input.path}:${index + 2}: batch headings live in the directory name.`);
    }
    if (itemHeading.test(line)) {
      fail(`${input.path}:${index + 2}: an item file holds exactly one item.`);
    }
  }

  const item = makeItem({
    id: input.id,
    title: heading[2]!,
    body: lines.slice(1).join('\n'),
    batch: input.batch,
  });
  validateItem(input.stage, item);
  return item;
};

export const renderStageMarkdown = (stage: Stage, items: ReadonlyArray<Item>): string => {
  if (items.length === 0) return '';

  const batched = isBatchedStage(stage);
  const chunks: string[] = [];
  const seen = new Set<string>();
  let batch: string | null = null;
  for (const item of items) {
    validateItem(stage, item);
    if (batched && item.batch !== batch) {
      const name: string = item.batch ??
        fail(`${stage}/${item.id}: every ${stage} item belongs to a batch.`);
      if (seen.has(name)) {
        fail(`${stage}: batch ${quote(name)} is split apart; keep its items together.`);
      }
      seen.add(name);
      chunks.push(`# ${name}`);
      batch = name;
    }
    chunks.push(renderItem(item));
  }
  return `${chunks.join('\n\n')}\n`;
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
  stages: ReadonlyArray<{ stage: Stage; items: ReadonlyArray<Item> }>,
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
