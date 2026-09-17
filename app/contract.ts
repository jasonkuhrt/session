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

/**
 * One Claude Code session under a worktree, as Claude Code's own listing
 * (`claude agents --json`) reports it. Strings the harness may extend (`kind`,
 * `status`, `state`) are carried raw; the board renders what it is given and
 * never maps an unknown value into a known one.
 */
export type ClaudeSession = {
  /** `interactive` or `background` today. */
  kind: string;
  /** Null for a background session whose process is not running. */
  pid: number | null;
  sessionId: string | null;
  /** The listing's `id` of a background session; the handle for `claude attach`. */
  backgroundId: string | null;
  name: string | null;
  /** `busy`, `shell`, `idle`, `waiting`; null when the listing gives none. */
  status: string | null;
  /**
   * How a background session is doing, which is the fact the listing carries
   * instead of a status; null for an interactive session.
   *
   * - `working`: driving its own work — a turn, a `/loop` iteration, or a wait on CI
   * - `blocked`: waiting on you — a question it asked, a permission or sandbox decision, an error only you can clear, or its first prompt
   * - `done`: the last turn finished; ready for the next prompt
   * - `failed`: ended with an error
   * - `stopped`: was stopped
   *
   * Without `--all` the listing holds active sessions, so the last three should
   * not arrive. Whatever does arrive is rendered as it came.
   */
  state: string | null;
  /**
   * Why a session is waiting on a person: the reason while `status` is
   * `waiting`, e.g. `permission prompt`, or the open prompt a `blocked`
   * session's live process is holding.
   */
  waitingFor: string | null;
  /** ISO 8601. */
  startedAt: string;
  /**
   * ISO 8601 of when the status last changed, from the registry. It is an
   * event time, not a heartbeat: an old one means the session has held the
   * same status for a while, never that it is stale or gone.
   */
  statusChangedAt: string | null;
  /** `https://claude.ai/code/<id>` when a Remote Control id was recorded; it proves the session was bridged, not that it is now. */
  web: string | null;
  /** The cmux refs holding this pid, or null when it runs in no cmux tab (a normal state). */
  terminal: { surface: string; workspace: string; window: string } | null;
  /** `claude --resume <sessionId>` or `claude attach <id>`; null when neither handle exists. */
  resume: string | null;
};

/** One Codex thread under a worktree, from `thread/list`; newest first. */
export type CodexThread = {
  /** UUID from the listing; the only id ever placed in a link. */
  id: string;
  /** The thread's name, else its preview. */
  name: string;
  /** `Desktop`, `CLI` or `app-server`. */
  origin: string;
  /** ISO 8601 of the thread's recency. */
  updatedAt: string;
  /** True when a live process holds the thread's writer lock; null when that could not be read. Never turn status. */
  loaded: boolean | null;
  /** `codex://threads/<id>`. */
  link: string;
  /** `codex resume <id>`, offered only while the thread is not loaded elsewhere. */
  resume: string | null;
};

/** The agents overlay for one worktree: read-only, recomputed on demand, never persisted. */
export type AgentsSummary = {
  claude: readonly ClaudeSession[];
  /** At most the newest three. */
  codex: readonly CodexThread[];
  /** Why a source is missing, e.g. `Codex not available`; one line each, empty when all sources answered. */
  notices: readonly string[];
  /** ISO 8601 of the listing. */
  fetchedAt: string;
};

export const ClaudeSessionSchema = Schema.Struct({
  kind: Schema.String,
  pid: Schema.NullOr(Schema.Int),
  sessionId: Schema.NullOr(Schema.String),
  backgroundId: Schema.NullOr(Schema.String),
  name: Schema.NullOr(Schema.String),
  status: Schema.NullOr(Schema.String),
  state: Schema.NullOr(Schema.String),
  waitingFor: Schema.NullOr(Schema.String),
  startedAt: Schema.String,
  statusChangedAt: Schema.NullOr(Schema.String),
  web: Schema.NullOr(Schema.String),
  terminal: Schema.NullOr(Schema.Struct({
    surface: Schema.String,
    workspace: Schema.String,
    window: Schema.String,
  })),
  resume: Schema.NullOr(Schema.String),
});

