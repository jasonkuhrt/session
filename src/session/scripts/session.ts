#!/usr/bin/env bun
import { NodeRuntime, NodeServices } from '@effect/platform-node';
import * as Console from 'effect/Console';
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import * as FileSystem from 'effect/FileSystem';
import * as Option from 'effect/Option';
import * as Path from 'effect/Path';
import * as Schema from 'effect/Schema';
import type { Session, Stage } from '../../../app/contract.ts';
import { stageNames } from '../../../app/contract.ts';
import {
  daemonOnPort,
  ensureDaemon,
  openInBrowser,
  trackWorktree,
} from '../../../app/server/daemon.ts';
import { publicOrigin } from '../../../app/server/portless.ts';
import { quote } from '../../../app/server/model.ts';
import type { FileInventory, SessionRepository } from '../../../app/server/repository.ts';
import { makeRepository } from '../../../app/server/repository.ts';
import {
  encodeWorktreeKey,
  ensureSession,
  headCommit,
  resolveWorktreeSession,
  type WorktreeSession,
} from '../../../app/server/worktree.ts';

/**
 * Argument parsing in front of the engine. Layout, numbering and validation
 * live in `app/server`; this file only reads argv and prints.
 */

const commands = {
  init: { operands: '', least: 0, most: 0 },
  check: { operands: '', least: 0, most: 0 },
  refresh: { operands: '', least: 0, most: 0 },
  ls: { operands: '[STAGE]', least: 0, most: 1 },
  add: { operands: '<STAGE> <ID> "<title>"', least: 3, most: 3 },
  mv: { operands: '<ID> <STAGE>', least: 2, most: 2 },
  batch: { operands: '"<name>" <ID...>', least: 2, most: Number.POSITIVE_INFINITY },
  start: { operands: '', least: 0, most: 0 },
  done: { operands: '<ID>', least: 1, most: 1 },
  archive: { operands: '<ID>', least: 1, most: 1 },
  log: { operands: '"<by>" "<title>"', least: 2, most: 2 },
  open: { operands: '', least: 0, most: 0 },
} as const;

type Command = keyof typeof commands;

const usage = `Usage: session [-C <worktree or .session>] <command>

  init                                  create what the session is missing and say what that was
  check                                 validate the session and print its revision
  refresh [--previous <inventory.json>] print the file inventory as JSON
  ls [STAGE]                            list items as ID, file, title
  add <STAGE> <ID> "<title>"            add an item, body on stdin
  mv <ID> <STAGE> [--before ID]         move an item, or reorder it where it is
  batch "<name>" <ID...>                queue BATCH items as a named batch
  start                                 move the first queued batch into EXECUTE
  done <ID>                             complete an EXECUTE item
  archive <ID>                          file an item away, from any stage
  log "<by>" "<title>"                  write a ledger entry, body on stdin if piped
  open                                  ensure the daemon and open this worktree's board`;

class SessionCliError extends Data.TaggedError('SessionCliError')<{
  readonly message: string;
}> {}

const PreviousRefresh = Schema.Struct({
  inventory: Schema.Record(Schema.String, Schema.String),
});
const PreviousRefreshJson = Schema.fromJsonString(PreviousRefresh);

type Options = {
  readonly command: Command;
  readonly operands: ReadonlyArray<string>;
  readonly directory: string;
  readonly previous: string | undefined;
  readonly before: string | undefined;
};

const isCommand = (value: string): value is Command => value in commands;

const valueOf = (option: string, value: string | undefined): string => {
  if (value === undefined) throw new Error(`${option} needs a value.`);
  return value;
};

