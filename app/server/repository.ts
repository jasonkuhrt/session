import { dirname, join, relative, resolve, sep } from 'node:path';
import * as Crypto from 'effect/Crypto';
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import * as FileSystem from 'effect/FileSystem';
import * as Schema from 'effect/Schema';
import * as Semaphore from 'effect/Semaphore';
import type { Item, Session, Stage, StageFile, StageLayout } from '../contract.ts';
import { isBatchedStage, stageFileLineLimit, stageNames } from '../contract.ts';
import {
  parseStageDirectory,
  renderStageDirectory,
  type StageFileEntry,
  type StageTreeEntry,
} from './layout.ts';
import {
  fail,
  findRequiredItem,
  makeItem,
  parseStageMarkdown,
  quote,
  renderItem,
  renderStageMarkdown,
  SessionError,
  validateBatchName,
  validateItem,
  validateUniqueIds,
} from './model.ts';

/* eslint-disable max-lines, max-lines-per-function -- The repository is one serialized transaction boundary; splitting its journal protocol and closures would obscure the invariants they share. */

const encoder = new TextEncoder();
const archivePath = 'ignore/COMPLETED.md';
const gitignorePath = '.gitignore';
const gitignoreContent = '*\n';
const journalPath = '.runtime/transaction.json';
const journalNextPath = '.runtime/transaction.next.json';
const accessLockPath = '.runtime/access.lock';

/** `null` is "the file is absent", which a rename or a split needs on both sides. */
const JournalWrite = Schema.Struct({
  path: Schema.String,
  before: Schema.NullOr(Schema.String),
  after: Schema.NullOr(Schema.String),
});
const JournalSchema = Schema.Struct({
  version: Schema.Literal(2),
  writes: Schema.Array(JournalWrite),
});
const JournalFromJsonString = Schema.fromJsonString(JournalSchema);
type Journal = typeof JournalSchema.Type;
type PendingWrite = typeof JournalWrite.Type;

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

/** `wc -l`: the number of newlines, which is what the 500-line rule counts. */
const lineCount = (markdown: string): number => markdown.split('\n').length - 1;

/** A stage plus the files that carry it, so a mutation can diff them. */
type StageState = {
  readonly stage: Stage;
  readonly layout: StageLayout;
  readonly path: string;
  readonly markdown: string;
  readonly items: Item[];
  readonly files: ReadonlyArray<StageFileEntry>;
};

type Loaded = {
  readonly root: string;
  readonly revision: string;
  readonly stages: StageState[];
};

const toStageFile = (state: StageState): StageFile => ({
  stage: state.stage,
  layout: state.layout,
  path: state.path,
  markdown: state.markdown,
  items: state.items,
});

const toSession = (loaded: Loaded): Session => ({
  directory: loaded.root,
  revision: loaded.revision,
  stages: loaded.stages.map(toStageFile),
});

const stageOf = (loaded: Loaded, stage: Stage): StageState =>
  loaded.stages.find((entry) => entry.stage === stage)!;

const projected = (
  loaded: Loaded,
  updates: ReadonlyArray<{ readonly stage: Stage; readonly items: ReadonlyArray<Item> }>,
) =>
  loaded.stages.map((state) => ({
    stage: state.stage,
    items: updates.find((update) => update.stage === state.stage)?.items ?? state.items,
  }));

/** The files a transaction must create, rewrite, or delete to reach `desired`. */
const diffFiles = (
  current: ReadonlyArray<StageFileEntry>,
  desired: ReadonlyArray<StageFileEntry>,
): PendingWrite[] => {
  const currentByPath = new Map(current.map((entry) => [entry.path, entry.content] as const));
  const desiredPaths = new Set(desired.map((entry) => entry.path));
  const writes: PendingWrite[] = [];
  for (const entry of desired) {
    const before = currentByPath.get(entry.path) ?? null;
    if (before !== entry.content) writes.push({ path: entry.path, before, after: entry.content });
  }
  for (const entry of current) {
    if (!desiredPaths.has(entry.path)) {
      writes.push({ path: entry.path, before: entry.content, after: null });
    }
  }
  return writes;
};

