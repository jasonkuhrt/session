import * as Data from 'effect/Data';
import type { Item, Stage } from '../contract.ts';

export class SessionError extends Data.TaggedError('SessionError')<{
  readonly kind: 'conflict' | 'io' | 'not-found' | 'validation';
  readonly message: string;
  readonly cause?: unknown;
}> {}

const itemHeading = /^## ([A-Za-z0-9][A-Za-z0-9._-]*) — (\S(?:.*\S)?)$/;
const groupHeading = /^# (\S(?:.*\S)?)$/;

const requiredSections: Record<Stage, ReadonlyArray<string>> = {
  TRIAGE: ['Decision'],
  DESIGN: ['Open questions'],
  BATCH: ['Outcome', 'Acceptance'],
  EXECUTE: ['Outcome', 'Acceptance'],
};

const fail = (message: string): never => {
  throw new SessionError({ kind: 'validation', message });
};

const sectionHasContent = (body: string, section: string): boolean => {
  const lines = body.split(/\r?\n/);
  const heading = `### ${section}`;
  let fence: { marker: '`' | '~'; length: number } | undefined;
  let index = -1;
  for (const [lineIndex, line] of lines.entries()) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker !== undefined) {
      const kind = marker[0] as '`' | '~';
      if (fence === undefined) fence = { marker: kind, length: marker.length };
      else if (kind === fence.marker && marker.length >= fence.length) fence = undefined;
      continue;
    }
    if (fence === undefined && line.trimEnd() === heading) {
      index = lineIndex;
      break;
    }
  }
  if (index === -1) return false;

  fence = undefined;
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    const line = lines[cursor]!;
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker !== undefined) {
      const kind = marker[0] as '`' | '~';
      if (fence === undefined) fence = { marker: kind, length: marker.length };
      else if (kind === fence.marker && marker.length >= fence.length) fence = undefined;
      continue;
    }
    if (fence !== undefined && line.trim() !== '') return true;
    if (fence === undefined && /^#{1,3}\s/.test(line)) return false;
    if (fence === undefined && line.trim() !== '') return true;
  }
  return false;
};

const summarize = (body: string, title: string): string => {
  const line = body
    .split(/\r?\n/)
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate !== '' && !candidate.startsWith('#'));
  if (line === undefined) return title;
  return line.replace(/^[-*>\d.\s]+/, '').slice(0, 180);
};

export const validateItem = (stage: Stage, item: Item): void => {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(item.id)) {
    fail(`${stage}: invalid item ID ${JSON.stringify(item.id)}.`);
  }
  if (item.title.trim() === '') fail(`${stage}/${item.id}: title is empty.`);
  if (item.body.trim() === '') fail(`${stage}/${item.id}: body is empty.`);
  if (item.group !== null && stage !== 'BATCH' && stage !== 'EXECUTE') {
    fail(`${stage}/${item.id}: groups are only valid in BATCH and EXECUTE.`);
  }
  for (const section of requiredSections[stage]) {
    if (!sectionHasContent(item.body, section)) {
      fail(`${stage}/${item.id}: ### ${section} requires content.`);
    }
  }
};

export const parseStageMarkdown = (stage: Stage, markdown: string): Item[] => {
  if (markdown === '') return [];

  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const items: Item[] = [];
  let group: string | null = null;
  let current:
    | { id: string; title: string; body: string[]; group: string | null }
    | undefined;
  let groupHasItem = true;
  let fence: { marker: '`' | '~'; length: number } | undefined;

  const finishCurrent = () => {
    if (current === undefined) return;
    const body = current.body.join('\n').trim();
    const item: Item = {
      id: current.id,
      title: current.title,
      body,
      summary: summarize(body, current.title),
      group: current.group,
    };
    validateItem(stage, item);
    items.push(item);
    current = undefined;
  };

  for (const [index, line] of lines.entries()) {
    if (current !== undefined) {
      const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
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
      current = {
        id: itemMatch[1]!,
        title: itemMatch[2]!,
        body: [],
        group,
      };
      groupHasItem = true;
      continue;
    }

    const groupMatch = groupHeading.exec(line);
    if ((stage === 'BATCH' || stage === 'EXECUTE') && groupMatch !== null) {
      finishCurrent();
      if (!groupHasItem) fail(`${stage}:${index + 1}: group has no items.`);
      group = groupMatch[1]!;
      groupHasItem = false;
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
  if (!groupHasItem) fail(`${stage}: group has no items.`);

  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) fail(`${stage}: duplicate item ID ${item.id}.`);
    seen.add(item.id);
  }
  return items;
};

export const renderStageMarkdown = (stage: Stage, items: Item[]): string => {
  if (items.length === 0) return '';

  const chunks: string[] = [];
  let group: string | null = null;
  for (const item of items) {
    validateItem(stage, item);
    if (
      (stage === 'BATCH' || stage === 'EXECUTE') &&
      group !== null &&
      item.group === null
    ) {
      fail(`${stage}: ungrouped items must appear before grouped items.`);
    }
    if ((stage === 'BATCH' || stage === 'EXECUTE') && item.group !== group) {
      if (item.group !== null) chunks.push(`# ${item.group}`);
      group = item.group;
    }
    chunks.push(`## ${item.id} — ${item.title}\n\n${item.body.trim()}`);
  }
  return `${chunks.join('\n\n')}\n`;
};

export const findRequiredItem = (
  stages: ReadonlyArray<{ stage: Stage; items: Item[] }>,
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
  stages: ReadonlyArray<{ stage: Stage; items: Item[] }>,
): void => {
  const owners = new Map<string, Stage>();
  for (const stage of stages) {
    for (const item of stage.items) {
      const owner = owners.get(item.id);
      if (owner !== undefined) {
        fail(`Item ID ${item.id} appears in both ${owner} and ${stage.stage}.`);
      }
      owners.set(item.id, stage.stage);
    }
  }
};