const parseOptions = (path: Path.Path, args: ReadonlyArray<string>): Options => {
  const operands: string[] = [];
  let directory = process.cwd();
  let previous: string | undefined;
  let before: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    const value = args[index + 1];
    switch (argument) {
      case '-C': {
        directory = path.resolve(valueOf('-C', value));
        index += 1;
        break;
      }
      case '--previous': {
        previous = path.resolve(valueOf('--previous', value));
        index += 1;
        break;
      }
      case '--before': {
        before = valueOf('--before', value);
        index += 1;
        break;
      }
      default: {
        if (argument.startsWith('-')) throw new Error(`Unknown option ${argument}.\n\n${usage}`);
        operands.push(argument);
      }
    }
  }

  const command = operands[0];
  if (command === undefined || !isCommand(command)) throw new Error(usage);
  const rest = operands.slice(1);
  const arity = commands[command];
  if (rest.length < arity.least || rest.length > arity.most) {
    throw new Error(`Usage: session ${command} ${arity.operands}`.trimEnd());
  }
  return { command, operands: rest, directory, previous, before };
};

const asStage = (value: string): Stage => {
  const stage = stageNames.find((candidate) => candidate === value.toUpperCase());
  if (stage === undefined) {
    throw new Error(`Unknown stage ${value}. Stages: ${stageNames.join(', ')}.`);
  }
  return stage;
};

const cliTry = <A>(operation: () => A) =>
  Effect.try({
    try: operation,
    catch: (cause) =>
      new SessionCliError({ message: cause instanceof Error ? cause.message : String(cause) }),
  });

const unreadable = () => new SessionCliError({ message: 'Could not read the body from stdin.' });

const readBody = Effect.tryPromise({ try: () => Bun.stdin.text(), catch: unreadable }).pipe(
  Effect.map((text) => text.trim()),
  Effect.filterOrFail(
    (body) => body !== '',
    () => new SessionCliError({ message: 'The item body is empty.' }),
  ),
);

/** How long a socket on stdin has to start sending before a ledger entry is taken to have no body. */
const socketGrace = '500 millis';

/**
 * Everything a socket on stdin sends once it has started within the grace,
 * and nothing when it stays silent, which is what the socket an agent's shell
 * tool holds open without writing to it does.
 */
const socketText = Effect.gen(function*() {
  const reader = Bun.stdin.stream().getReader();
  const decoder = new TextDecoder();
  const first = yield* Effect.tryPromise({ try: () => reader.read(), catch: unreadable }).pipe(
    Effect.timeoutOption(socketGrace),
  );
  if (Option.isNone(first)) {
    // Letting go of the reader is what lets the process end with stdin still open.
    yield* Effect.promise(() => reader.cancel());
    return '';
  }
  let text = '';
  for (let chunk = first.value; !chunk.done; chunk = yield* Effect.tryPromise({ try: () => reader.read(), catch: unreadable })) {
    text += decoder.decode(chunk.value, { stream: true });
  }
  return text + decoder.decode();
});

/**
 * A ledger entry's body, which may be empty: none from a terminal or another
 * device; everything a pipe or a file holds, read to its end; and from a
 * socket, which is what a program spawning the CLI hands it, whatever it sends
 * once it starts within the grace.
 */
const entryBody = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const info = yield* fs.stat('/dev/stdin').pipe(Effect.option);
  if (Option.isNone(info) || info.value.type === 'CharacterDevice' || info.value.type === 'BlockDevice') return '';
  if (info.value.type === 'Socket') return (yield* socketText).trim();
  return (yield* Effect.tryPromise({ try: () => Bun.stdin.text(), catch: unreadable })).trim();
});

const itemCount = (session: Session): number =>
  session.stages.reduce((total, stage) => total + stage.items.length, 0);

const counted = (total: number, noun: string): string =>
  `${total} ${noun}${total === 1 ? '' : 's'}`;

const stageIn = (session: Session, stage: Stage) =>
  session.stages.find((entry) => entry.stage === stage)!;

const changesFrom = (previous: FileInventory, current: FileInventory) => ({
  added: Object.keys(current).filter((path) => previous[path] === undefined),
  changed: Object.keys(current).filter(
    (path) => previous[path] !== undefined && previous[path] !== current[path],
  ),
  deleted: Object.keys(previous).filter((path) => current[path] === undefined),
});