/**
 * The stage's files after this change. A file-layout stage that would pass the
 * line limit becomes a directory in the same transaction; the conversion never
 * reverses.
 */
const stageWrites = (
  state: StageState,
  items: ReadonlyArray<Item>,
  options?: { readonly directory?: boolean | undefined },
): PendingWrite[] => {
  const markdown = renderStageMarkdown(state.stage, items);
  const asDirectory = state.layout === 'directory' ||
    options?.directory === true ||
    lineCount(markdown) > stageFileLineLimit;
  const desired = asDirectory
    ? renderStageDirectory({ stage: state.stage, items, current: state.files })
    : [{ path: `${state.stage}.md`, content: markdown }];
  return diffFiles(state.files, desired);
};

const placeItem = (
  stage: Stage,
  items: ReadonlyArray<Item>,
  item: Item,
  beforeId: string | null | undefined,
): Item[] => {
  const insertAt = (index: number) => [...items.slice(0, index), item, ...items.slice(index)];
  const indexOfBefore = (from: number, to: number) => {
    const index = items.findIndex((candidate) => candidate.id === beforeId);
    if (index < from || index >= to) {
      fail(`${stage}: cannot place ${item.id} before ${String(beforeId)}.`);
    }
    return index;
  };

  if (!isBatchedStage(stage)) {
    if (beforeId === undefined || beforeId === null) return [...items, item];
    return insertAt(indexOfBefore(0, items.length));
  }

  const batch: string = item.batch ??
    fail(`${stage}/${item.id}: every ${stage} item belongs to a batch.`);
  const start = items.findIndex((candidate) => candidate.batch === batch);
  if (start === -1) {
    if (beforeId !== undefined && beforeId !== null) {
      fail(`${stage}: batch ${quote(batch)} has no item ${beforeId}.`);
    }
    return [...items, item];
  }
  let end = start;
  while (end < items.length && items[end]!.batch === batch) end += 1;
  if (beforeId === undefined || beforeId === null) return insertAt(end);
  return insertAt(indexOfBefore(start, end));
};

const decodeJournal = (input: string) =>
  Schema.decodeEffect(JournalFromJsonString)(input).pipe(
    Effect.mapError(
      (cause) =>
        new RepositoryError({
          kind: 'conflict',
          message:
            'The session transaction journal is not a version 2 journal. Inspect .runtime/transaction.json, apply or discard it by hand, and remove it.',
          cause,
        }),
    ),
  );

const safeSegments = (segments: ReadonlyArray<string>): boolean =>
  segments.every(
    (segment) =>
      segment !== '' &&
      segment !== '.' &&
      segment !== '..' &&
      segment !== 'ignore' &&
      segment !== '.runtime',
  );

/** Stage files, stage item files, and the completion archive; nothing else. */
const isJournalPath = (path: string): boolean => {
  if (path === archivePath) return true;
  const segments = path.split('/');
  if (!safeSegments(segments)) return false;
  const head = segments[0]!;
  if (segments.length === 1) return stageNames.some((stage) => head === `${stage}.md`);
  return stageNames.some((stage) => head === stage) && path.endsWith('.md');
};

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

