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