/** `init` is the ensure step with its actions printed; every verb runs it. */
const report = (actions: ReadonlyArray<string>) =>
  Effect.gen(function*() {
    if (actions.length === 0) {
      yield* Console.log('Nothing to do');
      return;
    }
    for (const action of actions) yield* Console.log(action);
  });

const openBoard = (resolved: WorktreeSession) =>
  Effect.gen(function*() {
    const settings = yield* ensureDaemon;
    yield* trackWorktree({ settings, path: resolved.worktree.path });
    const address = yield* publicOrigin(settings.port);
    const url = `${address.origin}/w/${encodeWorktreeKey(resolved.worktree.name)}/`;
    yield* Console.log(url);
    // The URL is the whole of this command's answer, so it keeps stdout to
    // itself; why it is this address and not the nicer one is a remark beside
    // it, and it is never left unsaid.
    if (address.notice !== null) yield* Console.error(address.notice);
    yield* openInBrowser(url);
  });

const refresh = (options: Options, repository: SessionRepository, directory: string) =>
  Effect.gen(function*() {
    const { inventory, skipped } = yield* repository.inventory;
    let previous: FileInventory = {};
    if (options.previous !== undefined) {
      const fs = yield* FileSystem.FileSystem;
      const encoded = yield* fs.readFileString(options.previous);
      previous = (yield* Schema.decodeEffect(PreviousRefreshJson)(encoded)).inventory;
    }
    yield* Console.log(
      JSON.stringify(
        { directory, inventory, changes: changesFrom(previous, inventory), skipped },
        null,
        2,
      ),
    );
  });

const list = (options: Options, repository: SessionRepository) =>
  Effect.gen(function*() {
    const only = options.operands[0] === undefined
      ? undefined
      : yield* cliTry(() => asStage(options.operands[0]!));
    const session = yield* repository.load;
    const rows: Array<{ id: string; path: string; title: string }> = [];
    for (const stage of session.stages) {
      if (only !== undefined && stage.stage !== only) continue;
      for (const item of stage.items) {
        rows.push({ id: item.id, path: item.path, title: item.title });
      }
    }
    const idWidth = Math.max(2, ...rows.map((row) => row.id.length));
    const pathWidth = Math.max(4, ...rows.map((row) => row.path.length));
    for (const row of rows) {
      yield* Console.log(`${row.id.padEnd(idWidth)}  ${row.path.padEnd(pathWidth)}  ${row.title}`);
    }
  });

const add = (options: Options, repository: SessionRepository) =>
  Effect.gen(function*() {
    const stage = yield* cliTry(() => asStage(options.operands[0]!));
    const id = options.operands[1]!;
    const title = options.operands[2]!;
    const body = yield* readBody;
    const session = yield* repository.load;
    yield* repository.addItem({ stage, id, title, body, revision: session.revision });
    yield* Console.log(`Added ${id} to ${stage}`);
  });

const move = (options: Options, repository: SessionRepository) =>
  Effect.gen(function*() {
    const id = options.operands[0]!;
    const stage = yield* cliTry(() => asStage(options.operands[1]!));
    const session = yield* repository.load;
    const moved = yield* repository.moveItem({
      id,
      to: stage,
      beforeId: options.before,
      revision: session.revision,
    });
    const item = stageIn(moved, stage).items.find((entry) => entry.id === id)!;
    yield* Console.log(`Moved ${id} to ${item.path}`);
  });

const queue = (options: Options, repository: SessionRepository) =>
  Effect.gen(function*() {
    const name = options.operands[0]!;
    const ids = options.operands.slice(1);
    const session = yield* repository.load;
    yield* repository.queueBatch({ name, ids, revision: session.revision });
    yield* Console.log(`Queued ${quote(name)} (${counted(ids.length, 'item')})`);
  });

