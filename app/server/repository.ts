import { dirname, join, relative, resolve, sep } from 'node:path';
import * as Crypto from 'effect/Crypto';
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import * as FileSystem from 'effect/FileSystem';
import * as Schema from 'effect/Schema';
import * as Semaphore from 'effect/Semaphore';
import type { Item, Session, Stage, StageFile } from '../contract.ts';
import { stageNames } from '../contract.ts';
import {
  findRequiredItem,
  parseStageMarkdown,
  renderStageMarkdown,
  SessionError,
  validateItem,
  validateUniqueIds,
} from './model.ts';

const encoder = new TextEncoder();
const archivePath = 'ignore/COMPLETED.md';
const journalPath = '.runtime/transaction.json';
const journalNextPath = '.runtime/transaction.next.json';
const accessLockPath = '.runtime/access.lock';

const JournalWrite = Schema.Struct({
  path: Schema.String,
  before: Schema.String,
  after: Schema.String,
});
const Journal = Schema.Struct({
  version: Schema.Literal(1),
  writes: Schema.Array(JournalWrite),
});
type Journal = typeof Journal.Type;

export type FileInventory = Record<string, string>;

export class RepositoryError extends Data.TaggedError('RepositoryError')<{
  readonly kind: 'conflict' | 'io' | 'not-found' | 'validation';
  readonly message: string;
  readonly cause?: unknown;
}> {}

const asRepositoryError = (error: unknown): RepositoryError => {
  if (error instanceof RepositoryError) return error;
  if (error instanceof SessionError) {
    return new RepositoryError({
      kind: error.kind,
      message: error.message,
      cause: error.cause,
    });
  }
  return new RepositoryError({
    kind: 'io',
    message: error instanceof Error ? error.message : String(error),
    cause: error,
  });
};

const attempt = <A>(operation: () => A) =>
  Effect.try({ try: operation, catch: asRepositoryError });

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

const copyItem = (item: Item, group = item.group): Item => ({
  id: item.id,
  title: item.title,
  body: item.body,
  summary: item.summary,
  group,
});

const insertItem = (stage: Stage, items: Item[], item: Item): Item[] => {
  if ((stage === 'BATCH' || stage === 'EXECUTE') && item.group === null) {
    const firstGrouped = items.findIndex((candidate) => candidate.group !== null);
    if (firstGrouped !== -1) {
      return [...items.slice(0, firstGrouped), item, ...items.slice(firstGrouped)];
    }
  }
  return [...items, item];
};

const replaceStage = (
  stages: StageFile[],
  stage: Stage,
  items: Item[],
  markdown = renderStageMarkdown(stage, items),
): StageFile[] =>
  stages.map((entry) =>
    entry.stage === stage
      ? { ...entry, markdown, items }
      : entry,
  );

const decodeJournal = (input: unknown) =>
  Schema.decodeUnknownEffect(Journal)(input).pipe(
    Effect.mapError(
      (cause) =>
        new RepositoryError({
          kind: 'conflict',
          message: 'The session transaction journal is malformed.',
          cause,
        }),
    ),
  );