export const makeRepository = (directory: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    const crypto = yield* Crypto.Crypto;
    const semaphore = yield* Semaphore.make(1);
    const root = resolve(directory);

    const absolute = (relativePath: string) => join(root, relativePath);

    const pathType = (path: string) =>
      Effect.gen(function*() {
        if (!(yield* fs.exists(path))) return null;
        return (yield* fs.stat(path)).type;
      });

    const writeIfAbsent = (path: string, content: string) =>
      fs.writeFileString(path, content, { flag: 'wx' }).pipe(
        Effect.catch((cause) =>
          fs.exists(path).pipe(
            Effect.flatMap((exists) => exists ? Effect.void : Effect.fail(cause)),
          ),
        ),
      );

    const initialize = Effect.gen(function*() {
      yield* fs.makeDirectory(root, { recursive: true });
      for (const stage of stageNames) {
        const layouts = yield* Effect.all([
          fs.exists(absolute(`${stage}.md`)),
          fs.exists(absolute(stage)),
        ]);
        if (layouts.includes(true)) continue;
        yield* writeIfAbsent(absolute(`${stage}.md`), '');
      }
      yield* writeIfAbsent(absolute(gitignorePath), gitignoreContent);
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
        Effect.map((bytes) => toHex(bytes)),
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

    /** `null` when the file is absent, which the journal records as such. */
    const readMaybe = (relativePath: string) =>
      Effect.gen(function*() {
        const path = absolute(relativePath);
        if (!(yield* fs.exists(path))) return null;
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

    const readStageTree = (stageDirectory: string) =>
      Effect.gen(function*() {
        const entries: StageTreeEntry[] = [];
        for (const name of (yield* fs.readDirectory(stageDirectory)).toSorted()) {
          if (name.startsWith('.')) continue;
          const child = join(stageDirectory, name);
          const info = yield* fs.stat(child);
          if (info.type !== 'Directory') {
            entries.push({
              name,
              type: 'file',
              content: yield* fs.readFileString(child),
              children: [],
            });
            continue;
          }
          const children: Array<StageTreeEntry['children'][number]> = [];
          for (const innerName of (yield* fs.readDirectory(child)).toSorted()) {
            if (innerName.startsWith('.')) continue;
            const inner = join(child, innerName);
            const innerInfo = yield* fs.stat(inner);
            const isDirectory = innerInfo.type === 'Directory';
            children.push({
              name: innerName,
              type: isDirectory ? 'directory' : 'file',
              content: isDirectory ? '' : yield* fs.readFileString(inner),
            });
          }
          entries.push({ name, type: 'directory', content: '', children });
        }
        return entries;
      });

    const readStageState = (stage: Stage) =>
      Effect.gen(function*() {
        const filePath = absolute(`${stage}.md`);
        const directoryPath = absolute(stage);
        const [fileType, directoryType] = yield* Effect.all([
          pathType(filePath),
          pathType(directoryPath),
        ]);
        if (fileType !== null && directoryType === 'Directory') {
          return yield* new RepositoryError({
            kind: 'validation',
            message: `Session has both ${stage}.md and ${stage}/. Keep one of them.`,
          });
        }
        if (directoryType === 'Directory') {
          const tree = yield* readStageTree(directoryPath);
          const parsed = yield* attempt(() => parseStageDirectory(stage, tree));
          const markdown = yield* attempt(() => renderStageMarkdown(stage, parsed.items));
          return {
            stage,
            layout: 'directory',
            path: directoryPath,
            markdown,
            items: parsed.items,
            files: parsed.files,
          } satisfies StageState;
        }
        if (fileType === null) {
          return yield* new RepositoryError({
            kind: 'not-found',
            message: `Session is missing ${stage}.md. Run \`session init\`.`,
          });
        }
        const markdown = yield* fs.readFileString(filePath);
        const items = yield* attempt(() => parseStageMarkdown(stage, markdown));
        return {
          stage,
          layout: 'file',
          path: filePath,
          markdown,
          items,
          files: [{ path: `${stage}.md`, content: markdown }],
        } satisfies StageState;
      }).pipe(Effect.mapError(asRepositoryError));

    const readMarkdownFile = (relativePath: string) =>
      Effect.gen(function*() {
        const segments = relativePath.split(/[\\/]/u);
        if (
          !relativePath.endsWith('.md') ||
          relativePath.startsWith('/') ||
          !safeSegments(segments)
        ) {
          return yield* new RepositoryError({
            kind: 'not-found',
            message: 'Markdown file is outside the live session.',
          });
        }
        const stage = stageNames.find((candidate) => relativePath === `${candidate}.md`);
        if (stage !== undefined && (yield* pathType(absolute(stage))) === 'Directory') {
          return (yield* readStageState(stage)).markdown;
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
        const temp = absolute(`.runtime/write-${index}.tmp`);
        yield* fs.makeDirectory(dirname(target), { recursive: true });
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

    const removeFile = (relativePath: string) =>
      Effect.gen(function*() {
        const target = absolute(relativePath);
        if (yield* fs.exists(target)) yield* fs.remove(target);
      }).pipe(
        Effect.mapError(
          (cause) =>
            new RepositoryError({
              kind: 'io',
              message: `Could not remove ${relativePath}.`,
              cause,
            }),
        ),
      );

    /** A stage directory keeps itself; the batch directories it empties do not. */
    const pruneEmptyDirectories = Effect.gen(function*() {
      for (const stage of stageNames) {
        const stageDirectory = absolute(stage);
        if ((yield* pathType(stageDirectory)) !== 'Directory') continue;
        for (const name of yield* fs.readDirectory(stageDirectory)) {
          const child = join(stageDirectory, name);
          if ((yield* pathType(child)) !== 'Directory') continue;
          // `remove` needs `recursive` for a directory even when it is empty.
          if ((yield* fs.readDirectory(child)).length === 0) {
            yield* fs.remove(child, { recursive: true });
          }
        }
      }
    }).pipe(
      Effect.mapError(
        (cause) =>
          new RepositoryError({
            kind: 'io',
            message: 'Could not remove an emptied batch directory.',
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
        for (const write of journal.writes) {
          if (!isJournalPath(write.path)) {
            return yield* new RepositoryError({
              kind: 'conflict',
              message: `Transaction journal contains unsafe path ${write.path}.`,
            });
          }
        }

        // Oxlint mistakes Effect.forEach's iterable argument for a callback.
        const current = yield* Effect.forEach(
          // eslint-disable-next-line unicorn/no-array-callback-reference
          journal.writes,
          (write) => readMaybe(write.path),
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
          if (current[index] !== write.before) continue;
          if (write.after === null) yield* removeFile(write.path);
          else yield* atomicWrite(write.path, write.after, index);
        }
        yield* removeJournal;
        yield* pruneEmptyDirectories;
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
      const journal = yield* decodeJournal(encoded);
      yield* applyJournal(journal);
    }).pipe(Effect.mapError(asRepositoryError));

    const revisionOf = (stages: ReadonlyArray<StageState>) =>
      digest(
        stages
          .map((stage) => `${stage.stage}.md\u0000${stage.markdown.length}\u0000${stage.markdown}`)
          .join('\u0000'),
      );

    const loadUnlocked = Effect.gen(function*() {
      yield* recover;
      const stages = yield* Effect.all(stageNames.map((stage) => readStageState(stage)));
      yield* attempt(() => validateUniqueIds(stages));
      const revision = yield* revisionOf(stages);
      return { root, revision, stages } satisfies Loaded;
    });

    const writeTransaction = (writes: ReadonlyArray<PendingWrite>) =>
      Effect.gen(function*() {
        if (writes.length === 0) return;
        yield* fs.makeDirectory(absolute('.runtime'), { recursive: true });
        const journal: Journal = { version: 2, writes };
        const encoded = yield* Schema.encodeEffect(JournalFromJsonString)(journal);
        yield* fs.writeFileString(absolute(journalNextPath), encoded);
        yield* fs.rename(absolute(journalNextPath), absolute(journalPath));
        yield* applyJournal(journal);
      }).pipe(Effect.mapError(asRepositoryError));

    const mutate = (
      revision: string,
      change: (loaded: Loaded) => Effect.Effect<ReadonlyArray<PendingWrite>, RepositoryError>,
    ) =>
      withExclusiveAccess(
        Effect.gen(function*() {
          const loaded = yield* loadUnlocked;
          if (loaded.revision !== revision) {
            return yield* new RepositoryError({
              kind: 'conflict',
              message: 'Session changed on disk. Reload before saving.',
            });
          }
          yield* writeTransaction(yield* change(loaded));
          return toSession(yield* loadUnlocked);
        }),
      );

    const load = withExclusiveAccess(loadUnlocked.pipe(Effect.map((loaded) => toSession(loaded))));

    /** Layout rules that `load` tolerates but the files must not keep. */
    const check = withExclusiveAccess(
      Effect.gen(function*() {
        const loaded = yield* loadUnlocked;
        for (const state of loaded.stages) {
          const lines = lineCount(state.markdown);
          if (state.layout === 'file' && lines > stageFileLineLimit) {
            return yield* new RepositoryError({
              kind: 'validation',
              message:
                `${state.stage}.md has ${lines} lines, past the ${stageFileLineLimit}-line limit. Run \`session split ${state.stage}\`.`,
            });
          }
        }
        const hasGitignore = yield* fs.exists(absolute(gitignorePath)).pipe(
          Effect.mapError(asRepositoryError),
        );
        if (!hasGitignore) {
          return yield* new RepositoryError({
            kind: 'validation',
            message: 'Session is missing .gitignore. Run `session init`.',
          });
        }
        return toSession(loaded);
      }),
    );

    const putFile = (input: {
      readonly stage: Stage;
      readonly markdown: string;
      readonly revision: string;
    }) =>
      mutate(input.revision, (loaded) =>
        Effect.gen(function*() {
          const state = stageOf(loaded, input.stage);
          const nextItems = yield* attempt(() =>
            parseStageMarkdown(input.stage, input.markdown),
          );
          if (input.stage === 'EXECUTE') {
            const batches = new Map(state.items.map((item) => [item.id, item.batch]));
            const sameItems = state.items.length === nextItems.length &&
              nextItems.every((item) => batches.get(item.id) === item.batch);
            if (!sameItems) {
              return yield* new RepositoryError({
                kind: 'conflict',
                message: 'EXECUTE edits must preserve its item IDs and batches.',
              });
            }
          }
          yield* attempt(() =>
            validateUniqueIds(projected(loaded, [{ stage: input.stage, items: nextItems }])),
          );
          return yield* attempt(() => stageWrites(state, nextItems));
        }),
      );

    const addItem = (input: {
      readonly stage: Stage;
      readonly id?: string | undefined;
      readonly title: string;
      readonly body: string;
      readonly batch?: string | undefined;
      readonly revision: string;
    }) =>
      mutate(input.revision, (loaded) =>
        Effect.gen(function*() {
          if (input.stage === 'EXECUTE') {
            return yield* new RepositoryError({
              kind: 'conflict',
              message: 'EXECUTE is frozen; create items in another stage.',
            });
          }
          const state = stageOf(loaded, input.stage);
          const requested = input.batch?.trim();
          let batch: string | null = null;
          if (input.stage === 'QUEUE') {
            if (requested === undefined || requested === '') {
              return yield* new RepositoryError({
                kind: 'validation',
                message: 'A QUEUE item needs a batch. Pass the name of an existing batch.',
              });
            }
            if (!state.items.some((item) => item.batch === requested)) {
              return yield* new RepositoryError({
                kind: 'validation',
                message: `QUEUE has no batch named ${quote(requested)}.`,
              });
            }
            batch = requested;
          } else if (requested !== undefined && requested !== '') {
            return yield* new RepositoryError({
              kind: 'validation',
              message: `${input.stage} items do not belong to a batch.`,
            });
          }
          const id = input.id ??
            `W-${(yield* crypto.randomUUIDv4.pipe(Effect.mapError(asRepositoryError))).slice(0, 8)}`;
          const item = yield* attempt(() => {
            const candidate = makeItem({
              id,
              title: input.title.trim(),
              body: input.body,
              batch,
            });
            validateItem(input.stage, candidate);
            return candidate;
          });
          const items = yield* attempt(() => placeItem(input.stage, state.items, item, null));
          yield* attempt(() => validateUniqueIds(projected(loaded, [{ stage: input.stage, items }])));
          return yield* attempt(() => stageWrites(state, items));
        }),
      );

    const updateItem = (input: {
      readonly id: string;
      readonly title: string;
      readonly body: string;
      readonly revision: string;
    }) =>
      mutate(input.revision, (loaded) =>
        Effect.gen(function*() {
          const found = yield* attempt(() => findRequiredItem(loaded.stages, input.id));
          const state = stageOf(loaded, found.stage);
          const item = yield* attempt(() => {
            const candidate = makeItem({
              id: found.item.id,
              title: input.title.trim(),
              body: input.body,
              batch: found.item.batch,
            });
            validateItem(found.stage, candidate);
            return candidate;
          });
          const items = state.items.map((candidate) =>
            candidate.id === input.id ? item : candidate,
          );
          return yield* attempt(() => stageWrites(state, items));
        }),
      );

    const moveItem = (input: {
      readonly id: string;
      readonly to: Stage;
      readonly beforeId?: string | null | undefined;
      readonly batch?: string | undefined;
      readonly body?: string | undefined;
      readonly revision: string;
    }) =>
      mutate(input.revision, (loaded) =>
        Effect.gen(function*() {
          const found = yield* attempt(() => findRequiredItem(loaded.stages, input.id));
          if (input.to === 'EXECUTE') {
            return yield* new RepositoryError({
              kind: 'conflict',
              message: 'Items enter EXECUTE only through `session start`.',
            });
          }
          if (found.stage === 'EXECUTE') {
            return yield* new RepositoryError({
              kind: 'conflict',
              message: 'EXECUTE is frozen; complete its items instead of moving them.',
            });
          }

          const requested = input.batch?.trim();
          let batch: string | null = null;
          if (input.to === 'QUEUE') {
            const target = requested ?? found.item.batch ?? '';
            if (target === '') {
              return yield* new RepositoryError({
                kind: 'validation',
                message: 'Moving into QUEUE needs the name of an existing batch.',
              });
            }
            const queued = stageOf(loaded, 'QUEUE').items;
            if (!queued.some((item) => item.batch === target)) {
              return yield* new RepositoryError({
                kind: 'validation',
                message: `QUEUE has no batch named ${quote(target)}.`,
              });
            }
            batch = yield* attempt(() => validateBatchName('QUEUE', target));
          } else if (requested !== undefined && requested !== '') {
            return yield* new RepositoryError({
              kind: 'validation',
              message: `${input.to} items do not belong to a batch.`,
            });
          }

          const item = yield* attempt(() => {
            const candidate = makeItem({
              id: found.item.id,
              title: found.item.title,
              body: input.body ?? found.item.body,
              batch,
            });
            validateItem(input.to, candidate);
            return candidate;
          });

          const source = stageOf(loaded, found.stage);
          const remaining = source.items.filter((candidate) => candidate.id !== input.id);
          if (found.stage === input.to) {
            const beforeId = input.beforeId === input.id
              ? source.items[source.items.findIndex((entry) => entry.id === input.id) + 1]?.id ?? null
              : input.beforeId;
            const items = yield* attempt(() => placeItem(input.to, remaining, item, beforeId));
            return yield* attempt(() => stageWrites(source, items));
          }

          const target = stageOf(loaded, input.to);
          const items = yield* attempt(() =>
            placeItem(input.to, target.items, item, input.beforeId),
          );
          return yield* attempt(() => [
            ...stageWrites(source, remaining),
            ...stageWrites(target, items),
          ]);
        }),
      );

    const queueBatch = (input: {
      readonly name: string;
      readonly ids: ReadonlyArray<string>;
      readonly revision: string;
    }) =>
      mutate(input.revision, (loaded) =>
        Effect.gen(function*() {
          const name = yield* attempt(() => validateBatchName('QUEUE', input.name.trim()));
          if (input.ids.length === 0) {
            return yield* new RepositoryError({
              kind: 'validation',
              message: 'A batch needs at least one item.',
            });
          }
          const selectedIds = new Set(input.ids);
          if (selectedIds.size !== input.ids.length) {
            return yield* new RepositoryError({
              kind: 'validation',
              message: 'A batch cannot repeat an item ID.',
            });
          }
          const pool = stageOf(loaded, 'BATCH');
          const queue = stageOf(loaded, 'QUEUE');
          if (queue.items.some((item) => item.batch === name)) {
            return yield* new RepositoryError({
              kind: 'validation',
              message: `QUEUE already has a batch named ${quote(name)}.`,
            });
          }
          const available = new Map(pool.items.map((item) => [item.id, item]));
          const selected = yield* attempt(() =>
            input.ids.map((id) => {
              const item = available.get(id) ?? fail(`${id} is not in BATCH.`);
              const queued = { ...item, batch: name };
              validateItem('QUEUE', queued);
              return queued;
            }),
          );
          return yield* attempt(() => [
            ...stageWrites(pool, pool.items.filter((item) => !selectedIds.has(item.id))),
            ...stageWrites(queue, [...queue.items, ...selected]),
          ]);
        }),
      );

    const startBatch = (input: { readonly revision: string }) =>
      mutate(input.revision, (loaded) =>
        Effect.gen(function*() {
          const queue = stageOf(loaded, 'QUEUE');
          const execute = stageOf(loaded, 'EXECUTE');
          if (execute.items.length > 0) {
            return yield* new RepositoryError({
              kind: 'conflict',
              message: 'Complete the current EXECUTE batch first.',
            });
          }
          const first = queue.items[0];
          if (first === undefined) {
            return yield* new RepositoryError({
              kind: 'validation',
              message: 'QUEUE is empty; queue a batch first.',
            });
          }
          const name = first.batch;
          return yield* attempt(() => [
            ...stageWrites(queue, queue.items.filter((item) => item.batch !== name)),
            ...stageWrites(execute, queue.items.filter((item) => item.batch === name)),
          ]);
        }),
      );

    const completeItem = (input: { readonly id: string; readonly revision: string }) =>
      mutate(input.revision, (loaded) =>
        Effect.gen(function*() {
          const found = yield* attempt(() => findRequiredItem(loaded.stages, input.id));
          if (found.stage !== 'EXECUTE') {
            return yield* new RepositoryError({
              kind: 'conflict',
              message: `Item ${input.id} is not in EXECUTE.`,
            });
          }
          const execute = stageOf(loaded, 'EXECUTE');
          const batch = found.item.batch;
          if (batch === null) {
            return yield* new RepositoryError({
              kind: 'validation',
              message: `EXECUTE/${input.id} has no batch.`,
            });
          }
          const beforeArchive = yield* readMaybe(archivePath);
          const record = `# ${batch}\n\n${renderItem(found.item)}\n`;
          const afterArchive = beforeArchive === null || beforeArchive === ''
            ? record
            : `${beforeArchive.trimEnd()}\n\n${record}`;
          const writes = yield* attempt(() =>
            stageWrites(execute, execute.items.filter((item) => item.id !== input.id)),
          );
          return [...writes, { path: archivePath, before: beforeArchive, after: afterArchive }];
        }),
      );

    const split = (input: { readonly stage: Stage; readonly revision: string }) =>
      mutate(input.revision, (loaded) =>
        Effect.gen(function*() {
          const state = stageOf(loaded, input.stage);
          if (state.layout === 'directory') {
            return yield* new RepositoryError({
              kind: 'validation',
              message: `${input.stage} is already a directory.`,
            });
          }
          return yield* attempt(() => stageWrites(state, state.items, { directory: true }));
        }),
      );

    const inventory = withExclusiveAccess(
      Effect.gen(function*() {
        yield* loadUnlocked;
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
              Effect.map((entries) => entries.toSorted()),
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
      check,
      putFile,
      addItem,
      updateItem,
      moveItem,
      queueBatch,
      startBatch,
      completeItem,
      split,
      inventory,
      readMarkdownFile,
    } as const;
  });

export type SessionRepository = Effect.Success<ReturnType<typeof makeRepository>>;
