import { Schema } from 'effect';

export const stageNames = ['TRIAGE', 'DESIGN', 'BATCH', 'QUEUE', 'EXECUTE'] as const;
export type Stage = typeof stageNames[number];

/** Stages whose items belong to a named batch, rendered as `# Batch name` headings. */
export type BatchedStage = 'QUEUE' | 'EXECUTE';
export const isBatchedStage = (stage: Stage): stage is BatchedStage =>
  stage === 'QUEUE' || stage === 'EXECUTE';

/** A stage is one Markdown file until it passes this many lines; then it is a directory of item files. */
export const stageFileLineLimit = 500;

export const stageLayouts = ['file', 'directory'] as const;
export type StageLayout = typeof stageLayouts[number];

export type Item = {
  id: string;
  title: string;
  body: string;
  summary: string;
  /** The batch the item belongs to. Always set in QUEUE and EXECUTE, never elsewhere. */
  batch: string | null;
};

export type StageFile = {
  stage: Stage;
  layout: StageLayout;
  /** Absolute path of `STAGE.md` or of the `STAGE/` directory. */
  path: string;
  /** The whole stage as Markdown; for a directory stage, the rendered concatenation of its item files. */
  markdown: string;
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
    layout: Schema.Literals(stageLayouts),
    path: Schema.String,
    markdown: Schema.String,
    items: Schema.Array(ItemSchema).pipe(Schema.mutable),
  })).pipe(Schema.mutable),
});
