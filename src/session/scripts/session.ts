#!/usr/bin/env bun
import { resolve } from 'node:path';
import { NodeServices } from '@effect/platform-node';
import * as Console from 'effect/Console';
import * as Effect from 'effect/Effect';
import * as FileSystem from 'effect/FileSystem';
import * as Schema from 'effect/Schema';
import { startServer } from '../../../app/server/http.ts';
import { makeRepository, type FileInventory } from '../../../app/server/repository.ts';

const usage = `Usage:
  session.ts init <dir>
  session.ts check <dir>
  session.ts refresh <dir> [--previous <inventory.json>]
  session.ts serve <dir> [--port <number>]`;

const PreviousRefresh = Schema.Struct({
  inventory: Schema.Record(Schema.String, Schema.String),
});

const parseOptions = (args: string[]) => {
  const command = args[0];
  const directory = resolve(args[1] ?? '.');
  let port = 3210;
  let previous: string | undefined;
  for (let index = 2; index < args.length; index += 1) {
    const option = args[index]!;
    const value = args[index + 1];
    if (option === '--port' && value !== undefined) {
      port = Number(value);
      if (!Number.isInteger(port) || port < 1 || port > 65_535) {
        throw new Error('--port must be an integer from 1 through 65535.');
      }
      index += 1;
    } else if (option === '--previous' && value !== undefined) {
      previous = resolve(value);
      index += 1;
    } else {
      throw new Error(`Unknown option ${option}.`);
    }
  }
  return { command, directory, port, previous };
};

const changesFrom = (previous: FileInventory, current: FileInventory) => ({
  added: Object.keys(current).filter((path) => previous[path] === undefined),
  changed: Object.keys(current).filter(
    (path) => previous[path] !== undefined && previous[path] !== current[path],
  ),
  deleted: Object.keys(previous).filter((path) => current[path] === undefined),
});

const program = Effect.gen(function*() {
  const options = yield* Effect.try({
    try: () => parseOptions(process.argv.slice(2)),
    catch: (cause) => new Error(cause instanceof Error ? cause.message : String(cause)),
  });
  if (!['init', 'check', 'refresh', 'serve'].includes(options.command ?? '')) {
    return yield* Effect.fail(new Error(usage));
  }

  if (options.command === 'serve') {
    const server = yield* Effect.tryPromise(() =>
      startServer({ directory: options.directory, port: options.port }),
    );
    yield* Console.log(`Session app: http://${server.hostname}:${server.port}`);
    yield* Console.log(`Files: ${options.directory}`);
    return;
  }

  const repository = yield* makeRepository(options.directory);
  if (options.command === 'init') {
    yield* repository.initialize;
    yield* Console.log(`Initialized ${options.directory}`);
    return;
  }
  if (options.command === 'check') {
    const session = yield* repository.load;
    const itemCount = session.stages.reduce((total, stage) => total + stage.items.length, 0);
    yield* Console.log(`OK ${session.revision} (${itemCount} items)`);
    return;
  }

  const inventory = yield* repository.inventory;
  let previous: FileInventory = {};
  if (options.previous !== undefined) {
    const fs = yield* FileSystem.FileSystem;
    const encoded = yield* fs.readFileString(options.previous);
    const parsed = yield* Effect.try({
      try: () => JSON.parse(encoded) as unknown,
      catch: (cause) => new Error(cause instanceof Error ? cause.message : String(cause)),
    });
    const decoded = yield* Schema.decodeUnknownEffect(PreviousRefresh)(parsed);
    previous = decoded.inventory;
  }
  yield* Console.log(
    JSON.stringify(
      {
        directory: options.directory,
        inventory,
        changes: changesFrom(previous, inventory),
      },
      null,
      2,
    ),
  );
}).pipe(Effect.provide(NodeServices.layer));

Effect.runPromise(program).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
