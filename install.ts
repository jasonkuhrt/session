import { NodeFileSystem, NodePath, NodeRuntime } from '@effect/platform-node';
import { Config, Data, Effect, FileSystem, Option, Path } from 'effect';
import * as Console from 'effect/Console';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { home: { type: 'string' } } });

class InstallError extends Data.TaggedError('InstallError')<{ readonly message: string }> {}

const install = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const home = values.home ?? (yield* Config.String('HOME'));
  const source = path.join(import.meta.dir, 'src/session');
  const command = path.join(import.meta.dir, 'bin/session');
  const roots = [path.join(home, '.codex/skills'), path.join(home, '.claude/skills')];
  const binRoot = path.join(home, '.local/bin');
  const backup = path.join(home, '.codex/retired-skills');
  // The skill links plus the `session` command, each linked from its own root.
  const links = [
    ...roots.map((root) => ({ root, name: 'session', source })),
    { root: binRoot, name: 'session', source: command },
  ];

  // Preflight every destination before retiring any entrypoint. A conflicting
  // user-owned installation must leave the current harness fully usable.
  for (const entry of links) {
    const target = path.join(entry.root, entry.name);
    const link = yield* fs.readLink(target).pipe(Effect.option);
    if (Option.isSome(link) && path.resolve(entry.root, link.value) !== entry.source) {
      return yield* new InstallError({
        message: `Refusing to replace an unrelated session link: ${target}`,
      });
    }
    if (Option.isNone(link) && (yield* fs.exists(target))) {
      return yield* new InstallError({
        message: `Refusing to replace a user-owned path: ${target}`,
      });
    }
  }

  for (const entry of links) {
    yield* fs.makeDirectory(entry.root, { recursive: true });
    const target = path.join(entry.root, entry.name);
    if (!(yield* fs.exists(target))) yield* fs.symlink(entry.source, target);
    yield* Console.log(`Installed ${target}`);
  }

  yield* fs.makeDirectory(backup, { recursive: true });
  for (const root of roots) {
    for (const name of ['burndown', 'workbench', 'session-refresh']) {
      const current = path.join(root, name);
      // readLink also finds a broken legacy symlink; exists follows its target.
      const present = yield* fs.stat(current).pipe(Effect.option);
      const link = yield* fs.readLink(current).pipe(Effect.option);
      if (Option.isNone(present) && Option.isNone(link)) continue;
      let suffix = 0;
      let destination = path.join(backup, `${root.includes('.codex') ? 'codex' : 'claude'}-${name}`);
      while (
        (yield* fs.exists(destination)) ||
        Option.isSome(yield* fs.readLink(destination).pipe(Effect.option))
      ) {
        destination = path.join(backup, `${root.includes('.codex') ? 'codex' : 'claude'}-${name}-${++suffix}`);
      }
      yield* fs.rename(current, destination);
      yield* Console.log(`Retired ${current}`);
    }
  }
});

NodeRuntime.runMain(install.pipe(Effect.provide([NodeFileSystem.layer, NodePath.layer])));
