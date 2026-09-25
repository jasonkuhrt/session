import type { Item, Stage } from '../contract.ts';
import { isBatchedStage, stageDirectory } from '../contract.ts';
import {
  fail,
  groupNoun,
  type ItemDraft,
  parseItemFile,
  quote,
  renderItem,
  validateGroupName,
  validateItem,
} from './model.ts';

/**
 * Directory-layout rules for the stages; `root.ts` has the session root's. A
 * stage directory, `1-Triage` to `5-Execute`, holds numbered entries: item
 * files and group directories of item files side by side in Triage, Design and
 * Batch, and group directories only in Queue and Execute, where each group is a
 * batch. The numeric prefix is the order, so the files alone answer "what comes
 * next".
 */

/** Gap between generated prefixes, leaving room to insert without renumbering. */
const numberStep = 10;
/** A numbered entry of a stage directory: its prefix, then an item file's `<ID>.md` or a group's name. */
export const entryName = /^(\d+)-(.+)$/u;

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
  const groups = new Set<string>();
  const noun = groupNoun(stage);
  const parent = stageDirectory(stage);
  // A directory holding nothing a reader sees, nothing or only dot entries, is no group: the next write
  // removes it and no reader counts it meanwhile, so one an interrupted write leaves behind breaks nothing.
  const held = entries.filter((entry) => entry.type === 'file' || entry.children.some((child) => !child.name.startsWith('.')));

  for (const { entry, remainder } of orderEntries(parent, held)) {
    if (entry.type === 'file') {
      if (isBatchedStage(stage)) fail(`${parent}/${entry.name}: ${stage} items live inside a batch directory.`);
      const id = itemIdOf(parent, entry.name, remainder);
      const path = `${parent}/${entry.name}`;
      items.push(parseItemFile({ stage, path, id, group: null, content: entry.content }));
      files.push({ path, content: entry.content });
      continue;
    }

    const directory = `${parent}/${entry.name}`;
    const group = validateGroupName(stage, remainder, directory);
    if (groups.has(group)) fail(`${parent}: two directories name the ${noun} ${quote(group)}; merge them into one or rename one.`);
    groups.add(group);
    for (const inner of orderEntries(directory, entry.children)) {
      const child = inner.entry;
      if (child.type !== 'file') fail(`${directory}/${child.name}: a ${noun} directory holds item files only; ${noun}s do not nest.`);
      const id = itemIdOf(directory, child.name, inner.remainder);
      const path = `${directory}/${child.name}`;
      items.push(parseItemFile({ stage, path, id, group, content: child.content }));
      files.push({ path, content: child.content });
    }
  }

  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) fail(`${parent}: duplicate item ID ${item.id}.`);
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

/** One entry of a stage directory to render: an item file, or a group's directory with its items. */
type TopLevelEntry =
  | { readonly kind: 'item'; readonly item: ItemDraft }
  | { readonly kind: 'group'; readonly name: string; readonly items: ItemDraft[] };

/**
 * A stage's items, in file order, as the entries of its directory: an item in
 * no group is a file of its own, and a group's consecutive items one directory.
 */
const topLevelEntries = (stage: Stage, items: ReadonlyArray<ItemDraft>): TopLevelEntry[] => {
  const entries: TopLevelEntry[] = [];
  for (const item of items) {
    validateItem(stage, item);
    const last = entries.at(-1);
    if (item.group === null) entries.push({ kind: 'item', item });
    else if (last?.kind === 'group' && last.name === item.group) last.items.push(item);
    else if (entries.some((entry) => entry.kind === 'group' && entry.name === item.group)) {
      fail(`${stage}: ${groupNoun(stage)} ${quote(item.group)} is split apart; keep its items together.`);
    } else entries.push({ kind: 'group', name: item.group, items: [item] });
  }
  return entries;
};

/**
 * Prefixes on disk today, so a mutation renumbers as little as possible: a
 * group's by its name, an item's by its id, or `<group>/<id>` inside a group.
 */
const currentPrefixes = (
  current: ReadonlyArray<StageFileEntry>,
): { groups: Map<string, number>; items: Map<string, number> } => {
  const groups = new Map<string, number>();
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
    const parsedGroup = entryName.exec(segments[0]!);
    if (parsedGroup === null) continue;
    const group = parsedGroup[2]!;
    groups.set(group, Number(parsedGroup[1]!));
    items.set(`${group}/${id}`, Number(parsedLeaf[1]!));
  }
  return { groups, items };
};

const itemFile =(directory: string, prefix: number, item: ItemDraft): StageFileEntry => ({
  path: `${directory}/${formatPrefix(prefix)}-${item.id}.md`,
  content: `${renderItem(item)}\n`,
});

/**
 * The item files a stage directory should hold for these items, in this order:
 * item files and group directories share one sequence of prefixes.
 */
export const renderStageDirectory = (input: {
  readonly stage: Stage;
  readonly items: ReadonlyArray<ItemDraft>;
  readonly current: ReadonlyArray<StageFileEntry>;
}): StageFileEntry[] => {
  const { stage } = input;
  const known = currentPrefixes(input.current);
  const entries = topLevelEntries(stage, input.items);
  const prefixes = numberEntries(
    entries.map((entry) => (entry.kind === 'item' ? known.items.get(entry.item.id) : known.groups.get(entry.name)) ?? null),
  );
  const parent = stageDirectory(stage);
  return entries.flatMap((entry, index) => {
    const prefix = prefixes[index]!;
    if (entry.kind === 'item') return [itemFile(parent, prefix, entry.item)];
    const directory = `${parent}/${formatPrefix(prefix)}-${entry.name}`;
    const inner = numberEntries(entry.items.map((item) => known.items.get(`${entry.name}/${item.id}`) ?? null));
    return entry.items.map((item, position) => itemFile(directory, inner[position]!, item));
  });
};
