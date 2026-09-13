import type { Item, Stage } from '../contract.ts';
import { isBatchedStage } from '../contract.ts';
import {
  fail,
  parseItemFile,
  quote,
  renderItem,
  validateBatchName,
  validateItem,
} from './model.ts';

/**
 * Directory-layout rules. A stage directory holds numbered entries: item files
 * in a flat stage, batch directories of item files in QUEUE and EXECUTE. The
 * numeric prefix is the order, so the files alone answer "what comes next".
 */

/** Gap between generated prefixes, leaving room to insert without renumbering. */
const numberStep = 10;
const entryName = /^(\d+)-(.+)$/u;

/** One file of a stage, addressed relative to the session root. */
export type StageFileEntry = {
  readonly path: string;
  readonly content: string;
};

/** A stage directory as read from disk, two levels deep. */
export type StageTreeEntry = {
  readonly name: string;
  readonly type: 'directory' | 'file';
  readonly content: string;
  readonly children: ReadonlyArray<{
    readonly name: string;
    readonly type: 'directory' | 'file';
    readonly content: string;
  }>;
};

const formatPrefix = (value: number): string => String(value).padStart(3, '0');

const parseEntryName = (parent: string, name: string): { prefix: number; remainder: string } => {
  const match: RegExpExecArray = entryName.exec(name) ??
    fail(`${parent}/${name}: entries start with a numeric prefix; rename it to 010-${name}.`);
  return { prefix: Number(match[1]!), remainder: match[2]! };
};

/** Entries in prefix order, with Finder litter ignored and the layout rules enforced. */
const orderEntries = <A extends { readonly name: string }>(
  parent: string,
  entries: ReadonlyArray<A>,
): Array<{ entry: A; prefix: number; remainder: string }> => {
  const ordered: Array<{ entry: A; prefix: number; remainder: string }> = [];
  for (const entry of entries) {
    // Finder litter never carries a prefix and never belongs to the stage.
    if (entry.name.startsWith('.')) continue;
    const parsed = parseEntryName(parent, entry.name);
    ordered.push({ entry, prefix: parsed.prefix, remainder: parsed.remainder });
  }
  ordered.sort((left, right) => left.prefix - right.prefix);
  for (const [index, current] of ordered.entries()) {
    const previous = ordered[index - 1];
    if (previous !== undefined && previous.prefix === current.prefix) {
      fail(
        `${parent}: ${previous.entry.name} and ${current.entry.name} share the prefix ${formatPrefix(current.prefix)}; renumber one.`,
      );
    }
  }
  return ordered;
};

const itemIdOf = (parent: string, name: string, remainder: string): string => {
  if (!remainder.endsWith('.md')) fail(`${parent}/${name}: item files end in .md.`);
  return remainder.slice(0, -'.md'.length);
};

export const parseStageDirectory = (
  stage: Stage,
  entries: ReadonlyArray<StageTreeEntry>,
): { items: Item[]; files: StageFileEntry[] } => {
  const items: Item[] = [];
  const files: StageFileEntry[] = [];
  const batches = new Set<string>();

  for (const { entry, remainder } of orderEntries(stage, entries)) {
    if (!isBatchedStage(stage)) {
      if (entry.type !== 'file') {
        fail(`${stage}/${entry.name}: batches live in QUEUE: run \`session batch "<name>" <ID...>\`.`);
      }
      const id = itemIdOf(stage, entry.name, remainder);
      const path = `${stage}/${entry.name}`;
      items.push(parseItemFile({ stage, path, id, batch: null, content: entry.content }));
      files.push({ path, content: entry.content });
      continue;
    }

    if (entry.type !== 'directory') {
      fail(`${stage}/${entry.name}: ${stage} items live inside a batch directory.`);
    }
    const batch = validateBatchName(stage, remainder);
    if (batches.has(batch)) fail(`${stage}: two directories name the batch ${quote(batch)}.`);
    batches.add(batch);
    const directory = `${stage}/${entry.name}`;
    for (const inner of orderEntries(directory, entry.children)) {
      const child = inner.entry;
      if (child.type !== 'file') fail(`${directory}/${child.name}: a batch directory holds item files.`);
      const id = itemIdOf(directory, child.name, inner.remainder);
      const path = `${directory}/${child.name}`;
      items.push(parseItemFile({ stage, path, id, batch, content: child.content }));
      files.push({ path, content: child.content });
    }
  }

  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) fail(`${stage}: duplicate item ID ${item.id}.`);
    seen.add(item.id);
  }
  return { items, files };
};

