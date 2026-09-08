import type { Stage } from './contract.ts';

export const requiredSections: Record<Stage, ReadonlyArray<string>> = {
  TRIAGE: ['Decision'],
  DESIGN: ['Open questions'],
  BATCH: ['Outcome', 'Acceptance'],
  EXECUTE: ['Outcome', 'Acceptance'],
};

export const sectionHasContent = (body: string, section: string): boolean => {
  const lines = body.split(/\r?\n/u);
  const heading = `### ${section}`;
  let fence: { marker: '`' | '~'; length: number } | undefined;
  let index = -1;
  for (const [lineIndex, line] of lines.entries()) {
    const marker = /^\s*(`{3,}|~{3,})/u.exec(line)?.[1];
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
    const marker = /^\s*(`{3,}|~{3,})/u.exec(line)?.[1];
    if (marker !== undefined) {
      const kind = marker[0] as '`' | '~';
      if (fence === undefined) fence = { marker: kind, length: marker.length };
      else if (kind === fence.marker && marker.length >= fence.length) fence = undefined;
      continue;
    }
    if (fence !== undefined && line.trim() !== '') return true;
    if (fence === undefined && /^#{1,3}\s/u.test(line)) return false;
    if (fence === undefined && line.trim() !== '') return true;
  }
  return false;
};
