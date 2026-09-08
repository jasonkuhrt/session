import { Schema } from 'effect';

export const stageNames = ['TRIAGE', 'DESIGN', 'BATCH', 'EXECUTE'] as const;
export type Stage = typeof stageNames[number];

export type Item = {
  id: string;
  title: string;
  body: string;
  summary: string;
  group: string | null;
};

export type StageFile = {
  stage: Stage;
  file: string;
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
  group: Schema.NullOr(Schema.String),
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
    file: Schema.String,
    markdown: Schema.String,
    items: Schema.Array(ItemSchema).pipe(Schema.mutable),
  })).pipe(Schema.mutable),
});