/**
 * Prefixes for entries in their target order. Existing prefixes survive while
 * they stay strictly increasing and every new entry fits between its
 * neighbours; otherwise the whole directory is renumbered.
 */
export const numberEntries = (existing: ReadonlyArray<number | null>): number[] => {
  const kept = existing.filter((value): value is number => value !== null);
  const usable = kept.every((value, index) => value >= 1 && (index === 0 || value > kept[index - 1]!));
  const preserved = usable ? insertBetween(existing) : undefined;
  return preserved ?? existing.map((_, index) => (index + 1) * numberStep);
};

const insertBetween = (existing: ReadonlyArray<number | null>): number[] | undefined => {
  const result: number[] = [];
  let index = 0;
  while (index < existing.length) {
    const value = existing[index]!;
    if (value !== null) {
      result.push(value);
      index += 1;
      continue;
    }
    let end = index;
    while (end < existing.length && existing[end] === null) end += 1;
    const count = end - index;
    const lower = index === 0 ? 0 : existing[index - 1]!;
    const upper = existing[end] ?? null;
    if (upper === null) {
      for (let offset = 1; offset <= count; offset += 1) result.push(lower + offset * numberStep);
    } else {
      const step = Math.floor((upper - lower) / (count + 1));
      if (step < 1) return undefined;
      for (let offset = 1; offset <= count; offset += 1) result.push(lower + offset * step);
    }
    index = end;
  }
  return result;
};

/** Items grouped into their batches, in file order. */
const groupByBatch = (
  stage: Stage,
  items: ReadonlyArray<Item>,
): Array<{ batch: string; items: Item[] }> => {
  const groups: Array<{ batch: string; items: Item[] }> = [];
  for (const item of items) {
    validateItem(stage, item);
    const batch: string = item.batch ??
      fail(`${stage}/${item.id}: every ${stage} item belongs to a batch.`);
    const last = groups.at(-1);
    if (last !== undefined && last.batch === batch) {
      last.items.push(item);
      continue;
    }
    if (groups.some((group) => group.batch === batch)) {
      fail(`${stage}: batch ${quote(batch)} is split apart; keep its items together.`);
    }
    groups.push({ batch, items: [item] });
  }
  return groups;
};

/** Prefixes on disk today, so a mutation renumbers as little as possible. */
const currentPrefixes = (
  current: ReadonlyArray<StageFileEntry>,
): { batches: Map<string, number>; items: Map<string, number> } => {
  const batches = new Map<string, number>();
  const items = new Map<string, number>();
  for (const entry of current) {
    const segments = entry.path.split('/').slice(1);
    const leaf = segments.at(-1);
    if (leaf === undefined) continue;
    const parsedLeaf = entryName.exec(leaf);
    if (parsedLeaf === null || !parsedLeaf[2]!.endsWith('.md')) continue;
    const id = parsedLeaf[2]!.slice(0, -'.md'.length);
    if (segments.length === 1) {
      items.set(id, Number(parsedLeaf[1]!));
      continue;
    }
    const parsedBatch = entryName.exec(segments[0]!);
    if (parsedBatch === null) continue;
    const batch = parsedBatch[2]!;
    batches.set(batch, Number(parsedBatch[1]!));
    items.set(`${batch}/${id}`, Number(parsedLeaf[1]!));
  }
  return { batches, items };
};

/** The item files a stage directory should hold for these items, in this order. */
export const renderStageDirectory = (input: {
  readonly stage: Stage;
  readonly items: ReadonlyArray<Item>;
  readonly current: ReadonlyArray<StageFileEntry>;
}): StageFileEntry[] => {
  const { stage } = input;
  const known = currentPrefixes(input.current);
  const file = (directory: string, prefix: number, item: Item): StageFileEntry => ({
    path: `${directory}/${formatPrefix(prefix)}-${item.id}.md`,
    content: `${renderItem(item)}\n`,
  });

  if (!isBatchedStage(stage)) {
    for (const item of input.items) validateItem(stage, item);
    const prefixes = numberEntries(input.items.map((item) => known.items.get(item.id) ?? null));
    return input.items.map((item, index) => file(stage, prefixes[index]!, item));
  }

  const groups = groupByBatch(stage, input.items);
  const batchPrefixes = numberEntries(groups.map((group) => known.batches.get(group.batch) ?? null));
  return groups.flatMap((group, groupIndex) => {
    const directory = `${stage}/${formatPrefix(batchPrefixes[groupIndex]!)}-${group.batch}`;
    const prefixes = numberEntries(
      group.items.map((item) => known.items.get(`${group.batch}/${item.id}`) ?? null),
    );
    return group.items.map((item, index) => file(directory, prefixes[index]!, item));
  });
};
