import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import * as Crypto from 'effect/Crypto';
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import * as FileSystem from 'effect/FileSystem';
import * as Option from 'effect/Option';
import * as Semaphore from 'effect/Semaphore';
import type { Item, Session, Stage, StageFile } from '../contract.ts';
import { isBatchedStage, stageNames } from '../contract.ts';
import {
  archiveDay,
  archiveDirectory,
  archiveFilePath,
  archivedItemId,
  closedByCommitNote,
  commitsThatClosed,
  parseStageDirectory,
  renderStageDirectory,
  type StageFileEntry,
  type StageTreeEntry,
} from './layout.ts';
import {
  fail,
  findRequiredItem,
  type ItemDraft,
  makeItem,
  quote,
  SessionError,
  validateItem,
  validateItemSections,
  validateUniqueIds,
} from './model.ts';

/* eslint-disable max-lines, max-lines-per-function -- The repository is one serialized transaction boundary; splitting its closures would obscure the invariants they share. */

const encoder = new TextEncoder();
const gitignorePath = '.gitignore';
const gitignoreContent = '*\n';

export type FileInventory = Record<string, string>;

/** What one commit says it finished. */
export type CommitClaim = {
  readonly hash: string;
  readonly subject: string;
  readonly ids: ReadonlyArray<string>;
};

/**
 * What became of one id a commit named. `honoured` covers an item filed now, an
 * item already filed, and an item a person brought back after this commit
 * filed it; none of those is anything to report.
 */
export type CommitOutcome =
  | { readonly kind: 'honoured' }
  | { readonly kind: 'unknown' }
  | { readonly kind: 'failed'; readonly message: string };

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

/** One file to write, or to delete when `content` is null. */
type FileChange = {
  readonly path: string;
  readonly content: string | null;
};

/** A stage plus the files that carry it, so a mutation can diff them. */
type StageState = {
  readonly stage: Stage;
  readonly path: string;
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
  path: state.path,
  items: state.items,
});

const toSession = (loaded: Loaded): Session => ({
  directory: loaded.root,
  revision: loaded.revision,
  stages: loaded.stages.map(toStageFile),
});

const stageOf = (loaded: Loaded, stage: Stage): StageState =>
  loaded.stages.find((entry) => entry.stage === stage)!;

const draftOf = (item: ItemDraft, batch: string | null): ItemDraft => ({
  id: item.id,
  title: item.title,
  body: item.body,
  summary: item.summary,
  batch,
});

const projected = (
  loaded: Loaded,
  updates: ReadonlyArray<{ readonly stage: Stage; readonly items: ReadonlyArray<ItemDraft> }>,
) =>
  loaded.stages.map((state) => ({
    stage: state.stage,
    items: updates.find((update) => update.stage === state.stage)?.items ?? state.items,
  }));

/** The files a mutation must write or remove to reach `desired`. */
const diffFiles = (
  current: ReadonlyArray<StageFileEntry>,
  desired: ReadonlyArray<StageFileEntry>,
): FileChange[] => {
  const currentByPath = new Map(current.map((entry) => [entry.path, entry.content] as const));
  const desiredPaths = new Set(desired.map((entry) => entry.path));
  const changes: FileChange[] = [];
  for (const entry of desired) {
    if (currentByPath.get(entry.path) !== entry.content) {
      changes.push({ path: entry.path, content: entry.content });
    }
  }
  for (const entry of current) {
    if (!desiredPaths.has(entry.path)) changes.push({ path: entry.path, content: null });
  }
  return changes;
};

const stageChanges = (state: StageState, items: ReadonlyArray<ItemDraft>): FileChange[] =>
  diffFiles(
    state.files,
    renderStageDirectory({ stage: state.stage, items, current: state.files }),
  );

