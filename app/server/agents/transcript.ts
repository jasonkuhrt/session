import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';
import * as FileSystem from 'effect/FileSystem';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';
import type { ContextFill } from '../../contract.ts';

/**
 * What is in a live Claude Code session's context, read from the one place
 * Claude Code writes it down: the `usage` on the last reply in the session's
 * transcript. Only the file's tail is read, so a 40 MB transcript costs what a
 * new one does, and a transcript that cannot be found, read or understood
 * yields nothing rather than a guess. It is read when the agents are listed and
 * at no other time: nothing watches a transcript, so the count is as of the
 * last listing. The file's modification time is never read either: the lines
 * Claude Code appends between replies, hooks, progress and links among them,
 * move it when nothing has been said.
 */

/**
 * How far back from the end the last reply is looked for. On 2026-09-25,
 * across the 89 transcripts written in the two weeks before, the last reply
 * began inside this many bytes of the end in 95% of them; the rest ended on a
 * long run of other lines, such as the attachments a resumed session writes,
 * and show nothing until the next reply.
 */
const tailBytes = 65_536n;

/** Past this many characters Claude Code cuts a project's directory name and appends a hash of the path. */
const keyLimit = 200;

/** The model Claude Code names on a line it wrote without asking one, such as an API error. */
const syntheticModel = '<synthetic>';

/**
 * The texts Claude Code writes as a whole reply of its own, which it leaves out
 * of its count whatever model the line names (Claude Code 2.1.283): an
 * interruption, a refused or rejected tool use, and "no response requested",
 * which a model can also answer with.
 */
const cannedReplies: ReadonlySet<string> = new Set([
  '[Request interrupted by user]',
  '[Request interrupted by user for tool use]',
  "The user doesn't want to take this action right now. STOP what you are doing and wait for the user to tell you how to proceed.",
  "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.",
  'No response requested.',
]);

/** A count as Claude Code writes it: a number, or null on a line of its own, which counts as none. */
const Count = Schema.Finite.pipe(Schema.NullOr, Schema.optionalKey);

const LineJson = Schema.Unknown.pipe(Schema.fromJsonString);

/** What a line says it is: a reply is looked at, and every other line is passed over. */
const KindSchema = Schema.Struct({ type: Schema.String });

/**
 * The fields that decide whether a reply counts at all, read loosely so that
 * nothing about a line Claude Code passes over can refuse it: no usage, the
 * synthetic model, an unmetered request, and a canned text all mean it counts
 * nothing, as they do for Claude Code.
 */
const HeadSchema = Schema.Struct({
  isUnmetered: Schema.Unknown.pipe(Schema.optionalKey),
  message: Schema.Struct({
    model: Schema.Unknown.pipe(Schema.optionalKey),
    usage: Schema.Unknown.pipe(Schema.optionalKey),
    content: Schema.Unknown.pipe(Schema.optionalKey),
  }),
});
type Head = typeof HeadSchema.Type;

const isCannedOpening = Schema.is(Schema.Struct({ type: Schema.Literal('text'), text: Schema.String }));

/** The count itself, from a reply that counts: every field but these is ignored, and a null counts as none. */
const ReplySchema = Schema.Struct({
  timestamp: Schema.String.pipe(Schema.NullOr, Schema.optionalKey),
  message: Schema.Struct({
    usage: Schema.Struct({
      input_tokens: Count,
      cache_creation_input_tokens: Count,
      cache_read_input_tokens: Count,
      iterations: Schema.Unknown.pipe(Schema.Array, Schema.NullOr, Schema.optionalKey),
    }),
  }),
});
type Usage = typeof ReplySchema.Type['message']['usage'];

/**
 * One pass of a request. A reply compacted on its way lists every pass, and the
 * last pass that is a message is what the model read.
 */
const isPass = Schema.is(Schema.Struct({
  type: Schema.String,
  input_tokens: Schema.Finite,
  output_tokens: Schema.Finite,
  cache_creation_input_tokens: Schema.Finite,
  cache_read_input_tokens: Schema.Finite,
}));

/** A pass that is not the model reading the conversation: a compaction, or an advisor's message. */
const isSetAside = Schema.is(Schema.Struct({ type: Schema.Literals(['compaction', 'advisor_message']) }));

const inputSide = (counts: {
  readonly input_tokens?: number | null;
  readonly cache_creation_input_tokens?: number | null;
  readonly cache_read_input_tokens?: number | null;
}) => (counts.input_tokens ?? 0) + (counts.cache_creation_input_tokens ?? 0) + (counts.cache_read_input_tokens ?? 0);

/** Whether Claude Code passes a reply over, before its count is read. */
const isPassedOver = (head: Head) => {
  const { content, model, usage } = head.message;
  const first: unknown = Array.isArray(content) ? content[0] : undefined;
  return usage === undefined ||
    usage === null ||
    model === syntheticModel ||
    head.isUnmetered === true ||
    (isCannedOpening(first) && cannedReplies.has(first.text));
};

/**
 * The tokens a reply read, counted the way Claude Code 2.1.283 counts them for
 * its status line: the input, cache-creation and cache-read tokens of the
 * usage, or of its last pass that is not set aside, when that pass is a
 * complete message with something read.
 */
