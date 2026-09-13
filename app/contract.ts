import { Schema } from 'effect';

export const stageNames = ['TRIAGE', 'DESIGN', 'BATCH', 'QUEUE', 'EXECUTE'] as const;
export type Stage = typeof stageNames[number];

/** Stages whose items belong to a named batch, held in a batch directory. */
export type BatchedStage = 'QUEUE' | 'EXECUTE';
export const isBatchedStage = (stage: Stage): stage is BatchedStage =>
  stage === 'QUEUE' || stage === 'EXECUTE';

export type Item = {
  id: string;
  title: string;
  body: string;
  summary: string;
  /** The batch the item belongs to. Always set in QUEUE and EXECUTE, never elsewhere. */
  batch: string | null;
  /** The item's file, relative to the session root: `TRIAGE/010-BE-1.md` or `QUEUE/010-Name/010-BE-1.md`. */
  path: string;
};

/** A stage is a directory of item files; its listing order is card order. */
export type StageFile = {
  stage: Stage;
  /** Absolute path of the `STAGE/` directory. */
  path: string;
  items: Item[];
};

export type Session = {
  directory: string;
  revision: string;
  stages: StageFile[];
  worktree?: {
    name: string;
    path: string;
    branch: string | null;
  };
};

export const ItemSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  body: Schema.String,
  summary: Schema.String,
  batch: Schema.NullOr(Schema.String),
  path: Schema.String,
});

export const SessionSchema = Schema.Struct({
  directory: Schema.String,
  revision: Schema.String,
  worktree: Schema.optionalKey(Schema.Struct({
    name: Schema.String,
    path: Schema.String,
    branch: Schema.NullOr(Schema.String),
  })),
  stages: Schema.Array(Schema.Struct({
    stage: Schema.Literals(stageNames),
    path: Schema.String,
    items: Schema.Array(ItemSchema).pipe(Schema.mutable),
  })).pipe(Schema.mutable),
});

/** The one daemon per user listens here; `session open` upserts it. */
export const daemonPort = 53045;

export type DaemonInfo = {
  pid: number;
  port: number;
  /** ISO 8601. */
  startedAt: string;
  /** Newest mtime across the server, contract, dist and CLI sources the daemon was started from. */
  sourceStamp: string;
};

export const DaemonInfoSchema = Schema.Struct({
  pid: Schema.Int,
  port: Schema.Int,
  startedAt: Schema.String,
  sourceStamp: Schema.String,
});

/** One row of the index: a tracked worktree and what its session holds. */
export type WorktreeSummary = {
  /** Route segment(s) under `/w/`: the worktree name, e.g. `Heartbeat` or `email-backend/Heartbeat`. */
  key: string;
  name: string;
  path: string;
  branch: string | null;
  running: { batch: string; items: number } | null;
  counts: Record<Stage, number>;
  /** ISO 8601 of the newest item file, or null for an empty session. */
  lastChange: string | null;
  /** Set when another tracked worktree already owns this key; the row is not served. */
  conflict: string | null;
};

export const WorktreeSummarySchema = Schema.Struct({
  key: Schema.String,
  name: Schema.String,
  path: Schema.String,
  branch: Schema.NullOr(Schema.String),
  running: Schema.NullOr(Schema.Struct({ batch: Schema.String, items: Schema.Int })),
  counts: Schema.Struct({
    TRIAGE: Schema.Int,
    DESIGN: Schema.Int,
    BATCH: Schema.Int,
    QUEUE: Schema.Int,
    EXECUTE: Schema.Int,
  }),
  lastChange: Schema.NullOr(Schema.String),
  conflict: Schema.NullOr(Schema.String),
});
