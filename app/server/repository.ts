import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import * as Crypto from 'effect/Crypto';
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import * as FileSystem from 'effect/FileSystem';
import * as Option from 'effect/Option';
import * as Semaphore from 'effect/Semaphore';
import type {
  ArchiveListing,
  ArchiveRecord,
  ContextEntry,
  ContextListing,
  Item,
  LedgerEntry,
  LedgerListing,
  Session,
  Stage,
  StageFile,
} from '../contract.ts';
import { isBatchedStage, rulesFile, stageDirectory, stageNames } from '../contract.ts';
import { archiveDay, archiveFilePath, closedByCommitNote, commitsThatClosed, parseArchiveName } from './archive.ts';
import {
  archiveDirectory,
  contextDirectory,
  entryName,
  ignoreDirectory,
  ledgerDirectory,
  metaDirectory,
  parseStageDirectory,
  renderStageDirectory,
  type StageFileEntry,
  type StageTreeEntry,
} from './layout.ts';
import {
  type LedgerParse,
  type LedgerProblem,
  ledgerFileName,
  ledgerNow,
  parseLedgerEntry,
  renderLedgerEntry,
} from './ledger.ts';
import {
  fail,
  findRequiredItem,
  groupNoun,
  type ItemDraft,
  makeItem,
  quote,
  SessionError,
  validateGroupName,
  validateItem,
  validateItemSections,
  validateUniqueIds,
} from './model.ts';
import { leftoverStageFile, metaEntryProblem, misnamedStages, rootEntryProblem } from './root.ts';

/* eslint-disable max-lines, max-lines-per-function -- The repository is one serialized transaction boundary; splitting its closures would obscure the invariants they share. */

const encoder = new TextEncoder();
const gitignorePath = '.gitignore';
const gitignoreContent = '*\n';

export type FileInventory = Record<string, string>;

/** An entry a refresh could not take into the inventory, and why. */
export type SkippedEntry = {
  readonly path: string;
  readonly reason: string;
};

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
  readonly rules: boolean;
};

const toStageFile = (state: StageState): StageFile => ({
  stage: state.stage,
  path: state.path,
  items: state.items,
});

/** The items a group verb names, each where it is, refused when the list is empty or repeats one. */
const namedItems = (loaded: Loaded, ids: ReadonlyArray<string>, noun: string) =>
  attempt(() => {
    if (ids.length === 0) fail(`${noun} needs at least one item.`);
    if (new Set(ids).size !== ids.length) fail(`${noun} cannot repeat an item ID.`);
    return ids.map((id) => findRequiredItem(loaded.stages, id));
  });

const toSession = (loaded: Loaded): Session => ({
  directory: loaded.root,
  revision: loaded.revision,
  stages: loaded.stages.map(toStageFile),
  rules: loaded.rules,
});

const stageOf = (loaded: Loaded, stage: Stage): StageState =>
  loaded.stages.find((entry) => entry.stage === stage)!;

