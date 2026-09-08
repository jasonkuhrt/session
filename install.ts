import { Config, Effect, FileSystem, Path } from 'effect';
import { NodeFileSystem, NodePath } from '@effect/platform-node';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { home: { type: 'string' } } });

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
    if (link._tag === 'Some' && path.resolve(root, link.value) !== source) {
      yield* Effect.fail(new Error(`Refusing to replace an unrelated session link: ${target}`));
    }
    if (link._tag === 'None' && (yield* fs.exists(target))) {
      yield* Effect.fail(new Error(`Refusing to replace a user-owned directory: ${target}`));
    }
  }

  for (const root of roots) {
    yield* fs.makeDirectory(root, { recursive: true });
    const target = path.join(root, 'session');
    if (!(yield* fs.exists(target))) yield* fs.symlink(source, target);
    console.log(`Installed ${target}`);
  }

  yield* fs.makeDirectory(backup, { recursive: true });
  for (const root of roots) {
    for (const name of ['burndown', 'workbench', 'session-refresh']) {
      const current = path.join(root, name);
      // readLink also finds a broken legacy symlink; exists follows its target.
      const present = yield* fs.stat(current).pipe(Effect.option);
      const link = yield* fs.readLink(current).pipe(Effect.option);
      if (present._tag === 'None' && link._tag === 'None') continue;
      let suffix = 0;
      let destination = path.join(backup, `${root.includes('.codex') ? 'codex' : 'claude'}-${name}`);
      while ((yield* fs.exists(destination)) || (yield* fs.readLink(destination).pipe(Effect.option))._tag === 'Some') {
        destination = path.join(backup, `${root.includes('.codex') ? 'codex' : 'claude'}-${name}-${++suffix}`);
      }
      yield* fs.rename(current, destination);
      console.log(`Retired ${current}`);
    }
  }
});

await Effect.runPromise(install.pipe(Effect.provide([NodeFileSystem.layer, NodePath.layer])));
