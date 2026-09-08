import { NodeFileSystem, NodePath, NodeRuntime } from '@effect/platform-node';
import { Config, Data, Effect, FileSystem, Option, Path } from 'effect';
import * as Console from 'effect/Console';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { home: { type: 'string' } } });

class InstallError extends Data.TaggedError('InstallError')<{ readonly message: string }> {}

const install = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const home = values.home ?? (yield* Config.string('HOME'));
  const source = path.join(import.meta.dir, 'src/session');
  const roots = [path.join(home, '.codex/skills'), path.join(home, '.claude/skills')];
  const backup = path.join(home, '.codex/retired-skills');

  // Preflight both destinations before retiring any entrypoint. A conflicting
  // user-owned installation must leave the current harness fully usable.
  for (const root of roots) {
    const target = path.join(root, 'session');
    const link = yield* fs.readLink(target).pipe(Effect.option);
    if (Option.isSome(link) && path.resolve(root, link.value) !== source) {
      return yield* new InstallError({
        message: `Refusing to replace an unrelated session link: ${target}`,
      });
    }
    if (Option.isNone(link) && (yield* fs.exists(target))) {
      return yield* new InstallError({
        message: `Refusing to replace a user-owned directory: ${target}`,
      });
    }
  }

  for (const root of roots) {
    yield* fs.makeDirectory(root, { recursive: true });
    const target = path.join(root, 'session');
    if (!(yield* fs.exists(target))) yield* fs.symlink(source, target);
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
