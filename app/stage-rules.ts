import type { Stage } from './contract.ts';

export const requiredSections: Record<Stage, ReadonlyArray<string>> = {
  Triage: ['Decision'],
  Design: ['Open questions'],
  Batch: ['Outcome', 'Acceptance'],
  Queue: ['Outcome', 'Acceptance'],
  Execute: ['Outcome', 'Acceptance'],
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
