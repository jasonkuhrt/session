import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';
import type { LedgerEntry } from '../contract.ts';
import { firstHeading } from '../stage-rules.ts';
import { ledgerDirectory } from './layout.ts';

/**
 * The ledger's entry format. An entry is one file under `ledger/`: YAML
 * frontmatter of flat keys, then a Markdown body with no headings. The
 * frontmatter is the record, and the file's name is derived from it, so the
 * two always agree. Entries are never edited or deleted; a mistake is
 * corrected by a later entry.
 *
 * Flat means one `key: value` line per key and every value one line of text.
 * YAML decodes each value, and a value written without quotes must decode to
 * exactly what is written; anything YAML would read otherwise, a number, a
 * `#` comment, a tag, is quoted. The engine writes that form and reads no
 * other.
 */

/** Every key an entry may carry, in the order the engine writes them. */
const ledgerKeys = ['date', 'title', 'by', 'branch', 'commit', 'batch'] as const;
type LedgerKey = typeof ledgerKeys[number];

const requiredKeys: ReadonlyMap<LedgerKey, string> = new Map([
  ['date', 'when it was written, e.g. `date: 2026-09-23T14:02:11Z`'],
  ['title', 'what it says in a line'],
  ['by', 'who wrote it, e.g. `by: claude <session id>`'],
]);

const isLedgerKey = (key: string): key is LedgerKey => (ledgerKeys as ReadonlyArray<string>).includes(key);

/**
 * Whether `value` is a real instant in UTC written to the second, the one form
 * `date` takes: `2026-09-23T14:02:11Z`. A day the calendar does not have, such
 * as February 30, is not one.
 */
const isLedgerDate = (value: string): boolean =>
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(value) &&
  DateTime.make(value).pipe(
    Option.exists((moment) => DateTime.formatIso(moment) === `${value.slice(0, -1)}.000Z`),
  );

/** The clock's reading as an entry's date: UTC, to the second, which is as fine as the file's name. */
export const ledgerNow = DateTime.now.pipe(Effect.map((now) => DateTime.formatIso(now).replace(/\.\d+Z$/u, 'Z')));

/** The file an entry lives in: its date with `-` for `:` and a space for `T`, then its title with `-` for `/`. */
export const ledgerFileName = (input: { readonly date: string; readonly title: string }): string =>
  `${input.date.replaceAll(':', '-').replace('T', ' ')} — ${input.title.replaceAll('/', '-')}.md`;

/** An entry's fields before it has a file. */
export type LedgerFields = Omit<LedgerEntry, 'name' | 'path'>;

/** The file content for an entry: frontmatter in the flat form, a blank line, the body. */
export const renderLedgerEntry = (fields: LedgerFields): string => {
  const lines = ['---'];
  for (const key of ledgerKeys) {
    const value = fields[key];
    if (value !== null) lines.push(`${key}: ${Bun.YAML.stringify(value)}`);
  }
  lines.push('---');
  const body = fields.body.trim();
  return `${lines.join('\n')}\n${body === '' ? '' : `\n${body}\n`}`;
};

/**
 * Why a file breaks the ledger's rules: the problem and its fix, and the line
 * of the file that shows it when one does. Each reader names the file its own
 * way: `check` by path and line, the board's listing in a notice.
 */
export type LedgerProblem = {
  readonly line: number | null;
  readonly text: string;
};

export type LedgerParse =
  | { readonly entry: LedgerEntry; readonly problem?: never }
  | { readonly problem: LedgerProblem; readonly entry?: never };

const problem = (line: number | null, text: string): { readonly problem: LedgerProblem } => ({
  problem: { line, text },
});

const frontmatterLine = /^([A-Za-z][\w-]*):(.*)$/u;

/** What YAML read a value as, when that is not text. */
const kindOf = (value: unknown): string => {
  if (value === null || value === undefined) return 'nothing';
  if (Array.isArray(value)) return 'a list';
  if (typeof value === 'object') return 'a mapping';
  return `a ${typeof value}`;
};