const tokensRead = (usage: Usage): number => {
  const whole = inputSide(usage);
  if (whole === 0 || usage.iterations === undefined || usage.iterations === null) return whole;
  const last: unknown = usage.iterations.findLast((pass) => !isSetAside(pass));
  const reading = isPass(last) &&
    (last.type === 'message' || last.type === 'fallback_message') &&
    [last.input_tokens, last.output_tokens, last.cache_creation_input_tokens, last.cache_read_input_tokens].every(
      (count) => count >= 0,
    ) &&
    inputSide(last) > 0;
  return reading ? inputSide(last) : whole;
};

const isoOf = (stamp: string | null | undefined): string | null =>
  stamp === undefined || stamp === null
    ? null
    : DateTime.make(stamp).pipe(Option.map((moment) => DateTime.formatIso(moment)), Option.getOrNull);

/**
 * Where Claude Code keeps a session's transcript: `<sessionId>.jsonl` in its
 * project's directory, which is named for the working directory with every
 * character but a letter or a digit turned into `-`, one for each UTF-16 unit
 * as Claude Code counts them. A name longer than 200 characters is cut there
 * and followed by a hash of the path, so it is found among the directories
 * that start with the cut name, by the session's file.
 */
const transcriptOf = (projects: string, cwd: string, sessionId: string) =>
  Effect.gen(function*() {
    const key = cwd.replaceAll(/[^a-zA-Z0-9]/gu, (character) => '-'.repeat(character.length));
    const file = `${sessionId}.jsonl`;
    if (key.length <= keyLimit) return `${projects}/${key}/${file}`;
    const fs = yield* FileSystem.FileSystem;
    const cut = `${key.slice(0, keyLimit)}-`;
    for (const entry of yield* fs.readDirectory(projects)) {
      const candidate = `${projects}/${entry}/${file}`;
      if (entry.startsWith(cut) && (yield* fs.exists(candidate))) return candidate;
    }
    return null;
  });

const decoder = new TextDecoder();

/** The lines in the last `tailBytes` of a file, oldest first, without the one the read began inside. */
const tailLines = (path: string) =>
  Effect.scoped(
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem;
      const file = yield* fs.open(path);
      const { size } = yield* file.stat;
      const start = size > tailBytes ? size - tailBytes : 0n;
      yield* file.seek(start, 'start');
      const text = (yield* file.readAlloc(Number(size - start))).pipe(
        Option.map((bytes) => decoder.decode(bytes)),
        Option.getOrElse(() => ''),
      );
      const lines = text.split('\n');
      return start > 0n ? lines.slice(1) : lines;
    }),
  );

/** What one line of the tail says: nothing to count, a reply's count, or a reply whose count cannot be read. */
type Reading =
  | { readonly kind: 'passed-over' }
  | { readonly kind: 'counted'; readonly tokens: number; readonly lineAt: string | null }
  | { readonly kind: 'unreadable' };

const passedOver: Reading = { kind: 'passed-over' };
const unreadable: Reading = { kind: 'unreadable' };
const counted = (tokens: number, lineAt: string | null): Reading => ({ kind: 'counted', tokens, lineAt });

const readingOf = (line: string) =>
  Effect.gen(function*() {
    const value = yield* Schema.decodeEffect(LineJson)(line).pipe(Effect.option);
    if (Option.isNone(value)) return passedOver;
    const kind = yield* Schema.decodeUnknownEffect(KindSchema)(value.value).pipe(Effect.option);
    if (Option.isNone(kind) || kind.value.type !== 'assistant') return passedOver;
    const head = yield* Schema.decodeUnknownEffect(HeadSchema)(value.value).pipe(Effect.option);
    if (Option.isNone(head)) return unreadable;
    if (isPassedOver(head.value)) return passedOver;
    const reply = yield* Schema.decodeUnknownEffect(ReplySchema)(value.value).pipe(Effect.option);
    if (Option.isNone(reply)) return unreadable;
    const tokens = tokensRead(reply.value.message.usage);
    return tokens > 0 ? counted(tokens, isoOf(reply.value.timestamp)) : passedOver;
  });

/**
 * The context a live session's last reply left, or null when its transcript
 * cannot be found or read, or its tail holds no reply that can be. A line
 * Claude Code passes over, an API error, an interruption or another line with
 * no count of its own, is passed over here too; a reply whose count cannot be
 * read ends the search, so an older reply never stands in for it.
 */
export const contextOf = ({ projects, cwd, sessionId }: {
  /** Claude Code's `projects/` directory, or null when it cannot be named. */
  readonly projects: string | null;
  /** The session's working directory, as the listing gives it. */
  readonly cwd: string;
  readonly sessionId: string;
}) =>
  Effect.gen(function*() {
    // The id becomes a file name, so one that could climb out of the directory is no session's.
    if (projects === null || !/^[\w-]+$/u.test(sessionId)) return null;
    const transcript = yield* transcriptOf(projects, cwd, sessionId);
    if (transcript === null) return null;
    for (const line of (yield* tailLines(transcript)).toReversed()) {
      const reading = yield* readingOf(line);
      if (reading.kind === 'unreadable') return null;
      if (reading.kind === 'counted') {
        return { tokens: reading.tokens, transcript, lineAt: reading.lineAt } satisfies ContextFill;
      }
    }
    return null;
  }).pipe(Effect.orElseSucceed(() => null));
