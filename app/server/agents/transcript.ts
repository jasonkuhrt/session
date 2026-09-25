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
 * yields nothing rather than a guess. The file's modification time is never
 * read: the lines Claude Code appends between replies, hooks, progress and
 * links among them, move it when nothing has been said.
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

const Count = Schema.Finite.pipe(Schema.optionalKey);

/**
 * One pass of a request. A reply compacted on its way lists every pass, and the
 * last pass that is a message is what the model read.
 */
const PassSchema = Schema.Struct({
  type: Schema.String.pipe(Schema.optionalKey),
  input_tokens: Count,
  output_tokens: Count,
  cache_creation_input_tokens: Count,
  cache_read_input_tokens: Count,
});
type Pass = typeof PassSchema.Type;

/** A reply's line, only as far as the count needs it; every other field is ignored. */
const ReplySchema = Schema.Struct({
  type: Schema.Literal('assistant'),
  timestamp: Schema.String.pipe(Schema.optionalKey),
  isUnmetered: Schema.Boolean.pipe(Schema.optionalKey),
  message: Schema.Struct({
    model: Schema.String.pipe(Schema.optionalKey),
    usage: Schema.Struct({
      input_tokens: Count,
      cache_creation_input_tokens: Count,
      cache_read_input_tokens: Count,
      iterations: Schema.Array(PassSchema).pipe(Schema.optionalKey),
    }),
  }),
});
type Usage = typeof ReplySchema.Type['message']['usage'];

/** What a line says it is: a reply is read, and every other line is passed over. */
const KindSchema = Schema.Struct({ type: Schema.String });

const LineJson = Schema.Unknown.pipe(Schema.fromJsonString);

const inputSide = (counts: Usage | Pass) =>
  (counts.input_tokens ?? 0) + (counts.cache_creation_input_tokens ?? 0) + (counts.cache_read_input_tokens ?? 0);

/** A pass Claude Code takes as what the reply read: a message, with every count present and something read. */
const isReading = (pass: Pass) =>
  (pass.type === 'message' || pass.type === 'fallback_message') &&
  [pass.input_tokens, pass.output_tokens, pass.cache_creation_input_tokens, pass.cache_read_input_tokens].every(
    (count) => count !== undefined && count >= 0,
  ) &&
  inputSide(pass) > 0;

/**
 * The tokens a reply read, counted the way Claude Code 2.1.283 counts them for
 * its status line: the input, cache-creation and cache-read tokens of the
 * usage, or of its last pass that is not a compaction or an advisor's, when
 * that pass is a complete message.
 */
const tokensRead = (usage: Usage): number => {
  const whole = inputSide(usage);
  if (whole === 0 || usage.iterations === undefined) return whole;
  const last = usage.iterations.findLast((pass) => pass.type !== 'compaction' && pass.type !== 'advisor_message');
  return last !== undefined && isReading(last) ? inputSide(last) : whole;
};

const isoOf = (stamp: string | undefined): string | null =>
  stamp === undefined
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

/**
 * The context a live session's last reply left, or null when its transcript
 * cannot be found or read, or its tail holds no reply that can be. A line
 * Claude Code wrote without asking the model, an API error or an interruption,
 * counts nothing and is passed over, as Claude Code passes it over; a reply that
 * cannot be read ends the search, so an older reply never stands in for it.
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
      const value = yield* Schema.decodeEffect(LineJson)(line).pipe(Effect.option);
      if (Option.isNone(value)) continue;
      const kind = yield* Schema.decodeUnknownEffect(KindSchema)(value.value).pipe(Effect.option);
      if (Option.isNone(kind) || kind.value.type !== 'assistant') continue;
      const reply = yield* Schema.decodeUnknownEffect(ReplySchema)(value.value);
      const tokens = reply.message.model === syntheticModel || reply.isUnmetered === true
        ? 0
        : tokensRead(reply.message.usage);
      if (tokens > 0) return { tokens, transcript, lineAt: isoOf(reply.timestamp) } satisfies ContextFill;
    }
    return null;
  }).pipe(Effect.orElseSucceed(() => null));