export const CodexThreadSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  origin: Schema.String,
  updatedAt: Schema.String,
  loaded: Schema.NullOr(Schema.Boolean),
  link: Schema.String,
  resume: Schema.NullOr(Schema.String),
});

export const AgentsSummarySchema = Schema.Struct({
  claude: Schema.Array(ClaudeSessionSchema),
  codex: Schema.Array(CodexThreadSchema),
  notices: Schema.Array(Schema.String),
  fetchedAt: Schema.String,
});

/**
 * When a worktree last did something, and what did it: `claude` is a Claude
 * Code session's status change, `codex` a Codex thread's update, `items` an
 * item file written. A moment dates activity and nothing more: no time here is
 * a heartbeat, and none of them says a session is still alive.
 */
export type Activity = {
  at: string;
  kind: 'claude' | 'codex' | 'items';
};

export const ActivitySchema = Schema.Struct({
  at: Schema.String,
  kind: Schema.Literals(['claude', 'codex', 'items']),
});

/** The trailer a commit carries to say it finished an item. */
export const doneTrailer = 'Session-Done';

/**
 * A `Session-Done` trailer the daemon could not act on.
 *
 * A commit that finishes an item ends its message with `Session-Done: <ID>`,
 * and the daemon files that item as done when the commit lands. Only commits
 * no remote has yet are read, because those are the ones a trailer can still
 * be fixed on; a problem stops being reported once its commit is pushed.
 *
 * - `unknown`: no item in the session has this id, live or archived
 * - `outside-trailers`: the message has a `Session-Done:` line that is not in
 *   its final paragraph, so Git does not read it as a trailer at all
 * - `close-failed`: the item exists and filing it away failed; `detail` says why
 */
export type TrailerProblem = {
  /** Full hash of the commit carrying the trailer. */
  commit: string;
  /** The commit's subject line. */
  subject: string;
  /** The id the line named. */
  id: string;
  kind: 'unknown' | 'outside-trailers' | 'close-failed';
  /** What the engine said, for `close-failed`; null otherwise. */
  detail: string | null;
};

export const TrailerProblemSchema = Schema.Struct({
  commit: Schema.String,
  subject: Schema.String,
  id: Schema.String,
  kind: Schema.Literals(['unknown', 'outside-trailers', 'close-failed']),
  detail: Schema.NullOr(Schema.String),
});

/** One row of the index: a tracked worktree and what its session holds. */
export type WorktreeSummary = {
  /** Route segment(s) under `/w/`: the worktree name, e.g. `Heartbeat` or `email-backend/Heartbeat`. */
  key: string;
  name: string;
  path: string;
  branch: string | null;
  /** The batches running in Execute, in file order; empty when Execute is empty. */
  executing: readonly string[];
  counts: Record<Stage, number>;
  /** ISO 8601 of the newest item file, or null for an empty session. */
  lastChange: string | null;
  /** The newest of the agents' moments and `lastChange`; null when there is none. */
  activity: Activity | null;
  /** Set when another tracked worktree already owns this key; the row is not served. */
  conflict: string | null;
  agents: AgentsSummary;
  /** Trailers on this worktree's unpushed commits that could not be acted on. */
  trailerProblems: readonly TrailerProblem[];
};

export const WorktreeSummarySchema = Schema.Struct({
  key: Schema.String,
  name: Schema.String,
  path: Schema.String,
  branch: Schema.NullOr(Schema.String),
  executing: Schema.Array(Schema.String),
  counts: Schema.Struct({
    TRIAGE: Schema.Int,
    DESIGN: Schema.Int,
    BATCH: Schema.Int,
    QUEUE: Schema.Int,
    EXECUTE: Schema.Int,
  }),
  lastChange: Schema.NullOr(Schema.String),
  activity: Schema.NullOr(ActivitySchema),
  conflict: Schema.NullOr(Schema.String),
  agents: AgentsSummarySchema,
  trailerProblems: Schema.Array(TrailerProblemSchema),
});

/** The result of asking the daemon to focus a session's terminal. */
export type FocusResult = { ok: true } | { ok: false; reason: string };
