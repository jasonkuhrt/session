import type { Stage } from './contract.ts';

const requiredSections = {
  Triage: ['Decision'],
  Design: ['Open questions'],
  Batch: ['Outcome', 'Acceptance'],
  Queue: ['Outcome', 'Acceptance'],
  Execute: ['Outcome', 'Acceptance'],
} as const satisfies Record<Stage, ReadonlyArray<string>>;

/** A section some stage requires, by the name its `### ` heading gives it. */
type RequiredSection = (typeof requiredSections)[Stage][number];

/** Every section some stage requires, each once, in the order the stages first require them. */
const everyRequiredSection: ReadonlyArray<RequiredSection> = [...new Set(Object.values(requiredSections).flat())];

/**
 * Every line ending Markdown knows: a line feed, a carriage return, or the two
 * together. A reading that splits a body here counts its lines as the page
 * that draws it does.
 */
export const lineEnding = /\r\n|\r|\n/u;

const fenceMarker = /^\s*(`{3,}|~{3,})/u;

/** A heading that ends a section: one to three `#` marks and a space. */
const sectionEnd = /^#{1,3}\s/u;

/**
 * The one word that says a required section is intentionally empty. It is
 * that only exactly so and alone on its line as all the section holds; beside
 * anything else it is ordinary content, and no other word says it.
 */
const noneWord = 'None';

/**
 * One line of Markdown and where it sits: a fence's opening or closing line
 * (`marker`), inside a fenced code block (`fenced`), or in the prose (`prose`).
 */
export type ScannedLine = {
  readonly text: string;
  readonly place: 'marker' | 'fenced' | 'prose';
};

/**
 * Every reader of Markdown here skips fenced code the same way: a run of three
 * or more backticks or tildes opens a fence, and the same character at least
 * as long closes it. A marker line that closes nothing inside an open fence is
 * still a marker, so it is neither prose nor fenced content.
 */
export const scanFences = (lines: ReadonlyArray<string>): ScannedLine[] => {
  const scanned: ScannedLine[] = [];
  let fence: { marker: '`' | '~'; length: number } | undefined;
  for (const text of lines) {
    const marker = fenceMarker.exec(text)?.[1];
    if (marker !== undefined) {
      const kind = marker[0] as '`' | '~';
      if (fence === undefined) fence = { marker: kind, length: marker.length };
      else if (kind === fence.marker && marker.length >= fence.length) fence = undefined;
      scanned.push({ text, place: 'marker' });
      continue;
    }
    scanned.push({ text, place: fence === undefined ? 'prose' : 'fenced' });
  }
  return scanned;
};

/**
 * What a required section holds, as every reader reads it. `empty`: the body
 * has no such heading, or nothing stands under it before the next heading but
 * blank lines and the markers of fences with nothing in them. `none`: all it
 * holds is the one word `None` on the body's line `line`, counted from 1 as
 * Markdown counts lines, which says the section is intentionally empty.
 * `content`: anything else.
 */
type SectionReading =
  | { readonly kind: 'empty' }
  | { readonly kind: 'none'; readonly line: number }
  | { readonly kind: 'content' };

const readSection = (body: string, section: RequiredSection): SectionReading => {
  const lines = scanFences(body.split(lineEnding));
  const heading = lines.findIndex((line) => line.place === 'prose' && line.text.trimEnd() === `### ${section}`);
  if (heading === -1) return { kind: 'empty' };
  const end = lines.findIndex((line, at) => at > heading && line.place === 'prose' && sectionEnd.test(line.text));
  // What the section holds, each line with its number, and none of its blank lines.
  const held = lines
    .slice(heading + 1, end === -1 ? lines.length : end)
    .map(({ text, place }, offset) => ({ text, place, number: heading + 2 + offset }))
    .filter((line) => line.text.trim() !== '');
  const [only, ...more] = held;
  if (only !== undefined && more.length === 0 && only.place === 'prose' && only.text.trimEnd() === noneWord) {
    return { kind: 'none', line: only.number };
  }
  return held.some((line) => line.place !== 'marker') ? { kind: 'content' } : { kind: 'empty' };
};

/**
 * The sections a stage requires that a body leaves empty, in the order the
 * stage names them. A section that says `None` is not one of them: the stage
 * takes it as intentionally empty, and it is content to nobody.
 */
export const emptySections = (stage: Stage, body: string): ReadonlyArray<RequiredSection> =>
  requiredSections[stage].filter((section) => readSection(body, section).kind === 'empty');

/**
 * The lines of a body, counted from 1 as Markdown counts them, on which the
 * one word `None` says a required section is intentionally empty.
 */
export const noneLines = (body: string): ReadonlySet<number> =>
  new Set(everyRequiredSection.flatMap((section) => {
    const reading = readSection(body, section);
    return reading.kind === 'none' ? [reading.line] : [];
  }));