const parseYaml = (text: string): { readonly value: unknown } | { readonly error: string } => {
  try {
    return { value: Bun.YAML.parse(text) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
};

/**
 * The problem with one decoded value, or null when it is one line of text as
 * written. `source` is the value as the line wrote it.
 */
const valueProblem = (
  key: LedgerKey,
  value: unknown,
  source: { readonly line: number; readonly text: string },
): { readonly problem: LedgerProblem } | null => {
  if (typeof value !== 'string') {
    return problem(source.line, `YAML reads ${key} as ${kindOf(value)}, not as text; put its value in double quotes.`);
  }
  const quoted = source.text.startsWith('"') || source.text.startsWith("'");
  if (!quoted && value !== source.text) {
    return problem(source.line, `YAML reads ${key} as "${value}", not as written; put its value in double quotes.`);
  }
  if (value === '') return problem(source.line, `${key} has no value; give it one or remove the line.`);
  if (value !== value.trim() || /[\r\n]/u.test(value)) {
    return problem(source.line, `${key} is one line of text with no space around it; rewrite its value.`);
  }
  if (key === 'date' && !isLedgerDate(value)) {
    return problem(source.line, `date is a UTC instant to the second, like 2026-09-23T14:02:11Z; rewrite ${value} in that form.`);
  }
  return null;
};

/**
 * The frontmatter's values, or the first problem with them. `lines` are the
 * lines between the two `---` lines, so the first of them is line 2.
 */
const parseFrontmatter = (
  lines: ReadonlyArray<string>,
): { readonly fields: ReadonlyMap<LedgerKey, string> } | { readonly problem: LedgerProblem } => {
  const written = new Map<LedgerKey, { readonly line: number; readonly text: string }>();
  for (const [index, line] of lines.entries()) {
    const number = index + 2;
    const match = frontmatterLine.exec(line);
    if (match === null) {
      return problem(number, 'frontmatter holds one `key: value` line per key and nothing else; rewrite or remove this line.');
    }
    const key = match[1]!;
    const rest = match[2]!;
    if (!isLedgerKey(key)) {
      return problem(number, `${key} is not a ledger key; remove it. The keys are ${ledgerKeys.join(', ')}.`);
    }
    if (written.has(key)) return problem(number, `${key} appears twice; keep one.`);
    if (rest.trim() === '') return problem(number, `${key} has no value; give it one or remove the line.`);
    if (!/^[ \t]/u.test(rest)) return problem(number, `${key} needs a space after its colon.`);
    written.set(key, { line: number, text: rest.trim() });
  }
  const parsed = parseYaml(lines.join('\n'));
  if ('error' in parsed) {
    return problem(null, `the frontmatter is not valid YAML (${parsed.error}); put any value YAML cannot read in double quotes.`);
  }
  const decoded = typeof parsed.value === 'object' && parsed.value !== null && !Array.isArray(parsed.value)
    ? new Map(Object.entries(parsed.value))
    : new Map<string, unknown>();
  const fields = new Map<LedgerKey, string>();
  for (const [key, source] of written) {
    const value = decoded.get(key);
    const invalid = valueProblem(key, value, source);
    if (invalid !== null) return invalid;
    fields.set(key, value as string);
  }
  for (const [key, meaning] of requiredKeys) {
    if (!fields.has(key)) return problem(null, `the frontmatter has no ${key}, ${meaning}; add it.`);
  }
  return { fields };
};

/**
 * Read one file of `ledger/` as an entry, or say which rule it breaks. The same
 * reading serves `check`, the board's listing, and `session log` before it
 * writes, so nothing the engine writes can fail the check.
 */
export const parseLedgerEntry = (input: { readonly name: string; readonly content: string }): LedgerParse => {
  const lines = input.content.replace(/^\uFEFF/u, '').replaceAll('\r\n', '\n').split('\n');
  if (lines[0]?.trimEnd() !== '---') {
    return problem(1, 'an entry opens with frontmatter: a `---` line, one `key: value` line per key, and a closing `---` line.');
  }
  const close = lines.findIndex((line, index) => index > 0 && line.trimEnd() === '---');
  if (close === -1) return problem(1, 'the frontmatter has no closing `---` line.');
  const frontmatter = parseFrontmatter(lines.slice(1, close));
  if ('problem' in frontmatter) return frontmatter;
  const { fields } = frontmatter;
  const date = fields.get('date')!;
  const title = fields.get('title')!;
  const name = ledgerFileName({ date, title });
  // A name typed in by hand may spell an accent in either of Unicode's forms.
  if (input.name.normalize('NFC') !== name.normalize('NFC')) {
    return problem(null, `the name comes from its date and title, so it is "${name}"; rename the file.`);
  }
  const bodyLines = lines.slice(close + 1);
  const heading = firstHeading(bodyLines);
  if (heading !== null) {
    return problem(
      close + 2 + heading.line,
      heading.form === 'hashes'
        ? 'a ledger body has no headings; write this line as plain text or move it into a code fence.'
        : 'this underline makes the line above it a heading, and a ledger body has none; put a blank line before it.',
    );
  }
  return {
    entry: {
      // The name as it is on disk, which is what addresses the file.
      name: input.name,
      path: `${ledgerDirectory}/${input.name}`,
      date,
      title,
      by: fields.get('by')!,
      branch: fields.get('branch') ?? null,
      commit: fields.get('commit') ?? null,
      batch: fields.get('batch') ?? null,
      body: bodyLines.join('\n').trim(),
    },
  };
};