const placeItem = (
  stage: Stage,
  items: ReadonlyArray<ItemDraft>,
  item: ItemDraft,
  beforeId: string | null | undefined,
): ItemDraft[] => {
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
    .some((segment) => segment === 'ignore' || segment === archiveDirectory);

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

    /**
     * Write through a dot-prefixed neighbour, which the directory parser
     * ignores, then rename inside the same directory so the swap is atomic.
     */
    const atomicWrite = (relativePath: string, content: string) =>
      Effect.gen(function*() {
        const target = absolute(relativePath);
        const parent = dirname(target);
        yield* fs.makeDirectory(parent, { recursive: true });
        const temp = join(parent, `.${basename(target)}.tmp`);
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

    /**
     * Writes land before deletes. A crash between them leaves an item in two
     * places, which `check` reports as a duplicate ID and the user resolves by
     * deleting one file; the reverse order would lose the item.
     */
    const applyChanges = (changes: ReadonlyArray<FileChange>) =>
      Effect.gen(function*() {
        if (changes.length === 0) return;
        for (const change of changes) {
          if (change.content !== null) yield* atomicWrite(change.path, change.content);
        }
        for (const change of changes) {
          if (change.content === null) yield* removeFile(change.path);
        }
        yield* pruneEmptyDirectories;
      });

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
        if (directoryType !== 'Directory') {
          return yield* new RepositoryError({
            kind: 'not-found',
            message: fileType === null
              ? `Session is missing ${stage}/. Run any session command to create it.`
              : `Session is missing ${stage}/. Run any session command to create it, then fold ${stage}.md into it by hand.`,
          });
        }
        const tree = yield* readStageTree(directoryPath);
        const parsed = yield* attempt(() => parseStageDirectory(stage, tree));
        return {
          stage,
          path: directoryPath,
          items: parsed.items,
          files: parsed.files,
        } satisfies StageState;
      }).pipe(Effect.mapError(asRepositoryError));

    const readMarkdownFile = (relativePath: string) =>
      Effect.gen(function*() {
        const segments = relativePath.split(/[\\/]/u);
        if (
          !relativePath.endsWith('.md') ||
          relativePath.startsWith('/') ||
          segments.some(
            (segment) =>
              segment === '' ||
              segment === '.' ||
              segment === '..' ||
              segment === 'ignore' ||
              segment === archiveDirectory,
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

    /** Every item file's path and content, in listing order. */
    const revisionOf = (stages: ReadonlyArray<StageState>) =>
      digest(
        stages
          .flatMap((state) =>
            state.files.map((file) => `${file.path}\u0000${file.content.length}\u0000${file.content}`)
          )
          .join('\u0000'),
      );

    const loadUnlocked = Effect.gen(function*() {
      const stages = yield* Effect.all(stageNames.map((stage) => readStageState(stage)));
      yield* attempt(() => validateUniqueIds(stages));
      const revision = yield* revisionOf(stages);
      return { root, revision, stages } satisfies Loaded;
    });

    const mutate = (
      revision: string,
      change: (loaded: Loaded) => Effect.Effect<ReadonlyArray<FileChange>, RepositoryError>,
    ) =>
      semaphore.withPermit(
        Effect.gen(function*() {
          const loaded = yield* loadUnlocked;
          if (loaded.revision !== revision) {
            return yield* new RepositoryError({
              kind: 'conflict',
              message: 'Session changed on disk. Reload before saving.',
            });
          }
          yield* applyChanges(yield* change(loaded));
          return toSession(yield* loadUnlocked);
        }),
      );

    const load = semaphore.withPermit(loadUnlocked.pipe(Effect.map((loaded) => toSession(loaded))));

    /**
     * A link into a store that was never created is litter. A link that leads
     * somewhere is somebody else's directory, and nothing operates through it.
     */
    const sessionLink = Effect.gen(function*() {
      const link = yield* fs.readLink(root).pipe(Effect.option);
      if (Option.isNone(link)) return 'directory' as const;
      // `exists` follows the link, so a dead one answers false.
      return (yield* fs.exists(root)) ? ('live' as const) : ('dangling' as const);
    }).pipe(Effect.mapError(asRepositoryError));

    const symlinkRefusal = new RepositoryError({
      kind: 'validation',
      message:
        `${root} is a symlink; replace it with a real directory (the sweep does this), then retry.`,
    });

    /** What `load` reads past: leftover stage files, and self-ignoring. */
    const check = semaphore.withPermit(
      Effect.gen(function*() {
        if ((yield* sessionLink) !== 'directory') return yield* symlinkRefusal;
        const loaded = yield* loadUnlocked;
        for (const stage of stageNames) {
          const leftover = yield* pathType(absolute(`${stage}.md`)).pipe(
            Effect.mapError(asRepositoryError),
          );
          if (leftover !== null) {
            return yield* new RepositoryError({
              kind: 'validation',
              message: `${stage}.md is a leftover stage file; fold it into ${stage}/ by hand.`,
            });
          }
        }
        const hasGitignore = yield* fs.exists(absolute(gitignorePath)).pipe(
          Effect.mapError(asRepositoryError),
        );
        if (!hasGitignore) {
          return yield* new RepositoryError({
            kind: 'validation',
            message: 'Session is missing .gitignore. Run any session command to write it.',
          });
        }
        yield* attempt(() => {
          for (const state of loaded.stages) {
            for (const item of state.items) validateItemSections(state.stage, item);
          }
        });
        return toSession(loaded);
      }),
    );

    const addItem = (input: {
      readonly stage: Stage;
      readonly id: string;
      readonly title: string;
      readonly body: string;
      readonly revision: string;
    }) =>
      mutate(input.revision, (loaded) =>
        Effect.gen(function*() {
          if (isBatchedStage(input.stage)) {
            return yield* new RepositoryError({
              kind: 'conflict',
              message: input.stage === 'QUEUE'
                ? 'Items enter QUEUE only through `session batch`.'
                : 'EXECUTE is frozen; create items in another stage.',
            });
          }
          const state = stageOf(loaded, input.stage);
          const item = yield* attempt(() => {
            const candidate = makeItem({
              id: input.id,
              title: input.title.trim(),
              body: input.body,
              batch: null,
            });
            validateItem(input.stage, candidate);
            validateItemSections(input.stage, candidate);
            return candidate;
          });
          const items = yield* attempt(() => placeItem(input.stage, state.items, item, null));
          yield* attempt(() => validateUniqueIds(projected(loaded, [{ stage: input.stage, items }])));
          return yield* attempt(() => stageChanges(state, items));
        }),
      );

    const moveItem = (input: {
      readonly id: string;
      readonly to: Stage;
      readonly beforeId?: string | null | undefined;
      readonly revision: string;
    }) =>
      mutate(input.revision, (loaded) =>
        Effect.gen(function*() {
          const found = yield* attempt(() => findRequiredItem(loaded.stages, input.id));
          if (found.stage === 'EXECUTE') {
            return yield* new RepositoryError({
              kind: 'conflict',
              message: 'EXECUTE is frozen; complete its items instead of moving them.',
            });
          }
          if (input.to === 'EXECUTE') {
            return yield* new RepositoryError({
              kind: 'conflict',
              message: 'Items enter EXECUTE only through `session start`.',
            });
          }
          if (input.to === 'QUEUE' && found.stage !== 'QUEUE') {
            return yield* new RepositoryError({
              kind: 'conflict',
              message: 'Items enter QUEUE only through `session batch`.',
            });
          }

          // Inside QUEUE an item keeps its batch and only changes place in it.
          const item = draftOf(found.item, input.to === 'QUEUE' ? found.item.batch : null);
          yield* attempt(() => {
            validateItem(input.to, item);
            validateItemSections(input.to, item);
          });

          const source = stageOf(loaded, found.stage);
          const remaining = source.items.filter((candidate) => candidate.id !== input.id);
          if (found.stage === input.to) {
            const beforeId = input.beforeId === input.id
              ? source.items[source.items.findIndex((entry) => entry.id === input.id) + 1]?.id ?? null
              : input.beforeId;
            const items = yield* attempt(() => placeItem(input.to, remaining, item, beforeId));
            return yield* attempt(() => stageChanges(source, items));
          }

          const target = stageOf(loaded, input.to);
          const items = yield* attempt(() =>
            placeItem(input.to, target.items, item, input.beforeId),
          );
          return yield* attempt(() => [
            ...stageChanges(source, remaining),
            ...stageChanges(target, items),
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
          const name = input.name.trim();
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
              const queued = draftOf(item, name);
              validateItem('QUEUE', queued);
              validateItemSections('QUEUE', queued);
              return queued;
            }),
          );
          return yield* attempt(() => [
            ...stageChanges(pool, pool.items.filter((item) => !selectedIds.has(item.id))),
            ...stageChanges(queue, [...queue.items, ...selected]),
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
          const starting: ItemDraft[] = [];
          const waiting: ItemDraft[] = [];
          for (const item of queue.items) {
            if (item.batch === name) starting.push(draftOf(item, name));
            else waiting.push(item);
          }
          return yield* attempt(() => {
            for (const item of starting) validateItemSections('EXECUTE', item);
            return [...stageChanges(queue, waiting), ...stageChanges(execute, starting)];
          });
        }),
      );

    /**
     * Move one item out of the board and into `archive/`, under a name that
     * reads on its own: the day, the item, and the state it left from.
     */
    const fileAway = (input: {
      readonly id: string;
      readonly state: string;
      readonly loaded: Loaded;
      readonly from: Stage;
      /** Appended to the archived record: why it was filed, when that is not obvious. */
      readonly note?: string;
    }) =>
      Effect.gen(function*() {
        const state = stageOf(input.loaded, input.from);
        const item = state.items.find((candidate) => candidate.id === input.id)!;
        const held = state.files.find((file) => file.path === item.path);
        if (held === undefined) {
          return yield* new RepositoryError({
            kind: 'not-found',
            message: `${item.path} is no longer on disk.`,
          });
        }
        const path = archiveFilePath({
          day: yield* archiveDay,
          id: item.id,
          title: item.title,
          state: input.state,
        });
        const taken = yield* pathType(absolute(path)).pipe(Effect.mapError(asRepositoryError));
        if (taken !== null) {
          return yield* new RepositoryError({
            kind: 'conflict',
            message: `${path} already exists. Move it aside first.`,
          });
        }
        const changes = yield* attempt(() =>
          stageChanges(state, state.items.filter((candidate) => candidate.id !== input.id)),
        );
        const content = input.note === undefined
          ? held.content
          : `${held.content.trimEnd()}\n\n${input.note}\n`;
        return [{ path, content }, ...changes];
      });

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
          return yield* fileAway({ id: input.id, state: 'done', loaded, from: 'EXECUTE' });
        }),
      );

    /** The archived records, by the item each belongs to; names that were not filed here are skipped. */
    const archivedRecords = Effect.gen(function*() {
      const archive = absolute(archiveDirectory);
      if ((yield* pathType(archive)) !== 'Directory') return [];
      const records: Array<{ readonly id: string; readonly path: string }> = [];
      for (const name of yield* fs.readDirectory(archive)) {
        const id = archivedItemId(name);
        if (id !== null) records.push({ id, path: join(archiveDirectory, name) });
      }
      return records;
    }).pipe(Effect.mapError(asRepositoryError));

    /** The commits the archived records of one item say closed it. */
    const archivedClosings = (
      records: ReadonlyArray<{ readonly id: string; readonly path: string }>,
      id: string,
    ) =>
      Effect.gen(function*() {
        const hashes = new Set<string>();
        for (const record of records) {
          if (record.id !== id) continue;
          const content = yield* fs.readFileString(absolute(record.path));
          for (const hash of commitsThatClosed(content)) hashes.add(hash);
        }
        return hashes;
      }).pipe(Effect.mapError(asRepositoryError));

    /**
     * Honour what commits say they finished, oldest commit first, deciding
     * each one on what the files say under the session's own lock. An open item
     * is filed as done from whichever stage it is in, because the commit is the
     * evidence of completion and the route through Execute that `completeItem`
     * insists on does not apply; the item's text gains the commit's note, which
     * is what says afterwards why it left. An item whose text or archived
     * record already carries that note was filed by this commit before and has
     * been brought back by a person, so it is left where it is.
     *
     * One read serves a pass that closes nothing, which is almost every pass.
     */
    const closeFromCommits = (claims: ReadonlyArray<CommitClaim>) =>
      semaphore.withPermit(
        Effect.gen(function*() {
          let loaded = yield* loadUnlocked;
          let archived = yield* archivedRecords;
          const outcomes: Array<{ readonly claim: CommitClaim; readonly id: string; readonly outcome: CommitOutcome }> =
            [];
          const decide = (claim: CommitClaim, id: string) =>
            Effect.gen(function*() {
              const found = yield* attempt(() => findRequiredItem(loaded.stages, id)).pipe(Effect.option);
              if (Option.isNone(found)) {
                return archived.some((record) => record.id === id)
                  ? ({ kind: 'honoured' } as const)
                  : ({ kind: 'unknown' } as const);
              }
              const { item, stage } = found.value;
              if (commitsThatClosed(item.body).has(claim.hash)) return { kind: 'honoured' } as const;
              if ((yield* archivedClosings(archived, id)).has(claim.hash)) return { kind: 'honoured' } as const;
              const outcome = yield* fileAway({ id, state: 'done', loaded, from: stage, note: closedByCommitNote(claim) })
                .pipe(
                  Effect.flatMap((changes) => applyChanges(changes).pipe(Effect.mapError(asRepositoryError))),
                  Effect.match({
                    onFailure: (error): CommitOutcome => ({ kind: 'failed', message: error.message }),
                    onSuccess: (): CommitOutcome => ({ kind: 'honoured' }),
                  }),
                );
              loaded = yield* loadUnlocked;
              archived = yield* archivedRecords;
              return outcome;
            });
          for (const claim of claims) {
            for (const id of claim.ids) outcomes.push({ claim, id, outcome: yield* decide(claim, id) });
          }
          return outcomes;
        }),
      );

    /** Any stage, including EXECUTE, where it means the batch gave the item up. */
    const archiveItem = (input: { readonly id: string; readonly revision: string }) =>
      mutate(input.revision, (loaded) =>
        Effect.gen(function*() {
          const found = yield* attempt(() => findRequiredItem(loaded.stages, input.id));
          return yield* fileAway({
            id: input.id,
            state: found.stage.toLowerCase(),
            loaded,
            from: found.stage,
          });
        }),
      );

    /** Scaffolds what is missing. It never converts an older session. */
    const initialize = Effect.gen(function*() {
      const actions: string[] = [];
      const link = yield* sessionLink;
      if (link === 'live') return yield* symlinkRefusal;
      if (link === 'dangling') {
        // `remove` unlinks the link itself; nothing it pointed at ever existed.
        yield* fs.remove(root).pipe(Effect.mapError(asRepositoryError));
        actions.push(`Removed the dangling link ${root}`);
      }
      if ((yield* pathType(root).pipe(Effect.mapError(asRepositoryError))) === null) {
        actions.push(`Created ${root}`);
      }
      yield* fs.makeDirectory(root, { recursive: true }).pipe(Effect.mapError(asRepositoryError));
      const created: Stage[] = [];
      for (const stage of stageNames) {
        const directoryPath = absolute(stage);
        if ((yield* pathType(directoryPath).pipe(Effect.mapError(asRepositoryError))) === null) {
          created.push(stage);
        }
        yield* fs.makeDirectory(directoryPath, { recursive: true }).pipe(
          Effect.mapError(asRepositoryError),
        );
      }
      if (created.length > 0) {
        actions.push(`Created ${created.map((stage) => `${stage}/`).join(' ')}`);
      }
      const hasGitignore = yield* fs.exists(absolute(gitignorePath)).pipe(
        Effect.mapError(asRepositoryError),
      );
      if (!hasGitignore) {
        yield* atomicWrite(gitignorePath, gitignoreContent);
        actions.push(`Wrote ${gitignorePath}`);
      }
      return actions;
    });

    /** The newest item file's mtime, for the index. Null when nothing is filed. */
    const lastChange = semaphore.withPermit(
      Effect.gen(function*() {
        let newest: Date | undefined;
        const consider = (mtime: Option.Option<Date>) => {
          if (Option.isNone(mtime)) return;
          if (newest === undefined || mtime.value > newest) newest = mtime.value;
        };
        for (const stage of stageNames) {
          const stageDirectory = absolute(stage);
          if ((yield* pathType(stageDirectory)) !== 'Directory') continue;
          for (const name of yield* fs.readDirectory(stageDirectory)) {
            if (name.startsWith('.')) continue;
            const child = join(stageDirectory, name);
            const info = yield* fs.stat(child);
            if (info.type !== 'Directory') {
              consider(info.mtime);
              continue;
            }
            for (const innerName of yield* fs.readDirectory(child)) {
              if (innerName.startsWith('.')) continue;
              consider((yield* fs.stat(join(child, innerName))).mtime);
            }
          }
        }
        return newest?.toISOString() ?? null;
      }).pipe(Effect.mapError(asRepositoryError)),
    );

    const inventory = semaphore.withPermit(
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
              if (name === 'ignore' || name === archiveDirectory) continue;
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
      addItem,
      moveItem,
      queueBatch,
      startBatch,
      completeItem,
      archiveItem,
      closeFromCommits,
      inventory,
      lastChange,
      readMarkdownFile,
    } as const;
  });

export type SessionRepository = Effect.Success<ReturnType<typeof makeRepository>>;
