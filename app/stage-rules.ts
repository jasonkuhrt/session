import type { Stage } from './contract.ts';

export const requiredSections: Record<Stage, ReadonlyArray<string>> = {
  TRIAGE: ['Decision'],
  DESIGN: ['Open questions'],
  BATCH: ['Outcome', 'Acceptance'],
  QUEUE: ['Outcome', 'Acceptance'],
  EXECUTE: ['Outcome', 'Acceptance'],
};

const fenceMarker = /^\s*(`{3,}|~{3,})/u;

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

export const sectionHasContent = (body: string, section: string): boolean => {
  const lines = scanFences(body.split(/\r?\n/u));
  const heading = `### ${section}`;
  const index = lines.findIndex((line) => line.place === 'prose' && line.text.trimEnd() === heading);
  if (index === -1) return false;
  for (const line of lines.slice(index + 1)) {
    if (line.place === 'marker') continue;
    if (line.place === 'fenced') {
      if (line.text.trim() !== '') return true;
      continue;
    }
    if (/^#{1,3}\s/u.test(line.text)) return false;
    if (line.text.trim() !== '') return true;
  }
  return false;
};

const atxHeading = /^ {0,3}#{1,6}(?:[ \t]|$)/u;
const setextUnderline = /^ {0,3}(?:=+|-+)[ \t]*$/u;
const thematicBreak = /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/u;
const containerMarker = /^ {0,3}(?:>[ \t]?|[-+*](?:[ \t]+|$)|\d{1,9}[.)](?:[ \t]+|$))/u;
const listItem = /^ {0,3}(?:[-+*]|(\d{1,9})[.)])(?:[ \t]+(.*))?$/u;
const tableDelimiter = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/u;
const htmlBlockStart = /^ {0,3}<(?:\/?[A-Za-z]|!|\?)/u;
const indentedCode = /^(?: {4}|\t)/u;

/** A line with its leading quote and list markers taken off, and whether it had any. */
const withoutContainers = (text: string): { content: string; contained: boolean } => {
  let content = text;
  let contained = false;
  for (let marker = containerMarker.exec(content); marker !== null; marker = containerMarker.exec(content)) {
    content = content.slice(marker[0].length);
    contained = true;
  }
  return { content, contained };
};

/**
 * Whether a line that opens a quote or a list item may end the paragraph above
 * it: a quote may, and so may a list item with content, but an ordered one
 * only when it starts at 1. Otherwise the line is more of the paragraph.
 */
const interruptsParagraph = (text: string): boolean => {
  const item = listItem.exec(text);
  if (item === null) return true;
  if ((item[2] ?? '').trim() === '') return false;
  return item[1] === undefined || Number(item[1]) === 1;
};

/** What the heading scan knows about the lines above the one it is on. */
type HeadingScan = {
  /** The line before, when it was paragraph text outside any quote or list. */
  readonly paragraph: string | null;
  /** Whether a quote or list item has opened since the last blank line or rule. */
  readonly contained: boolean;
  /** Whether the lines since the last blank line are raw HTML. */
  readonly html: boolean;
  /** Whether the lines since the last blank line are a table's rows. */
  readonly table: boolean;
};

const freshScan: HeadingScan = { paragraph: null, contained: false, html: false, table: false };

/** One line of prose read against the lines above it: the heading it makes, or what the scan knows after it. */
const scanProse = (text: string, scan: HeadingScan): 'hashes' | 'underline' | HeadingScan => {
  if (text.trim() === '') return freshScan;
  if (scan.html) return scan;
  if (scan.paragraph !== null && !scan.contained && setextUnderline.test(text)) return 'underline';
  if (thematicBreak.test(text)) {
    return { ...scan, paragraph: null, table: false, contained: scan.contained && /^\s/u.test(text) };
  }
  const inner = withoutContainers(text);
  if (inner.contained && (scan.paragraph === null || interruptsParagraph(text))) {
    return atxHeading.test(inner.content) ? 'hashes' : { ...scan, paragraph: null, contained: true, table: false };
  }
  if (atxHeading.test(text)) return 'hashes';
  if (scan.table) return scan;
  if (scan.paragraph?.includes('|') === true && text.includes('|') && tableDelimiter.test(text)) {
    return { ...scan, paragraph: null, table: true };
  }
  if (scan.paragraph === null && htmlBlockStart.test(text)) return { ...scan, html: true };
  // Indented four spaces with no paragraph to continue, a line is code.
  if (scan.paragraph === null && indentedCode.test(text)) return scan;
  return { ...scan, paragraph: text };
};

/**
 * Where the first heading of any level sits in the prose of some Markdown
 * lines, or null when there is none. Two forms are headings: a line that opens
 * with one to six `#` and a space (`hashes`), in a quote or list item too; and
 * a line of `=` or `-` directly under a paragraph line (`underline`), which
 * Markdown reads as that paragraph's underline. `line` indexes the line that
 * makes the heading.
 *
 * It follows the renderer where agents' prose goes, and errs toward silence
 * where only a full parser would know: a paragraph inside a quote or a list
 * item is not taken for one, so a `---` after a list stays a rule between
 * blocks; the rows of a table are not paragraph lines; and a block of raw
 * HTML, from a line opening with a tag to the next blank line, holds no
 * headings.
 */
export const firstHeading = (
  lines: ReadonlyArray<string>,
): { readonly line: number; readonly form: 'hashes' | 'underline' } | null => {
  let scan = freshScan;
  for (const [index, line] of scanFences(lines).entries()) {
    if (line.place === 'prose') {
      const next = scanProse(line.text, scan);
      if (typeof next === 'string') return { line: index, form: next };
      scan = next;
      continue;
    }
    // A fence at the margin closes whatever quote or list was open.
    const closes = line.place === 'marker' && !/^\s/u.test(line.text);
    scan = { ...scan, paragraph: null, table: false, contained: scan.contained && !closes };
  }
  return null;
};
