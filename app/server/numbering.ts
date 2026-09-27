/**
 * Numbers that keep an order: the prefixes of a stage's entries, and the ranks
 * of a worktree's siblings on the index. Each number already given is kept
 * while the order still allows it, and a new entry is fitted between its
 * neighbours, so a change renames as little as it can.
 */

/** Gap between generated numbers, leaving room to insert without renumbering. */
const numberStep = 10;

/**
 * Numbers for entries in their target order. Existing numbers survive while
 * they stay strictly increasing and every new entry fits between its
 * neighbours; otherwise every entry is numbered afresh.
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

/**
 * A number an entry keeps for certain, and one it keeps only while it still
 * falls between the numbers kept before and after it.
 */
export type Candidate = { readonly own: number | null; readonly tentative?: number | undefined };

/** The number each entry keeps, its own or its tentative one while that fits, or none, which `numberEntries` fills. */
export const keptNumbers = (candidates: ReadonlyArray<Candidate>): Array<number | null> => {
  const kept: Array<number | null> = [];
  for (const [index, { own, tentative }] of candidates.entries()) {
    const before = kept.findLast((value) => value !== null) ?? 0;
    const after = candidates.slice(index + 1).map((candidate) => candidate.own).find((value): value is number => value !== null);
    kept.push(tentative !== undefined && tentative > before && (after === undefined || tentative < after) ? tentative : own);
  }
  return kept;
};

/**
 * What an item's number is to a write: the item a move places keeps its old
 * number only while it still fits where it lands, since that number says
 * where it stood, not where it goes; every other item keeps its own. So a move
 * renames only what it moves, as the index ranks only what it places.
 */
export const itemCandidate = ({ prefix, placed }: { readonly prefix: number | undefined; readonly placed: boolean }): Candidate =>
  placed ? { own: null, tentative: prefix } : { own: prefix ?? null };