const draftOf = (item: ItemDraft, group: string | null): ItemDraft => ({
  id: item.id,
  title: item.title,
  body: item.body,
  summary: item.summary,
  group,
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

/** Where an item sits in a stage, as a refusal names it. */
const placeName = (stage: Stage, group: string | null): string =>
  group === null ? `no ${groupNoun(stage)}` : `the ${groupNoun(stage)} ${quote(group)}`;

/**
 * An item placed among a stage's other items, in file order, in the group its
 * draft names, or in none. `beforeId` names the item it goes in front of,
 * which must sit in the same group, or in none for an item in none, so a group
 * is never split. `beforeGroup` names a group that an item in no group goes in
 * front of instead: a group is an entry of the stage beside its items, so the
 * item goes just before the group's first item. Without either the item goes
 * at the end of its group, and an item in no group at the end of the stage. A
 * group the other items do not hold starts at `start`: the end of the stage,
 * unless the caller keeps the place of a group it has just emptied, which is
 * also where an item goes in front of the group it alone held.
 */
const placeItem = (input: {
  readonly stage: Stage;
  readonly items: ReadonlyArray<ItemDraft>;
  readonly item: ItemDraft;
  readonly beforeId?: string | null | undefined;
  readonly beforeGroup?: string | null | undefined;
  readonly start?: number | undefined;
}): ItemDraft[] => {
  const { stage, items, item, beforeId, beforeGroup } = input;
  const { group } = item;
  const insertAt = (index: number) => [...items.slice(0, index), item, ...items.slice(index)];

  if (beforeGroup !== undefined && beforeGroup !== null) {
    const first = items.findIndex((candidate) => candidate.group === beforeGroup);
    if (first !== -1) return insertAt(first);
    return input.start === undefined ? fail(`${stage} has no group ${quote(beforeGroup)}.`) : insertAt(input.start);
  }

  if (beforeId === undefined || beforeId === null) {
    if (group === null) return [...items, item];
    const first = items.findIndex((candidate) => candidate.group === group);
    if (first === -1) return insertAt(input.start ?? items.length);
    let end = first;
    while (end < items.length && items[end]!.group === group) end += 1;
    return insertAt(end);
  }

  const index = items.findIndex((candidate) => candidate.id === beforeId);
  const neighbour = items[index] ?? fail(`${stageDirectory(stage)}: cannot place ${item.id} before ${beforeId}, which is not in ${stage}.`);
  if (neighbour.group !== group) {
    fail(
      `${stageDirectory(stage)}: cannot place ${item.id} before ${beforeId}; ${item.id} goes in ${placeName(stage, group)} and ${beforeId} is in ${placeName(stage, neighbour.group)}.`,
    );
  }
  return insertAt(index);
};

const isInsideRoot = (realRoot: string, candidate: string): boolean =>
  candidate === realRoot || candidate.startsWith(`${realRoot}${sep}`);

const ensureInsideRoot = (realRoot: string, candidate: string, relativePath: string) => {
  if (!isInsideRoot(realRoot, candidate)) {
    throw new SessionError({
      kind: 'validation',
      message: `${relativePath} resolves outside the session directory.`,
    });
  }
};

/** Whether a resolved path inside the session lies under one of these directories of the root. */
const liesUnder = (realRoot: string, candidate: string, names: ReadonlySet<string>): boolean =>
  names.has(relative(realRoot, candidate).split(sep)[0] ?? '');

/*
 * `archive` and `ignore` are names of the root only. A directory called either
 * further down, such as `context/SES-1/archive/`, is an ordinary directory:
 * refresh reads it, the board lists it, and the files route serves it.
 */

/** The root's directory the files route never serves. */
const unserved: ReadonlySet<string> = new Set([ignoreDirectory]);

/** The root's directories a refresh leaves out of agent context, and the board's context listing with it. */
const outOfContext: ReadonlySet<string> = new Set([ignoreDirectory, archiveDirectory]);

/** A modification time as the contract writes times, or null when the platform gave none. */
const writtenAtOf = (info: FileSystem.File.Info): string | null =>
  Option.match(info.mtime, { onNone: () => null, onSome: (mtime) => mtime.toISOString() });

/** A file name has room for this many bytes on the file systems a session lives on. */
const fileNameBytes = 255;

/** Why an entry whose real path cannot be had is left out: it is a link that leads nowhere, or it cannot be read. */
type Unresolved = 'is a link that leads nowhere' | 'could not be read';

/** A file of `ledger/` read by the ledger's rules: an entry, or the rule it breaks. */
type LedgerRead = LedgerParse;

/** A ledger problem as `check` states it: the file, the line that shows it when there is one, and the rule. */
const problemAt = (path: string, problem: LedgerProblem): string =>
  `${path}${problem.line === null ? '' : `:${problem.line}`}: ${problem.text}`;

/** Newest first, then by name, as every listing of dated records is ordered. */
const byDateThenName = (
  left: { readonly date: string | null; readonly name: string },
  right: { readonly date: string | null; readonly name: string },
): number => {
  if (left.date !== right.date) {
    if (left.date === null) return 1;
    if (right.date === null) return -1;
    return left.date < right.date ? 1 : -1;
  }
  if (left.name === right.name) return 0;
  return left.name < right.name ? -1 : 1;
};

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

    /** Whether a path is itself a link, whatever it leads to. */
    const isLink = (path: string) =>
      fs.readLink(path).pipe(Effect.match({ onFailure: () => false, onSuccess: () => true }));

    /** An entry's kind as the layout's rules name kinds: a link that leads nowhere has none, and is `other`. */
    const entryType = (path: string) =>
      fs.stat(path).pipe(
        Effect.option,
        Effect.map((info): 'directory' | 'file' | 'other' => {
          if (Option.isNone(info)) return 'other';
          if (info.value.type === 'Directory') return 'directory';
          return info.value.type === 'File' ? 'file' : 'other';
        }),
      );

    /** Why a path's real location could not be had: a link can be read even when what it names cannot. */
    const unresolvedReason = (path: string) =>
      fs.readLink(path).pipe(
        Effect.match({
          onFailure: (): Unresolved => 'could not be read',
          onSuccess: (): Unresolved => 'is a link that leads nowhere',
        }),
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

    /** Whether a directory holds anything a reader sees: an entry whose name does not start with a dot. */
    const holdsVisibleEntry = (path: string) =>
      fs.readDirectory(path).pipe(Effect.map((names) => names.some((name) => !name.startsWith('.'))));

    /**
     * A stage directory keeps itself; the group directories it empties do not.
     * Every reader skips an entry whose name starts with a dot, so a group
     * directory holding only such entries, like Finder's `.DS_Store`, holds
     * nothing and goes with them. Readers pass over such a directory too, so
     * one left behind by a write interrupted before this ran fails nothing
     * until the next write removes it. A directory whose own name starts with
     * a dot is no group, and is left alone as every reader leaves it.
     */
    const pruneEmptyDirectories = Effect.gen(function*() {
      for (const stage of stageNames) {
        const stagePath = absolute(stageDirectory(stage));
        if ((yield* pathType(stagePath)) !== 'Directory') continue;
        for (const name of yield* fs.readDirectory(stagePath)) {
          if (name.startsWith('.')) continue;
          const child = join(stagePath, name);
          if ((yield* pathType(child)) !== 'Directory') continue;
          if (!(yield* holdsVisibleEntry(child))) yield* fs.remove(child, { recursive: true });
        }
      }
    }).pipe(
      Effect.mapError(
        (cause) =>
          new RepositoryError({
            kind: 'io',
            message: 'Could not remove an emptied group directory.',
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

    const readStageTree = (stagePath: string) =>
      Effect.gen(function*() {
        const entries: StageTreeEntry[] = [];
        for (const name of (yield* fs.readDirectory(stagePath)).toSorted()) {
          if (name.startsWith('.')) continue;
          const child = join(stagePath, name);
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

    /** The names in the session root, sorted, and none while there is no root. */
    const rootNames = Effect.gen(function*() {
      if ((yield* pathType(root)) !== 'Directory') return [];
      return (yield* fs.readDirectory(root)).toSorted();
    });

    /**
     * A directory of the root that holds a stage under another name, such as
     * `TRIAGE/` from before the stages were numbered, stops the session with
     * the first one's fix, whether or not the stage's own directory is there
     * too: a load would read past it and miss its items, and scaffolding the
     * stage's directory beside it would split the stage in two.
     */
    const refuseMisnamedStage = Effect.gen(function*() {
      for (const { name, problem } of misnamedStages(yield* rootNames)) {
        if ((yield* pathType(absolute(name))) !== 'Directory') continue;
        return yield* new RepositoryError({ kind: 'validation', message: problem });
      }
    }).pipe(Effect.mapError(asRepositoryError));

    const readStageState = (stage: Stage) =>
      Effect.gen(function*() {
        const expected = stageDirectory(stage);
        const leftover = leftoverStageFile(stage);
        const directoryPath = absolute(expected);
        const [fileType, directoryType] = yield* Effect.all([
          pathType(absolute(leftover)),
          pathType(directoryPath),
        ]);
        // Anything else under the stage's name, a link to nothing included,
        // breaks the root's kind rule, which scaffolding cannot mend.
        if (directoryType !== 'Directory' && (directoryType !== null || (yield* isLink(directoryPath)))) {
          const type = yield* entryType(directoryPath);
          return yield* new RepositoryError({
            kind: 'validation',
            message: rootEntryProblem({ name: expected, type }, new Set([expected])) ?? `${expected} must be a directory.`,
          });
        }
        if (directoryType !== 'Directory') {
          return yield* new RepositoryError({
            kind: 'not-found',
            message: fileType === null
              ? `Session is missing ${expected}/. Run any session command to create it.`
              : `Session is missing ${expected}/. Run any session command to create it, then fold ${leftover} into it by hand.`,
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

    /**
     * Where a regular file under the session really is, for the board's files
     * route to send: Markdown, images, and everything else. The root's
     * `ignore/` is refused, both as written and where a link resolves to, and
     * so is anything that resolves outside the session.
     */
    const servedFile = (relativePath: string) =>
      Effect.gen(function*() {
        const segments = relativePath.split(/[\\/]/u);
        if (
          relativePath.startsWith('/') ||
          unserved.has(segments[0] ?? '') ||
          segments.some((segment) => segment === '' || segment === '.' || segment === '..')
        ) {
          return yield* new RepositoryError({
            kind: 'not-found',
            message: `${relativePath} is outside the live session.`,
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
        if (liesUnder(realRoot, realCandidate, unserved)) {
          return yield* new RepositoryError({
            kind: 'not-found',
            message: `${relativePath} is outside the live session.`,
          });
        }
        const info = yield* fs.stat(realCandidate);
        if (info.type !== 'File') {
          return yield* new RepositoryError({
            kind: 'not-found',
            message: `${relativePath} is not a file.`,
          });
        }
        return realCandidate;
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

    /**
     * Whether the session holds `RULES.md` as the board can serve it: named
     * exactly so, which a disk that ignores case would not insist on, and a
     * file inside the session, which a link to somewhere else is not. The
     * board links to it only then, so the link never leads to a refusal.
     */
    const hasRules = Effect.gen(function*() {
      if (!(yield* fs.readDirectory(root)).includes(rulesFile)) return false;
      yield* servedFile(rulesFile);
      return true;
    }).pipe(Effect.orElseSucceed(() => false));

    const loadUnlocked = Effect.gen(function*() {
      yield* refuseMisnamedStage;
      const stages = yield* Effect.all(stageNames.map((stage) => readStageState(stage)));
      yield* attempt(() => validateUniqueIds(stages));
      const revision = yield* revisionOf(stages);
      return { root, revision, stages, rules: yield* hasRules } satisfies Loaded;
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

    /**
     * Every file of `ledger/`, in name order, read as an entry or as the rule
     * it breaks. Names starting with a dot are skipped, as in the stages. The
     * ledger holds its entries itself: `ledger` is a directory, not a link to
     * one, and each entry is a regular file, never a link.
     */
    const ledgerReads = Effect.gen(function*() {
      const ledger = absolute(ledgerDirectory);
      if ((yield* pathType(ledger)) !== 'Directory') return [];
      const reads: Array<{ readonly path: string; readonly read: LedgerRead }> = [];
      const refuse = (path: string, text: string) => reads.push({ path, read: { problem: { line: null, text } } });
      if (yield* isLink(ledger)) {
        refuse(`${ledgerDirectory}/`, 'it is a link; make it a directory of its own.');
        return reads;
      }
      for (const name of (yield* fs.readDirectory(ledger)).toSorted()) {
        if (name.startsWith('.')) continue;
        const path = `${ledgerDirectory}/${name}`;
        const entry = join(ledger, name);
        if (yield* isLink(entry)) {
          refuse(path, 'it is a link, and the ledger holds its entries as files; put the entry itself here.');
          continue;
        }
        const info = yield* fs.stat(entry).pipe(Effect.option);
        if (Option.isSome(info) && info.value.type === 'Directory') {
          refuse(`${path}/`, `the ledger holds entry files only; move this directory under ${contextDirectory}/ or delete it.`);
          continue;
        }
        if (Option.isSome(info) && info.value.type !== 'File') {
          refuse(path, 'it is not a regular file; delete it.');
          continue;
        }
        const content = Option.isNone(info)
          ? Option.none<string>()
          : yield* fs.readFileString(entry).pipe(Effect.option);
        if (Option.isNone(content)) {
          refuse(path, 'it could not be read; make it readable or delete it.');
          continue;
        }
        reads.push({ path, read: parseLedgerEntry({ name, content: content.value }) });
      }
      return reads;
    }).pipe(Effect.mapError(asRepositoryError));

    /**
     * What `load` reads past: leftover stage files, the closed root and what
     * `meta/` holds, self-ignoring, the sections each stage requires, and the
     * ledger.
     */
    const check = semaphore.withPermit(
      Effect.gen(function*() {
        if ((yield* sessionLink) !== 'directory') return yield* symlinkRefusal;
        const loaded = yield* loadUnlocked;
        for (const stage of stageNames) {
          const leftover = leftoverStageFile(stage);
          if ((yield* pathType(absolute(leftover)).pipe(Effect.mapError(asRepositoryError))) !== null) {
            return yield* new RepositoryError({
              kind: 'validation',
              message: `${leftover} is a leftover stage file; fold it into ${stageDirectory(stage)}/ by hand.`,
            });
          }
        }
        const names = (yield* fs.readDirectory(root).pipe(Effect.mapError(asRepositoryError))).toSorted();
        const present = new Set(names);
        for (const name of names) {
          const problem = rootEntryProblem({ name, type: yield* entryType(absolute(name)) }, present);
          if (problem !== null) return yield* new RepositoryError({ kind: 'validation', message: problem });
        }
        // No fact is defined yet, so `meta/` holding anything is reported; a
        // `meta` that is not a directory was reported with the root.
        if (present.has(metaDirectory)) {
          const meta = absolute(metaDirectory);
          for (const name of (yield* fs.readDirectory(meta).pipe(Effect.mapError(asRepositoryError))).toSorted()) {
            const problem = metaEntryProblem({ name, type: yield* entryType(join(meta, name)) });
            if (problem !== null) return yield* new RepositoryError({ kind: 'validation', message: problem });
          }
        }
        const gitignore = yield* pathType(absolute(gitignorePath)).pipe(Effect.mapError(asRepositoryError));
        if (gitignore === null) {
          return yield* new RepositoryError({
            kind: 'validation',
            message: 'Session is missing .gitignore. Run any session command to write it.',
          });
        }
        if (gitignore !== 'File') {
          return yield* new RepositoryError({
            kind: 'validation',
            message: '.gitignore must be a file holding `*`; replace it with one.',
          });
        }
        yield* attempt(() => {
          for (const state of loaded.stages) {
            for (const item of state.items) validateItemSections(state.stage, item);
          }
        });
        for (const { path, read } of yield* ledgerReads) {
          if (read.problem !== undefined) {
            return yield* new RepositoryError({ kind: 'validation', message: problemAt(path, read.problem) });
          }
        }
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
              message: input.stage === 'Queue'
                ? 'Items enter Queue only through `session batch`.'
                : 'Execute is frozen; create items in another stage.',
            });
          }
          const state = stageOf(loaded, input.stage);
          const item = yield* attempt(() => {
            const candidate = makeItem({
              id: input.id,
              title: input.title.trim(),
              body: input.body,
              group: null,
            });
            validateItem(input.stage, candidate);
            validateItemSections(input.stage, candidate);
            return candidate;
          });
          const items = yield* attempt(() => placeItem({ stage: input.stage, items: state.items, item }));
          yield* attempt(() => validateUniqueIds(projected(loaded, [{ stage: input.stage, items }])));
          return yield* attempt(() => stageChanges(state, items));
        }),
      );

    const moveItem = (input: {
      readonly id: string;
      readonly to: Stage;
      readonly beforeId?: string | null | undefined;
      /**
       * A group of the target stage the item goes in front of, which puts it
       * in no group: groups do not nest. Given instead of `beforeId`.
       */
      readonly beforeGroup?: string | null | undefined;
      /**
       * The group it lands in, which the target stage must already hold, or
       * null for none. Left out, an item keeps its group inside its own stage
       * and has none in another, as leaving Queue drops the batch, and none
       * when it goes in front of a group.
       */
      readonly group?: string | null | undefined;
      readonly revision: string;
    }) =>
      mutate(input.revision, (loaded) =>
        Effect.gen(function*() {
          const found = yield* attempt(() => findRequiredItem(loaded.stages, input.id));
          if (found.stage === 'Execute') {
            return yield* new RepositoryError({
              kind: 'conflict',
              message: 'Execute is frozen; complete its items instead of moving them.',
            });
          }
          if (input.to === 'Execute') {
            return yield* new RepositoryError({
              kind: 'conflict',
              message: 'Items enter Execute only through `session start`.',
            });
          }
          if (input.to === 'Queue' && found.stage !== 'Queue') {
            return yield* new RepositoryError({
              kind: 'conflict',
              message: 'Items enter Queue only through `session batch`.',
            });
          }

          const inPlace = found.stage === input.to;
          const beforeGroup = input.beforeGroup ?? null;
          const group = input.group === undefined
            ? (inPlace && beforeGroup === null ? found.item.group : null)
            : input.group;
          const staysInGroup = inPlace && group === found.item.group;
          // Inside Queue an item keeps its batch and only changes place in it.
          if (input.to === 'Queue' && !staysInGroup) {
            return yield* new RepositoryError({
              kind: 'conflict',
              message: `${stageDirectory('Queue')}: ${input.id} stays in the batch ${quote(found.item.group ?? '')}; a queued item moves only within its batch, or out of Queue.`,
            });
          }
          const target = stageOf(loaded, input.to);
          if (group !== null && !target.items.some((candidate) => candidate.group === group)) {
            return yield* new RepositoryError({
              kind: 'not-found',
              message: `${input.to} has no group ${quote(group)}; \`session group\` starts one.`,
            });
          }
          if (beforeGroup !== null) {
            if (input.beforeId !== undefined && input.beforeId !== null) {
              return yield* new RepositoryError({
                kind: 'validation',
                message: `${stageDirectory(input.to)}: ${input.id} goes in front of one neighbour, an item or a group; name one.`,
              });
            }
            if (group !== null) {
              return yield* new RepositoryError({
                kind: 'validation',
                message: `${stageDirectory(input.to)}: cannot place ${input.id} before the group ${quote(beforeGroup)}; ${input.id} goes in ${placeName(input.to, group)}, and groups do not nest.`,
              });
            }
            if (!target.items.some((candidate) => candidate.group === beforeGroup)) {
              return yield* new RepositoryError({
                kind: 'not-found',
                message: `${input.to} has no group ${quote(beforeGroup)}.`,
              });
            }
          }
          if (input.beforeId === input.id && !staysInGroup) {
            return yield* new RepositoryError({
              kind: 'validation',
              message: `${stageDirectory(input.to)}: cannot place ${input.id} before itself.`,
            });
          }

          const item = draftOf(found.item, group);
          yield* attempt(() => {
            validateItem(input.to, item);
            validateItemSections(input.to, item);
          });

          const source = stageOf(loaded, found.stage);
          const remaining = source.items.filter((candidate) => candidate.id !== input.id);
          if (inPlace) {
            // Placed before itself, an item stays where it is.
            if (input.beforeId === input.id) return [];
            // An item alone in its group keeps the group's place, whether it
            // stays in the group or goes in front of it, out of it.
            const keepsPlace = staysInGroup || (beforeGroup !== null && beforeGroup === found.item.group);
            const items = yield* attempt(() =>
              placeItem({
                stage: input.to,
                items: remaining,
                item,
                beforeId: input.beforeId,
                beforeGroup,
                start: keepsPlace ? source.items.findIndex((candidate) => candidate.id === input.id) : undefined,
              })
            );
            return yield* attempt(() => stageChanges(source, items));
          }

          const items = yield* attempt(() =>
            placeItem({ stage: input.to, items: target.items, item, beforeId: input.beforeId, beforeGroup }),
          );
          return yield* attempt(() => [
            ...stageChanges(source, remaining),
            ...stageChanges(target, items),
          ]);
        }),
      );

    /**
     * Gather items of one flat stage into the group of that name. A group the
     * stage does not hold yet starts at its end; one it holds takes the items
     * at its own end, in the order given. An item already in it stays where it
     * is, so gathering is about belonging and `mv --before` about order.
     */
    const groupItems = (input: {
      readonly name: string;
      readonly ids: ReadonlyArray<string>;
      readonly revision: string;
    }) =>
      mutate(input.revision, (loaded) =>
        Effect.gen(function*() {
          const name = input.name.trim();
          const found = yield* namedItems(loaded, input.ids, 'A group');
          const { stage } = found[0]!;
          const elsewhere = found.find((entry) => entry.stage !== stage);
          if (elsewhere !== undefined) {
            return yield* new RepositoryError({
              kind: 'validation',
              message:
                `A group holds items of one stage: ${found[0]!.item.id} is in ${stage} and ${elsewhere.item.id} is in ${elsewhere.stage}.`,
            });
          }
          if (isBatchedStage(stage)) {
            return yield* new RepositoryError({
              kind: 'conflict',
              message: stage === 'Queue'
                ? 'In Queue a group is a batch, composed from Batch with `session batch`.'
                : 'Execute is frozen; its batch stays as it started.',
            });
          }
          const state = stageOf(loaded, stage);
          const items = yield* attempt(() => {
            validateGroupName(stage, name);
            let placed: ReadonlyArray<ItemDraft> = state.items;
            for (const { item } of found) {
              if (item.group === name) continue;
              const joined = draftOf(item, name);
              validateItem(stage, joined);
              validateItemSections(stage, joined);
              placed = placeItem({ stage, items: placed.filter((candidate) => candidate.id !== item.id), item: joined });
            }
            return placed;
          });
          return yield* attempt(() => stageChanges(state, items));
        }),
      );

    /**
     * Take items out of their groups, each to the end of its own stage, in the
     * order given. An item in no group stays where it is. Queue and Execute
     * refuse, because every item there belongs to a batch.
     */
    const ungroupItems = (input: { readonly ids: ReadonlyArray<string>; readonly revision: string }) =>
      mutate(input.revision, (loaded) =>
        Effect.gen(function*() {
          const found = yield* namedItems(loaded, input.ids, 'Ungrouping');
          const batched = found.find((entry) => isBatchedStage(entry.stage));
          if (batched !== undefined) {
            return yield* new RepositoryError({
              kind: 'conflict',
              message: batched.stage === 'Queue'
                ? `${stageDirectory('Queue')}: ${batched.item.id} stays in the batch ${quote(batched.item.group ?? '')}; a queued item leaves its batch only by leaving Queue, with \`session mv\`.`
                : 'Execute is frozen; its batch stays as it started.',
            });
          }
          const placed = new Map<Stage, ReadonlyArray<ItemDraft>>();
          yield* attempt(() => {
            for (const { stage, item } of found) {
              if (item.group === null) continue;
              const loose = draftOf(item, null);
              validateItem(stage, loose);
              validateItemSections(stage, loose);
              const items = placed.get(stage) ?? stageOf(loaded, stage).items;
              placed.set(stage, placeItem({ stage, items: items.filter((candidate) => candidate.id !== item.id), item: loose }));
            }
          });
          return yield* attempt(() => [...placed].flatMap(([stage, items]) => stageChanges(stageOf(loaded, stage), items)));
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
          const pool = stageOf(loaded, 'Batch');
          const queue = stageOf(loaded, 'Queue');
          if (queue.items.some((item) => item.group === name)) {
            return yield* new RepositoryError({
              kind: 'validation',
              message: `Queue already has a batch named ${quote(name)}.`,
            });
          }
          // An item in a group of Batch leaves it for the batch, and a group
          // left empty goes with it.
          const available = new Map(pool.items.map((item) => [item.id, item]));
          const selected = yield* attempt(() =>
            input.ids.map((id) => {
              const item = available.get(id) ?? fail(`${id} is not in Batch.`);
              const queued = draftOf(item, name);
              validateItem('Queue', queued);
              validateItemSections('Queue', queued);
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
          const queue = stageOf(loaded, 'Queue');
          const execute = stageOf(loaded, 'Execute');
          if (execute.items.length > 0) {
            return yield* new RepositoryError({
              kind: 'conflict',
              message: 'Complete the current Execute batch first.',
            });
          }
          const first = queue.items[0];
          if (first === undefined) {
            return yield* new RepositoryError({
              kind: 'validation',
              message: 'Queue is empty; queue a batch first.',
            });
          }
          const name = first.group;
          const starting: ItemDraft[] = [];
          const waiting: ItemDraft[] = [];
          for (const item of queue.items) {
            if (item.group === name) starting.push(draftOf(item, name));
            else waiting.push(item);
          }
          return yield* attempt(() => {
            for (const item of starting) validateItemSections('Execute', item);
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
          if (found.stage !== 'Execute') {
            return yield* new RepositoryError({
              kind: 'conflict',
              message: `Item ${input.id} is not in Execute.`,
            });
          }
          return yield* fileAway({ id: input.id, state: 'done', loaded, from: 'Execute' });
        }),
      );

    /**
     * The files of `archive/`, each with what its name says. One listing serves
     * the trailer pass and the board, so both read a record the same way.
     * Names starting with a dot, directories, and links to nothing are not
     * records.
     */
    const archiveEntries = Effect.gen(function*() {
      const archive = absolute(archiveDirectory);
      if ((yield* pathType(archive)) !== 'Directory') return [];
      const entries: ArchiveRecord[] = [];
      for (const name of (yield* fs.readDirectory(archive)).toSorted()) {
        if (name.startsWith('.')) continue;
        const info = yield* fs.stat(join(archive, name)).pipe(Effect.option);
        if (Option.isNone(info) || info.value.type !== 'File') continue;
        const parsed = parseArchiveName(name);
        entries.push({
          name,
          path: `${archiveDirectory}/${name}`,
          date: parsed?.day ?? null,
          id: parsed?.id ?? null,
          title: parsed?.title ?? null,
          state: parsed?.state ?? null,
        });
      }
      return entries;
    }).pipe(Effect.mapError(asRepositoryError));

    /** The archived records, by the item each belongs to; names that were not filed here are skipped. */
    const archivedRecords = archiveEntries.pipe(
      Effect.map((entries) =>
        entries.flatMap((entry) => (entry.id === null ? [] : [{ id: entry.id, path: entry.path }]))
      ),
    );

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

    /** Any stage, including Execute, where it means the batch gave the item up. */
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

    /**
     * Scaffolds what is missing. It never converts an older session: a stage
     * held under another name, such as `TRIAGE/`, is refused with its fix
     * before anything is written, as a load refuses it.
     */
    const initialize = Effect.gen(function*() {
      const actions: string[] = [];
      const link = yield* sessionLink;
      if (link === 'live') return yield* symlinkRefusal;
      if (link === 'dangling') {
        // `remove` unlinks the link itself; nothing it pointed at ever existed.
        yield* fs.remove(root).pipe(Effect.mapError(asRepositoryError));
        actions.push(`Removed the dangling link ${root}`);
      }
      yield* refuseMisnamedStage;
      // Only a name nothing holds is scaffolded: a file or a link there, one to
      // nothing included, is left for a load to name.
      const missing: Stage[] = [];
      for (const stage of stageNames) {
        const stagePath = absolute(stageDirectory(stage));
        if ((yield* pathType(stagePath).pipe(Effect.mapError(asRepositoryError))) === null && !(yield* isLink(stagePath))) {
          missing.push(stage);
        }
      }
      if ((yield* pathType(root).pipe(Effect.mapError(asRepositoryError))) === null) {
        actions.push(`Created ${root}`);
      }
      yield* fs.makeDirectory(root, { recursive: true }).pipe(Effect.mapError(asRepositoryError));
      for (const stage of missing) {
        yield* fs.makeDirectory(absolute(stageDirectory(stage)), { recursive: true }).pipe(
          Effect.mapError(asRepositoryError),
        );
      }
      const created = missing.map((stage) => `${stageDirectory(stage)}/`);
      // Facts are optional, so a `meta` that is something else, a link to
      // nothing included, is left for `check` to name.
      const meta = absolute(metaDirectory);
      if ((yield* pathType(meta).pipe(Effect.mapError(asRepositoryError))) === null && !(yield* isLink(meta))) {
        yield* fs.makeDirectory(meta, { recursive: true }).pipe(Effect.mapError(asRepositoryError));
        created.push(`${metaDirectory}/`);
      }
      if (created.length > 0) actions.push(`Created ${created.join(' ')}`);
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
          const stagePath = absolute(stageDirectory(stage));
          if ((yield* pathType(stagePath)) !== 'Directory') continue;
          for (const name of yield* fs.readDirectory(stagePath)) {
            if (name.startsWith('.')) continue;
            const child = join(stagePath, name);
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

    /** The ledger for the board: its entries, and a notice for each file that breaks the ledger's rules. */
    const ledgerListing = semaphore.withPermit(
      Effect.gen(function*() {
        const type = yield* pathType(absolute(ledgerDirectory)).pipe(Effect.mapError(asRepositoryError));
        if (type !== null && type !== 'Directory') {
          return {
            entries: [],
            notices: [`${ledgerDirectory} is not a directory, so no entries are listed; \`session check\` names the fix.`],
          } satisfies LedgerListing;
        }
        const entries: LedgerEntry[] = [];
        const notices: string[] = [];
        for (const { path, read } of yield* ledgerReads) {
          if (read.entry === undefined) notices.push(`${path} is not listed: ${read.problem.text}`);
          else entries.push(read.entry);
        }
        return { entries: entries.toSorted(byDateThenName), notices } satisfies LedgerListing;
      }),
    );

    /**
     * `context/` for the board, depth first, each directory right before what
     * it holds, and the same entries refresh reads there: a directory named
     * `archive` or `ignore` is an ordinary one, and only a link into the root's
     * `archive/` or `ignore/` is left out. Names starting with a dot are left
     * out too. An entry that cannot be shown for another reason is left out
     * with a notice that says why.
     */
    const contextListing = semaphore.withPermit(
      Effect.gen(function*() {
        const entries: ContextEntry[] = [];
        const notices: string[] = [];
        const top = absolute(contextDirectory);
        const type = yield* pathType(top);
        if (type === null) return { entries, notices } satisfies ContextListing;
        if (type !== 'Directory') {
          return {
            entries,
            notices: [`${contextDirectory} is not a directory, so nothing is listed; \`session check\` names the fix.`],
          } satisfies ContextListing;
        }
        const realRoot = yield* fs.realPath(root);
        const realTop = yield* fs.realPath(top);
        if (!isInsideRoot(realRoot, realTop)) {
          return {
            entries,
            notices: [`${contextDirectory} resolves outside the session directory, so nothing is listed.`],
          } satisfies ContextListing;
        }
        // A directory is followed once along each path, so two links to one
        // directory both show it, and only a link back into a directory that
        // holds it is cut.
        const walk = (
          relativeDirectory: string,
          realDirectory: string,
          above: ReadonlySet<string>,
        ): Effect.Effect<void> =>
          Effect.gen(function*() {
            const holding = new Set([...above, realDirectory]);
            const names = yield* fs.readDirectory(realDirectory).pipe(Effect.option);
            if (Option.isNone(names)) {
              notices.push(`What ${relativeDirectory}/ holds is not listed: it could not be read.`);
              return;
            }
            for (const name of names.value.toSorted()) {
              if (name.startsWith('.')) continue;
              const path = `${relativeDirectory}/${name}`;
              const real = yield* fs.realPath(join(realDirectory, name)).pipe(Effect.option);
              if (Option.isNone(real)) {
                notices.push(`${path} is not listed: it ${yield* unresolvedReason(join(realDirectory, name))}.`);
                continue;
              }
              if (!isInsideRoot(realRoot, real.value)) {
                notices.push(`${path} is not listed: it resolves outside the session directory.`);
                continue;
              }
              // What refresh leaves out, a link into the root's archive or ignore, is left out here too.
              if (liesUnder(realRoot, real.value, outOfContext)) continue;
              const info = yield* fs.stat(real.value).pipe(Effect.option);
              const writtenAt = Option.isNone(info) ? null : writtenAtOf(info.value);
              if (Option.isNone(info) || writtenAt === null) {
                notices.push(`${path} is not listed: it could not be read.`);
                continue;
              }
              if (info.value.type === 'Directory') {
                if (holding.has(real.value)) {
                  notices.push(`${path} is not listed: it leads back into a directory that holds it.`);
                  continue;
                }
                entries.push({ path, kind: 'directory', writtenAt });
                yield* walk(path, real.value, holding);
              } else if (info.value.type === 'File') {
                entries.push({ path, kind: 'file', writtenAt });
              } else {
                notices.push(`${path} is not listed: it is not a regular file.`);
              }
            }
          });
        yield* walk(contextDirectory, realTop, new Set());
        return { entries, notices } satisfies ContextListing;
      }).pipe(Effect.mapError(asRepositoryError)),
    );

    /** `archive/` for the board: every record, newest first by the day in its name, then by name. */
    const archiveListing = semaphore.withPermit(
      archiveEntries.pipe(
        Effect.map((records) => ({ records: records.toSorted(byDateThenName) }) satisfies ArchiveListing),
      ),
    );

    /**
     * The batch Execute is running, read from the name of its batch directory
     * alone, so writing a ledger entry never depends on every item file
     * loading. Null while Execute holds no batch directory.
     */
    const executingBatchName = Effect.gen(function*() {
      const execute = absolute(stageDirectory('Execute'));
      if ((yield* pathType(execute)) !== 'Directory') return null;
      const batches: Array<{ readonly prefix: number; readonly name: string }> = [];
      for (const name of yield* fs.readDirectory(execute)) {
        const match = name.startsWith('.') ? null : entryName.exec(name);
        if (match === null || (yield* pathType(join(execute, name))) !== 'Directory') continue;
        // A batch directory holding nothing a reader sees is no batch, as the
        // stage's own reading of it has it.
        if (!(yield* holdsVisibleEntry(join(execute, name)))) continue;
        batches.push({ prefix: Number(match[1]!), name: match[2]! });
      }
      return batches.toSorted((left, right) => left.prefix - right.prefix)[0]?.name ?? null;
    }).pipe(Effect.mapError(asRepositoryError));

    /**
     * Create a file that must not exist yet, atomically: write a dot-prefixed
     * neighbour, which every reader ignores, then link it into place, which
     * fails instead of replacing a file that already has the name.
     */
    const createFile = (relativePath: string, content: string) =>
      Effect.gen(function*() {
        const target = absolute(relativePath);
        const parent = dirname(target);
        yield* fs.makeDirectory(parent, { recursive: true });
        const temp = join(parent, `.${yield* crypto.randomUUIDv4}.tmp`);
        const taken = new RepositoryError({
          kind: 'conflict',
          message: `${relativePath} already exists, and an entry is never overwritten; log it with another title, or again in a second.`,
        });
        yield* fs.writeFileString(temp, content).pipe(
          Effect.andThen(
            fs.link(temp, target).pipe(Effect.catchReason('PlatformError', 'AlreadyExists', () => Effect.fail(taken))),
          ),
          Effect.ensuring(fs.remove(temp).pipe(Effect.ignore)),
        );
      }).pipe(
        Effect.mapError((cause) =>
          cause instanceof RepositoryError
            ? cause
            : new RepositoryError({ kind: 'io', message: `Could not write ${relativePath}.`, cause })
        ),
      );

    /**
     * Write one ledger entry: the date from the clock, the batch Execute is
     * running, and whatever else the caller observed. The entry is read back by
     * the rules `check` applies before anything is written, so `log` can never
     * leave a file the check rejects.
     */
    const appendLedger = (input: {
      readonly by: string;
      readonly title: string;
      readonly body: string;
      readonly branch: string | null;
      readonly commit: string | null;
    }) =>
      semaphore.withPermit(
        Effect.gen(function*() {
          const title = input.title.trim();
          const by = input.by.trim();
          if (title === '') return yield* new RepositoryError({ kind: 'validation', message: 'Not logged: the entry has no title.' });
          if (by === '') {
            return yield* new RepositoryError({ kind: 'validation', message: 'Not logged: the entry does not say who wrote it.' });
          }
          const ledger = absolute(ledgerDirectory);
          if (yield* isLink(ledger)) {
            return yield* new RepositoryError({
              kind: 'validation',
              message: `Not logged: ${ledgerDirectory} is a link; make it a directory of its own, then log again.`,
            });
          }
          const type = yield* pathType(ledger).pipe(Effect.mapError(asRepositoryError));
          if (type !== null && type !== 'Directory') {
            return yield* new RepositoryError({
              kind: 'validation',
              message: `Not logged: ${ledgerDirectory} is not a directory; \`session check\` names the fix.`,
            });
          }
          const fields = {
            date: yield* ledgerNow,
            title,
            by,
            branch: input.branch,
            commit: input.commit,
            batch: yield* executingBatchName,
            body: input.body.trim(),
          };
          const name = ledgerFileName(fields);
          if (encoder.encode(name).length > fileNameBytes) {
            return yield* new RepositoryError({
              kind: 'validation',
              message: 'Not logged: the title is too long to name a file; shorten it.',
            });
          }
          const content = renderLedgerEntry(fields);
          const read = parseLedgerEntry({ name, content });
          if (read.entry === undefined) {
            return yield* new RepositoryError({ kind: 'validation', message: `Not logged: ${read.problem.text}` });
          }
          yield* createFile(read.entry.path, content);
          return read.entry;
        }),
      );

    /**
     * A path and content hash for every file an agent's refresh reads, with the
     * root's `ignore/` and `archive/` left out before traversal; a directory of
     * either name deeper down is read like any other. An entry that cannot be
     * taken in, a link that resolves outside the session, leads nowhere or
     * back into a directory that holds it, or anything that cannot be read, is
     * listed under `skipped` with the reason, and the rest of the inventory
     * stands. The stages themselves must load first, as for every command.
     */
    const inventory = semaphore.withPermit(
      Effect.gen(function*() {
        yield* loadUnlocked;
        const realRoot = yield* fs.realPath(root).pipe(Effect.mapError(asRepositoryError));
        const skipped: SkippedEntry[] = [];
        // A directory is followed once along each path, so one reached by two
        // paths is listed under both, and only a link back into a directory
        // that holds it is cut.
        const walk = (
          relativeDirectory: string,
          realDirectory: string,
          above: ReadonlySet<string>,
        ): Effect.Effect<Array<readonly [string, string]>, RepositoryError> =>
          Effect.gen(function*() {
            const holding = new Set([...above, realDirectory]);
            const names = yield* fs.readDirectory(realDirectory).pipe(Effect.option);
            if (Option.isNone(names)) {
              if (relativeDirectory === '') {
                return yield* new RepositoryError({ kind: 'io', message: `Could not read ${root}.` });
              }
              skipped.push({ path: relativeDirectory, reason: 'could not be read' });
              return [];
            }
            const entries: Array<readonly [string, string]> = [];
            for (const name of names.value.toSorted()) {
              if (relativeDirectory === '' && outOfContext.has(name)) continue;
              const relativePath = relativeDirectory === '' ? name : join(relativeDirectory, name);
              const candidate = join(realDirectory, name);
              const realCandidate = yield* fs.realPath(candidate).pipe(Effect.option);
              if (Option.isNone(realCandidate)) {
                skipped.push({ path: relativePath, reason: yield* unresolvedReason(candidate) });
                continue;
              }
              if (!isInsideRoot(realRoot, realCandidate.value)) {
                skipped.push({ path: relativePath, reason: 'resolves outside the session directory' });
                continue;
              }
              if (liesUnder(realRoot, realCandidate.value, outOfContext)) continue;
              const info = yield* fs.stat(realCandidate.value).pipe(Effect.option);
              if (Option.isNone(info)) {
                skipped.push({ path: relativePath, reason: 'could not be read' });
                continue;
              }
              if (info.value.type === 'Directory') {
                if (holding.has(realCandidate.value)) {
                  skipped.push({ path: relativePath, reason: 'leads back into a directory that holds it' });
                  continue;
                }
                entries.push(...(yield* walk(relativePath, realCandidate.value, holding)));
              } else if (info.value.type === 'File') {
                const content = yield* fs.readFile(realCandidate.value).pipe(Effect.option);
                if (Option.isNone(content)) {
                  skipped.push({ path: relativePath, reason: 'could not be read' });
                  continue;
                }
                entries.push([relativePath, yield* digestBytes(content.value)]);
              }
            }
            return entries;
          });
        const files = yield* walk('', realRoot, new Set());
        return { inventory: Object.fromEntries(files) as FileInventory, skipped };
      }),
    );

    return {
      root,
      initialize,
      load,
      check,
      addItem,
      moveItem,
      groupItems,
      ungroupItems,
      queueBatch,
      startBatch,
      completeItem,
      archiveItem,
      closeFromCommits,
      inventory,
      lastChange,
      servedFile,
      ledgerListing,
      contextListing,
      archiveListing,
      appendLedger,
    } as const;
  });

export type SessionRepository = Effect.Success<ReturnType<typeof makeRepository>>;