export const makeRepository = (directory: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    const crypto = yield* Crypto.Crypto;
    const semaphore = yield* Semaphore.make(1);
    const root = resolve(directory);

    const absolute = (relativePath: string) => join(root, relativePath);

    const initialize = Effect.gen(function*() {
      yield* fs.makeDirectory(root, { recursive: true });
      for (const stage of stageNames) {
        const path = absolute(`${stage}.md`);
        if (!(yield* fs.exists(path))) {
          yield* fs.writeFileString(path, '', { flag: 'wx' }).pipe(
            Effect.catch((cause) =>
              fs.exists(path).pipe(
                Effect.flatMap((exists) =>
                  exists ? Effect.succeed(undefined) : Effect.fail(cause),
                ),
              ),
            ),
          );
        }
      }
    }).pipe(Effect.mapError(asRepositoryError));

    const acquireDiskLock = Effect.gen(function*() {
      yield* fs.makeDirectory(absolute('.runtime'), { recursive: true });
      const token = yield* crypto.randomUUIDv4;
      yield* fs.writeFileString(absolute(accessLockPath), token, { flag: 'wx' }).pipe(
        Effect.mapError(
          (cause) =>
            new RepositoryError({
              kind: 'conflict',
              message:
                'Another session process owns this directory. If it crashed, stop all session processes, remove .runtime/access.lock, and retry to recover its journal.',
              cause,
            }),
        ),
      );
      return token;
    }).pipe(Effect.mapError(asRepositoryError));

    const releaseDiskLock = (token: string) =>
      Effect.gen(function*() {
        if (!(yield* fs.exists(absolute(accessLockPath)))) return;
        if ((yield* fs.readFileString(absolute(accessLockPath))) === token) {
          yield* fs.remove(absolute(accessLockPath));
        }
      }).pipe(Effect.mapError(asRepositoryError));

    const withExclusiveAccess = <A, E>(effect: Effect.Effect<A, E>) =>
      semaphore.withPermit(
        Effect.acquireUseRelease(acquireDiskLock, () => effect, releaseDiskLock),
      );

    const digestBytes = (content: Uint8Array) =>
      crypto.digest('SHA-256', content).pipe(
        Effect.map(toHex),
        Effect.mapError(
          (cause) =>
            new RepositoryError({
              kind: 'io',
              message: 'Could not hash session content.',
              cause,
            }),
        ),
      );
    const digest = (content: string) => digestBytes(encoder.encode(content));

    const readOptional = (relativePath: string) =>
      Effect.gen(function*() {
        const path = absolute(relativePath);
        if (!(yield* fs.exists(path))) return '';
        return yield* fs.readFileString(path);
      }).pipe(
        Effect.mapError(
          (cause) =>
            new RepositoryError({
              kind: 'io',
              message: `Could not read ${relativePath}.`,
              cause,
            }),
        ),
      );

    const readStage = (stage: Stage) =>
      Effect.gen(function*() {
        const relativePath = `${stage}.md`;
        const path = absolute(relativePath);
        if (!(yield* fs.exists(path))) {
          return yield* new RepositoryError({
            kind: 'not-found',
            message: `Session is missing ${relativePath}. Run session.ts init <dir>.`,
          });
        }
        return yield* fs.readFileString(path);
      }).pipe(Effect.mapError(asRepositoryError));

    const ensureInsideRoot = (realRoot: string, candidate: string, relativePath: string) => {
      if (candidate !== realRoot && !candidate.startsWith(`${realRoot}${sep}`)) {
        throw new SessionError({
          kind: 'validation',
          message: `${relativePath} resolves outside the session directory.`,
        });
      }
    };

    const isExcludedRealPath = (realRoot: string, candidate: string): boolean =>
      relative(realRoot, candidate)
        .split(sep)
        .some((segment) => segment === 'ignore' || segment === '.runtime');

    const readMarkdownFile = (relativePath: string) =>
      Effect.gen(function*() {
        const segments = relativePath.split(/[\\/]/);
        if (
          !relativePath.endsWith('.md') ||
          relativePath.startsWith('/') ||
          segments.some(
            (segment) =>
              segment === '' ||
              segment === '.' ||
              segment === '..' ||
              segment === 'ignore' ||
              segment === '.runtime',
          )
        ) {
          return yield* new RepositoryError({
            kind: 'not-found',
            message: 'Markdown file is outside the live session.',
          });
        }
        const realRoot = yield* fs.realPath(root);
        const candidate = absolute(relativePath);
        if (!(yield* fs.exists(candidate))) {
          return yield* new RepositoryError({
            kind: 'not-found',
            message: `${relativePath} does not exist.`,
          });
        }
        const realCandidate = yield* fs.realPath(candidate);
        yield* attempt(() => ensureInsideRoot(realRoot, realCandidate, relativePath));
        if (isExcludedRealPath(realRoot, realCandidate)) {
          return yield* new RepositoryError({
            kind: 'not-found',
            message: 'Markdown file is outside the live session.',
          });
        }
        const info = yield* fs.stat(realCandidate);
        if (info.type !== 'File') {
          return yield* new RepositoryError({
            kind: 'not-found',
            message: `${relativePath} is not a file.`,
          });
        }
        return yield* fs.readFileString(realCandidate);
      }).pipe(Effect.mapError(asRepositoryError));

    const atomicWrite = (relativePath: string, content: string, index: number) =>
      Effect.gen(function*() {
        const target = absolute(relativePath);
        const parent = dirname(target);
        const temp = absolute(`.runtime/write-${index}.tmp`);
        yield* fs.makeDirectory(parent, { recursive: true });
        yield* fs.makeDirectory(absolute('.runtime'), { recursive: true });
        yield* fs.writeFileString(temp, content);
        yield* fs.rename(temp, target);
      }).pipe(
        Effect.mapError(
          (cause) =>
            new RepositoryError({
              kind: 'io',
              message: `Could not write ${relativePath}.`,
              cause,
            }),
        ),
      );

    const removeJournal = Effect.gen(function*() {
      if (yield* fs.exists(absolute(journalPath))) {
        yield* fs.remove(absolute(journalPath));
      }
    }).pipe(
      Effect.mapError(
        (cause) =>
          new RepositoryError({
            kind: 'io',
            message: 'Could not remove the completed transaction journal.',
            cause,
          }),
      ),
    );

    const applyJournal = (journal: Journal) =>
      Effect.gen(function*() {
        const allowed = new Set<string>([
          ...stageNames.map((stage) => `${stage}.md`),
          archivePath,
        ]);
        for (const write of journal.writes) {
          if (!allowed.has(write.path)) {
            return yield* new RepositoryError({
              kind: 'conflict',
              message: `Transaction journal contains unsafe path ${write.path}.`,
            });
          }
        }

        const current = yield* Effect.all(
          journal.writes.map((write) => readOptional(write.path)),
        );
        for (const [index, write] of journal.writes.entries()) {
          const value = current[index]!;
          if (value !== write.before && value !== write.after) {
            return yield* new RepositoryError({
              kind: 'conflict',
              message: `Recovery stopped because ${write.path} changed outside the session app.`,
            });
          }
        }

        for (const [index, write] of journal.writes.entries()) {
          if (current[index] === write.before) {
            yield* atomicWrite(write.path, write.after, index);
          }
        }
        yield* removeJournal;
      });

    const recover = Effect.gen(function*() {
      if (!(yield* fs.exists(absolute(journalPath)))) return;
      const encoded = yield* fs.readFileString(absolute(journalPath)).pipe(
        Effect.mapError(
          (cause) =>
            new RepositoryError({
              kind: 'conflict',
              message: 'Could not read the pending transaction journal.',
              cause,
            }),
        ),
      );
      const parsed = yield* attempt(() => JSON.parse(encoded));
      const journal = yield* decodeJournal(parsed);
      yield* applyJournal(journal);
    });

    const readStages = Effect.gen(function*() {
      const markdown = yield* Effect.all(
        stageNames.map(readStage),
      );
      const stages = yield* attempt(() =>
        stageNames.map(
          (stage, index): StageFile => ({
            stage,
            file: absolute(`${stage}.md`),
            markdown: markdown[index]!,
            items: parseStageMarkdown(stage, markdown[index]!),
          }),
        ),
      );
      yield* attempt(() => validateUniqueIds(stages));
      return stages;
    });

    const revisionOf = (stages: StageFile[]) =>
      digest(
        stages
          .map((stage) => `${stage.stage}.md\0${stage.markdown.length}\0${stage.markdown}`)
          .join('\0'),
      );

    const loadUnlocked = Effect.gen(function*() {
      yield* recover;
      const stages = yield* readStages;
      const revision = yield* revisionOf(stages);
      return { directory: root, revision, stages } satisfies Session;
    });

    const writeTransaction = (writes: Journal['writes']) =>
      Effect.gen(function*() {
        if (writes.length === 0) return;
        yield* fs.makeDirectory(absolute('.runtime'), { recursive: true });
        const journal: Journal = { version: 1, writes };
        yield* fs.writeFileString(absolute(journalNextPath), JSON.stringify(journal));
        yield* fs.rename(absolute(journalNextPath), absolute(journalPath));
        yield* applyJournal(journal);
      }).pipe(
        Effect.mapError(asRepositoryError),
      );

    const mutate = (
      revision: string,
      change: (
        session: Session,
      ) => Effect.Effect<ReadonlyArray<{ path: string; before: string; after: string }>, RepositoryError>,
    ) =>
      withExclusiveAccess(
        Effect.gen(function*() {
          const session = yield* loadUnlocked;
          if (session.revision !== revision) {
            return yield* new RepositoryError({
              kind: 'conflict',
              message: 'Session changed on disk. Reload before saving.',
            });
          }
          yield* writeTransaction(yield* change(session));
          return yield* loadUnlocked;
        }),
      );

    const load = withExclusiveAccess(loadUnlocked);

    const putFile = (input: {
      readonly stage: Stage;
      readonly markdown: string;
      readonly revision: string;
    }) =>
      mutate(input.revision, (session) =>
        Effect.gen(function*() {
          const nextItems = yield* attempt(() =>
            parseStageMarkdown(input.stage, input.markdown),
          );
          const current = session.stages.find((stage) => stage.stage === input.stage)!;
          if (input.stage === 'EXECUTE') {
            const currentGroups = new Map(current.items.map((item) => [item.id, item.group]));
            const sameIds =
              current.items.length === nextItems.length &&
              nextItems.every((item) => currentGroups.has(item.id));
            const sameGroups = nextItems.every(
              (item) => currentGroups.get(item.id) === item.group,
            );
            if (!sameIds || !sameGroups) {
              return yield* new RepositoryError({
                kind: 'conflict',
                message: 'EXECUTE edits must preserve its item IDs and groups.',
              });
            }
          }
          const next = replaceStage(session.stages, input.stage, nextItems, input.markdown);
          yield* attempt(() => validateUniqueIds(next));
          return [{ path: `${input.stage}.md`, before: current.markdown, after: input.markdown }];
        }),
      );

    const addItem = (input: {
      readonly stage: Stage;
      readonly id?: string | undefined;
      readonly title: string;
      readonly body: string;
      readonly group?: string | undefined;
      readonly revision: string;
    }) =>
      mutate(input.revision, (session) =>
        Effect.gen(function*() {
          if (input.stage === 'EXECUTE') {
            return yield* new RepositoryError({
              kind: 'conflict',
              message: 'EXECUTE is frozen; create items in another stage.',
            });
          }
          const stage = session.stages.find((entry) => entry.stage === input.stage)!;
          const id =
            input.id ??
            `W-${(yield* crypto.randomUUIDv4.pipe(Effect.mapError(asRepositoryError))).slice(0, 8)}`;
          const item: Item = {
            id,
            title: input.title.trim(),
            body: input.body.trim(),
            summary: input.body.trim().split(/\r?\n/).find((line) => line.trim() !== '')?.trim() ?? input.title,
            group: input.group?.trim() || null,
          };
          yield* attempt(() => validateItem(input.stage, item));
          const items = insertItem(input.stage, stage.items, item);
          const after = yield* attempt(() =>
            renderStageMarkdown(input.stage, items),
          );
          const next = replaceStage(session.stages, input.stage, items, after);
          yield* attempt(() => validateUniqueIds(next));
          return [
            {
              path: `${input.stage}.md`,
              before: stage.markdown,
              after,
            },
          ];
        }),
      );

    const updateItem = (input: {
      readonly id: string;
      readonly title: string;
      readonly body: string;
      readonly revision: string;
    }) =>
      mutate(input.revision, (session) =>
        Effect.gen(function*() {
          const found = yield* attempt(() => findRequiredItem(session.stages, input.id));
          const stage = session.stages.find((entry) => entry.stage === found.stage)!;
          const item: Item = {
            ...found.item,
            title: input.title.trim(),
            body: input.body.trim(),
          };
          yield* attempt(() => validateItem(found.stage, item));
          const items = stage.items.map((candidate) =>
            candidate.id === input.id ? item : candidate,
          );
          const after = yield* attempt(() => renderStageMarkdown(found.stage, items));
          return [
            {
              path: `${found.stage}.md`,
              before: stage.markdown,
              after,
            },
          ];
        }),
      );

    const moveItem = (input: {
      readonly id: string;
      readonly to: Stage;
      readonly body?: string | undefined;
      readonly revision: string;
    }) =>
      mutate(input.revision, (session) =>
        Effect.gen(function*() {
          if (input.to === 'EXECUTE') {
            return yield* new RepositoryError({
              kind: 'conflict',
              message: 'Items enter EXECUTE only through a batch.',
            });
          }
          const found = yield* attempt(() => findRequiredItem(session.stages, input.id));
          if (found.stage === 'EXECUTE') {
            return yield* new RepositoryError({
              kind: 'conflict',
              message: 'EXECUTE is frozen; complete its items instead of moving them.',
            });
          }
          if (found.stage === input.to) return [];

          const source = session.stages.find((entry) => entry.stage === found.stage)!;
          const target = session.stages.find((entry) => entry.stage === input.to)!;
          const sourceItems = source.items.filter((item) => item.id !== input.id);
          const targetItem = copyItem(
            input.body === undefined
              ? found.item
              : { ...found.item, body: input.body.trim() },
            input.to === 'BATCH' ? found.item.group : null,
          );
          yield* attempt(() => validateItem(input.to, targetItem));
          const targetItems = insertItem(input.to, target.items, targetItem);
          const sourceMarkdown = yield* attempt(() =>
            renderStageMarkdown(found.stage, sourceItems),
          );
          const targetMarkdown = yield* attempt(() =>
            renderStageMarkdown(input.to, targetItems),
          );
          return [
            {
              path: `${found.stage}.md`,
              before: source.markdown,
              after: sourceMarkdown,
            },
            {
              path: `${input.to}.md`,
              before: target.markdown,
              after: targetMarkdown,
            },
          ];
        }),
      );

    const startBatch = (input: {
      readonly ids: ReadonlyArray<string>;
      readonly name: string;
      readonly revision: string;
    }) =>
      mutate(input.revision, (session) =>
        Effect.gen(function*() {
          if (input.ids.length === 0) {
            return yield* new RepositoryError({
              kind: 'validation',
              message: 'A batch requires at least one item.',
            });
          }
          if (new Set(input.ids).size !== input.ids.length) {
            return yield* new RepositoryError({
              kind: 'validation',
              message: 'A batch cannot contain duplicate item IDs.',
            });
          }
          const name = input.name.trim();
          if (name === '') {
            return yield* new RepositoryError({
              kind: 'validation',
              message: 'A batch requires a name.',
            });
          }
          const batch = session.stages.find((entry) => entry.stage === 'BATCH')!;
          const execute = session.stages.find((entry) => entry.stage === 'EXECUTE')!;
          if (execute.items.length > 0 || execute.markdown !== '') {
            return yield* new RepositoryError({
              kind: 'conflict',
              message: 'Complete the current EXECUTE batch first.',
            });
          }
          const selected = yield* attempt(() =>
            input.ids.map((id) => {
              const item = batch.items.find((candidate) => candidate.id === id);
              if (item === undefined) {
                throw new RepositoryError({
                  kind: 'validation',
                  message: `Batch item ${id} is not in BATCH.`,
                });
              }
              return copyItem(item, name);
            }),
          );
          const batchMarkdown = yield* attempt(() =>
            renderStageMarkdown(
              'BATCH',
              batch.items.filter((item) => !input.ids.includes(item.id)),
            ),
          );
          const executeMarkdown = yield* attempt(() =>
            renderStageMarkdown('EXECUTE', selected),
          );
          return [
            {
              path: 'BATCH.md',
              before: batch.markdown,
              after: batchMarkdown,
            },
            { path: 'EXECUTE.md', before: execute.markdown, after: executeMarkdown },
          ];
        }).pipe(Effect.mapError(asRepositoryError)),
      );

    const completeItem = (input: { readonly id: string; readonly revision: string }) =>
      mutate(input.revision, (session) =>
        Effect.gen(function*() {
          const found = yield* attempt(() => findRequiredItem(session.stages, input.id));
          if (found.stage !== 'EXECUTE') {
            return yield* new RepositoryError({
              kind: 'conflict',
              message: `Item ${input.id} is not in EXECUTE.`,
            });
          }
          const execute = session.stages.find((entry) => entry.stage === 'EXECUTE')!;
          const beforeArchive = yield* readOptional(archivePath);
          const record = `# ${found.item.group ?? 'Completed'}\n\n## ${found.item.id} — ${found.item.title}\n\n${found.item.body.trim()}\n`;
          const afterArchive = beforeArchive === '' ? record : `${beforeArchive.trimEnd()}\n\n${record}`;
          const executeMarkdown = yield* attempt(() =>
            renderStageMarkdown(
              'EXECUTE',
              execute.items.filter((item) => item.id !== input.id),
            ),
          );
          return [
            {
              path: 'EXECUTE.md',
              before: execute.markdown,
              after: executeMarkdown,
            },
            { path: archivePath, before: beforeArchive, after: afterArchive },
          ];
        }),
      );

    const inventory = withExclusiveAccess(
      Effect.gen(function*() {
        yield* recover;
        yield* readStages;
        const realRoot = yield* fs.realPath(root).pipe(Effect.mapError(asRepositoryError));
        const visited = new Set<string>();
        const walk = (
          relativeDirectory: string,
          realDirectory: string,
        ): Effect.Effect<Array<readonly [string, string]>, RepositoryError> =>
          Effect.gen(function*() {
            if (visited.has(realDirectory)) return [];
            visited.add(realDirectory);
            const names = yield* fs.readDirectory(realDirectory).pipe(
              Effect.map((entries) => entries.sort()),
              Effect.mapError(asRepositoryError),
            );
            const entries: Array<readonly [string, string]> = [];
            for (const name of names) {
              if (name === 'ignore' || name === '.runtime') continue;
              const relativePath = relativeDirectory === '' ? name : join(relativeDirectory, name);
              const candidate = join(realDirectory, name);
              const realCandidate = yield* fs.realPath(candidate).pipe(
                Effect.mapError(asRepositoryError),
              );
              yield* attempt(() => ensureInsideRoot(realRoot, realCandidate, relativePath));
              if (isExcludedRealPath(realRoot, realCandidate)) continue;
              const info = yield* fs.stat(realCandidate).pipe(Effect.mapError(asRepositoryError));
              if (info.type === 'Directory') {
                entries.push(...(yield* walk(relativePath, realCandidate)));
              } else if (info.type === 'File') {
                const content = yield* fs.readFile(realCandidate).pipe(
                  Effect.mapError(asRepositoryError),
                );
                entries.push([relativePath, yield* digestBytes(content)]);
              }
            }
            return entries;
          });
        return Object.fromEntries(yield* walk('', realRoot)) as FileInventory;
      }),
    );

    return {
      root,
      initialize,
      load,
      putFile,
      addItem,
      updateItem,
      moveItem,
      startBatch,
      completeItem,
      inventory,
      readMarkdownFile,
    } as const;
  });

export type SessionRepository = Effect.Effect.Success<ReturnType<typeof makeRepository>>;