const start = (repository: SessionRepository) =>
  Effect.gen(function*() {
    const session = yield* repository.load;
    const started = yield* repository.startBatch({ revision: session.revision });
    const execute = stageIn(started, 'EXECUTE');
    yield* Console.log(
      `Started ${quote(execute.items[0]?.batch ?? '')} (${counted(execute.items.length, 'item')})`,
    );
  });

const complete = (options: Options, repository: SessionRepository) =>
  Effect.gen(function*() {
    const id = options.operands[0]!;
    const session = yield* repository.load;
    yield* repository.completeItem({ id, revision: session.revision });
    yield* Console.log(`Completed ${id}`);
  });

const archive = (options: Options, repository: SessionRepository) =>
  Effect.gen(function*() {
    const id = options.operands[0]!;
    const session = yield* repository.load;
    yield* repository.archiveItem({ id, revision: session.revision });
    yield* Console.log(`Archived ${id}`);
  });

/**
 * One ledger entry. The body is whatever stdin carries, as `entryBody` reads
 * it; the branch and commit are Git's, and the batch is the one Execute is
 * running.
 */
const log = (options: Options, repository: SessionRepository, resolved: WorktreeSession) =>
  Effect.gen(function*() {
    const body = yield* entryBody;
    const entry = yield* repository.appendLedger({
      by: options.operands[0]!,
      title: options.operands[1]!,
      body,
      branch: resolved.worktree.branch,
      commit: resolved.git === null ? null : yield* headCommit(resolved.worktree.path),
    });
    yield* Console.log(`Logged ${entry.name.slice(0, -'.md'.length)}`);
  });

const check = (repository: SessionRepository) =>
  Effect.gen(function*() {
    const session = yield* repository.check;
    const total = itemCount(session);
    yield* Console.log(`OK ${session.revision}, ${total === 0 ? 'empty' : counted(total, 'item')}`);
  });

/**
 * A command that just scaffolded a session tells a daemon that is already
 * running about it, so a new worktree reaches the index without anyone opening
 * a board. It never starts one: `open` is the command that does that, and a
 * daemon that refuses is not this command's failure.
 */
const registerSession = (resolved: WorktreeSession) =>
  Effect.gen(function*() {
    const { settings, probe } = yield* daemonOnPort;
    if (probe.kind !== 'ours') return;
    yield* trackWorktree({ settings, path: resolved.worktree.path });
  }).pipe(Effect.ignore);

const runCommand = (options: Options) =>
  Effect.gen(function*() {
    const resolved = yield* resolveWorktreeSession(options.directory);
    // Everything but the validator converges the session before it runs.
    const ensured = options.command === 'check' ? [] : yield* ensureSession(resolved);
    if (ensured.length > 0) yield* registerSession(resolved);
    const repository = yield* makeRepository(resolved.directory);
    switch (options.command) {
      case 'init': { yield* report(ensured); break; }
      case 'archive': { yield* archive(options, repository); break; }
      case 'open': { yield* openBoard(resolved); break; }
      case 'check': { yield* check(repository); break; }
      case 'refresh': { yield* refresh(options, repository, resolved.directory); break; }
      case 'ls': { yield* list(options, repository); break; }
      case 'add': { yield* add(options, repository); break; }
      case 'mv': { yield* move(options, repository); break; }
      case 'batch': { yield* queue(options, repository); break; }
      case 'start': { yield* start(repository); break; }
      case 'done': { yield* complete(options, repository); break; }
      case 'log': { yield* log(options, repository, resolved); break; }
    }
  });

/** Every failure reaches the user as one line on stderr, never as a stack. */
const reportFailure = (error: unknown) =>
  Console.error(error instanceof Error ? error.message : String(error)).pipe(
    Effect.flatMap(() => Effect.sync(() => process.exit(1))),
  );

const cli = () =>
  Effect.gen(function*() {
    const path = yield* Path.Path;
    const options = yield* cliTry(() => parseOptions(path, process.argv.slice(2)));
    yield* runCommand(options);
  }).pipe(Effect.catch(reportFailure), Effect.provide(NodeServices.layer));

NodeRuntime.runMain(cli());
