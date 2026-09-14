import * as Cause from 'effect/Cause';
import type * as Duration from 'effect/Duration';
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import * as Stream from 'effect/Stream';
import * as ChildProcess from 'effect/unstable/process/ChildProcess';

/**
 * Running a command and keeping what it printed. Git, the agent listings and
 * the terminal multiplexer all need the same three answers — what it wrote,
 * what it complained about, and how it ended — so they share one spawn.
 */

/** What a finished child process left behind. */
export type Capture = {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
};

export class CommandError extends Data.TaggedError('CommandError')<{
  readonly command: string;
  /** `timeout` when the budget ran out; `spawn` when it never ran at all. */
  readonly kind: 'spawn' | 'timeout';
  readonly message: string;
  readonly cause?: unknown;
}> {}

export type Command = {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd?: string | undefined;
  readonly env?: Record<string, string> | undefined;
  /** Without one the command may hang forever; with one its group is killed. */
  readonly timeout?: Duration.Input | undefined;
};

/**
 * A non-zero exit is an answer, not a failure: callers read `exitCode` and the
 * stderr line the command chose. Only a command that could not run, or would
 * not finish, fails the effect. The scope kills the process group either way,
 * so a timeout leaves nothing behind.
 */
export const capture = (input: Command) => {
  const run = Effect.scoped(
    Effect.gen(function*() {
      const handle = yield* ChildProcess.make(input.command, [...input.args], {
        cwd: input.cwd,
        env: input.env,
        // `env` replaces the whole environment unless this says otherwise, and
        // a child without PATH or HOME cannot find its own configuration.
        extendEnv: true,
      });
      const [stdout, stderr, exitCode] = yield* Effect.all(
        [
          handle.stdout.pipe(Stream.decodeText(), Stream.mkString),
          handle.stderr.pipe(Stream.decodeText(), Stream.mkString),
          handle.exitCode,
        ],
        { concurrency: 'unbounded' },
      );
      return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode: Number(exitCode) } satisfies Capture;
    }),
  );
  return (input.timeout === undefined ? run : run.pipe(Effect.timeout(input.timeout))).pipe(
    Effect.mapError((cause) =>
      Cause.isTimeoutError(cause)
        ? new CommandError({
            command: input.command,
            kind: 'timeout',
            message: `${input.command} did not answer in time.`,
          })
        : new CommandError({
            command: input.command,
            kind: 'spawn',
            message: `Could not run ${input.command}.`,
            cause,
          }),
    ),
  );
};
