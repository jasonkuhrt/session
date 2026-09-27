import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';
import * as Result from 'effect/Result';
import * as Schema from 'effect/Schema';
import * as Struct from 'effect/Struct';
import { type LedgerEntry, LedgerEntrySchema } from '../contract.ts';
import { ledgerDirectory } from './layout.ts';
import { markdown, type MarkdownNode } from './markdown.ts';
import { linesOf, recordReading } from './model.ts';

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
 *
 * Whether the body has a heading is the board's own answer: it is parsed as
 * the board renders it, CommonMark with GitHub's extensions, and any heading
 * the parser finds, at any depth, breaks the rule.
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
export const LedgerFieldsSchema = LedgerEntrySchema.mapFields(Struct.omit(['name', 'path']));
type LedgerFields = typeof LedgerFieldsSchema.Type;

const encodeFields = Schema.encodeSync(LedgerFieldsSchema);

/** The file content for an entry, from its fields encoded as they leave: frontmatter in the flat form, a blank line, the body. */
export const renderLedgerEntry = (entry: LedgerFields): string => {
  const fields = encodeFields(entry);
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

/**
 * The first heading the board would draw in some Markdown, as the lines it
 * spans, counted from 1; null when there is none. A heading written with `#`
 * is one line; one made by underlining a paragraph ends on its underline.
 */
const firstHeading = (text: string): { readonly start: number; readonly end: number } | null => {
  const pending: MarkdownNode[] = [markdown.parse(text)];
  for (let node = pending.shift(); node !== undefined; node = pending.shift()) {
    if (node.type === 'heading' && node.position !== undefined) {
      return { start: node.position.start.line, end: node.position.end.line };
    }
    pending.unshift(...(node.children ?? []));
  }
  return null;
};

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
 * The frontmatter as YAML read it, decoded as a mapping of each key to what
 * YAML read its value as; anything else YAML reads it as holds no key, which
 * the keys it must hold then say.
 */
const decodeMapping = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Unknown));

/** A value YAML read as text. */
const decodeText = Schema.decodeUnknownOption(Schema.String);

/**
 * One value, decoded as the one line of text it was written as, or the
 * problem with it. `source` is the value as the line wrote it.
 */
const valueOf = (
  key: LedgerKey,
  value: unknown,
  source: { readonly line: number; readonly text: string },
): { readonly text: string } | { readonly problem: LedgerProblem } => {
  const decoded = decodeText(value);
  if (Option.isNone(decoded)) {
    return problem(source.line, `YAML reads ${key} as ${kindOf(value)}, not as text; put its value in double quotes.`);
  }
  const text = decoded.value;
  const quoted = source.text.startsWith('"') || source.text.startsWith("'");
  if (!quoted && text !== source.text) {
    return problem(source.line, `YAML reads ${key} as "${text}", not as written; put its value in double quotes.`);
  }
  if (text === '') return problem(source.line, `${key} has no value; give it one or remove the line.`);
  if (text !== text.trim() || /[\r\n]/u.test(text)) {
    return problem(source.line, `${key} is one line of text with no space around it; rewrite its value.`);
  }
  if (key === 'date' && !isLedgerDate(text)) {
    return problem(source.line, `date is a UTC instant to the second, like 2026-09-23T14:02:11Z; rewrite ${text} in that form.`);
  }
  return { text };
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
  const decoded = new Map(Object.entries(Option.getOrElse(decodeMapping(parsed.value), () => ({}))));
  const fields = new Map<LedgerKey, string>();
  for (const [key, source] of written) {
    const value = valueOf(key, decoded.get(key), source);
    if ('problem' in value) return value;
    fields.set(key, value.text);
  }
  for (const [key, meaning] of requiredKeys) {
    if (!fields.has(key)) return problem(null, `the frontmatter has no ${key}, ${meaning}; add it.`);
  }
  return { fields };
};

/** An entry as its file was read, decoded before anything reads it. */
const decodeEntry = recordReading(LedgerEntrySchema);

/**
 * Read one file of `ledger/` as an entry, or say which rule it breaks. The same
 * reading serves `check`, the board's listing, and `session log` before it
 * writes, so nothing the engine writes can fail the check. The entry it reads
 * ends in a decode, which only a flaw of this reading could fail, and which
 * then is the problem it names.
 */
export const parseLedgerEntry = (input: { readonly name: string; readonly content: string }): LedgerParse => {
  const lines = linesOf(input.content.replace(/^\uFEFF/u, ''));
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
  const heading = firstHeading(bodyLines.join('\n'));
  if (heading !== null) {
    // Body line n is file line close + 1 + n.
    return heading.end === heading.start
      ? problem(close + 1 + heading.start, 'a ledger body has no headings; write this line as plain text or move it into a code fence.')
      : problem(
          close + 1 + heading.end,
          'this underline makes the lines above it a heading, and a ledger body has none; put a blank line before it.',
        );
  }
  const entry = decodeEntry({
    // The name as it is on disk, which is what addresses the file.
    name: input.name,
    path: `${ledgerDirectory}/${input.name}`,
    date,
    title,
    by: fields.get('by'),
    branch: fields.get('branch') ?? null,
    commit: fields.get('commit') ?? null,
    batch: fields.get('batch') ?? null,
    body: bodyLines.join('\n').trim(),
  });
  return Result.match(entry, { onSuccess: (read) => ({ entry: read }), onFailure: (flaw) => problem(null, `${flaw}.`) });
};
