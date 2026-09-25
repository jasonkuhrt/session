import { Schema } from 'effect';

/* eslint-disable max-lines -- The one wire contract: every shape the server and the browser exchange is declared here beside its schema, so neither side can read a shape the other does not write. */

/**
 * The stages by name, in the flow's order. A name is written the same way in
 * the files, the CLI and the board, and the order is the lanes' order.
 */
export const stageNames = ['Triage', 'Design', 'Batch', 'Queue', 'Execute'] as const;
export type Stage = typeof stageNames[number];

/**
 * A stage's directory in the session root: its place in the flow, a hyphen,
 * and its name, `1-Triage` to `5-Execute`, so a file tree lists the stages in
 * the order work moves through them.
 */
export const stageDirectory = (stage: Stage): string => `${stageNames.indexOf(stage) + 1}-${stage}`;

/**
 * Stages where every item belongs to a group, and the group is a batch: a
 * group that gets started as a unit. Elsewhere a group is optional.
 */
export type BatchedStage = 'Queue' | 'Execute';
export const isBatchedStage = (stage: Stage): stage is BatchedStage =>
  stage === 'Queue' || stage === 'Execute';

export type Item = {
  id: string;
  title: string;
  body: string;
  summary: string;
  /**
   * The group the item belongs to: the name of the directory its file sits in
   * inside the stage. Always set in Queue and Execute, where the group is the
   * batch; null for an item filed directly in Triage, Design or Batch.
   */
  group: string | null;
  /** The item's file, relative to the session root: `1-Triage/010-BE-1.md`, `1-Triage/020-Name/010-BE-2.md` or `4-Queue/010-Name/010-BE-3.md`. */
  path: string;
};

/** A stage is a directory of numbered item files and group directories. */
export type StageFile = {
  stage: Stage;
  /** Absolute path of the stage's directory, such as `…/.session/1-Triage`. */
  path: string;
  /** In file order, which is card order: a group's items are consecutive, in its directory's order. */
  items: Item[];
};

/** The user's standing rules for the session, a file at its root that nothing scaffolds. */
export const rulesFile = 'RULES.md';

export type Session = {
  directory: string;
  revision: string;
  stages: StageFile[];
  /** Whether the session holds `RULES.md`. */
  rules: boolean;
  worktree?: {
    name: string;
    path: string;
    /** The branch checked out; null on a detached HEAD, and outside Git. */
    branch: string | null;
    /** True when Git has a commit checked out rather than a branch. */
    detached: boolean;
  };
};

export const ItemSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  body: Schema.String,
  summary: Schema.String,
  group: Schema.NullOr(Schema.String),
  path: Schema.String,
});

export const SessionSchema = Schema.Struct({
  directory: Schema.String,
  revision: Schema.String,
  rules: Schema.Boolean,
  worktree: Schema.optionalKey(Schema.Struct({
    name: Schema.String,
    path: Schema.String,
    branch: Schema.NullOr(Schema.String),
    detached: Schema.Boolean,
  })),
  stages: Schema.Array(Schema.Struct({
    stage: Schema.Literals(stageNames),
    path: Schema.String,
    items: Schema.Array(ItemSchema).pipe(Schema.mutable),
  })).pipe(Schema.mutable),
});

/**
 * One entry of the session's ledger: something another agent, or the user,
 * must know to act correctly here and would not learn from the items. Entries
 * are files under `ledger/`, written once and never edited; the fields are the
 * file's frontmatter, and the name is derived from `date` and `title`.
 */
export type LedgerEntry = {
  /** The file's name, e.g. `2026-09-23 14-02-11Z — Pivot to per-item evidence.md`. */
  name: string;
  /** `ledger/<name>`, relative to the session root. */
  path: string;
  /** When it was written: ISO 8601 in UTC, to the second. */
  date: string;
  title: string;
  /** Who wrote it: `claude <session id>`, `codex <thread id>`, or a person's name. */
  by: string;
  /**
   * The Git branch it was written on. Null when the entry names none, as
   * `session log` leaves it out outside a repository or on a detached HEAD.
   */
  branch: string | null;
  /**
   * The commit HEAD named when it was written, abbreviated. Null when the entry
   * names none, as outside a repository or before the first commit.
   */
  commit: string | null;
  /** The batch Execute was running when it was written; null when the entry names none, as while Execute was empty. */
  batch: string | null;
  /** The Markdown after the frontmatter, trimmed; it may be empty and holds no headings. */
  body: string;
};

/** The ledger as the board reads it. */
export type LedgerListing = {
  /** Newest first by date, then by name. */
  entries: readonly LedgerEntry[];
  /** One line per file in `ledger/` that breaks the ledger's rules and is left out; `session check` names the fix. */
  notices: readonly string[];
};

export const LedgerEntrySchema = Schema.Struct({
  name: Schema.String,
  path: Schema.String,
  date: Schema.String,
  title: Schema.String,
  by: Schema.String,
  branch: Schema.NullOr(Schema.String),
  commit: Schema.NullOr(Schema.String),
  batch: Schema.NullOr(Schema.String),
  body: Schema.String,
});

export const LedgerListingSchema = Schema.Struct({
  entries: Schema.Array(LedgerEntrySchema),
  notices: Schema.Array(Schema.String),
});

/** One file or directory under the session's `context/`, where agents keep supporting material. */
export type ContextEntry = {
  /** Relative to the session root: `context/SES-1/design.md`, or `context/SES-1` for a directory. */
  path: string;
  kind: 'file' | 'directory';
  /** When it was last written: its modification time, ISO 8601 in UTC. */
  writtenAt: string;
};

/** `context/` as the board reads it. */
export type ContextListing = {
  /**
   * Every file and directory under `context/`, depth first: a directory comes
   * right before what it holds, and entries that share a directory are sorted
   * by name. Names starting with a dot are left out. A directory named
   * `archive` or `ignore` here is ordinary; only a link into the root's
   * `archive/` or `ignore/` is left out, as `refresh` leaves it out.
   */
  entries: readonly ContextEntry[];
  /** One line per entry that is left out for a reason worth saying, such as a link that leads outside the session. */
  notices: readonly string[];
};

export const ContextEntrySchema = Schema.Struct({
  path: Schema.String,
  kind: Schema.Literals(['file', 'directory']),
  writtenAt: Schema.String,
});

export const ContextListingSchema = Schema.Struct({
  entries: Schema.Array(ContextEntrySchema),
  notices: Schema.Array(Schema.String),
});

/**
 * One file under `archive/`, read from its name: the day it was filed, the
 * item, its title, and the state it left in. A name that is not exactly one the
 * engine writes is listed as it is, with all four null.
 */
export type ArchiveRecord = {
  name: string;
  /** `archive/<name>`, relative to the session root. */
  path: string;
  /** The day it was filed, `2026-09-13`; null when the name is not one the engine writes. */
  date: string | null;
  id: string | null;
  title: string | null;
  /** `done` for finished work, or the lowercase stage it was filed from, such as `triage`. */
  state: string | null;
};

/** `archive/` as the board reads it. */
export type ArchiveListing = {
  /** Newest first by date, then by name; names without a date come last, by name. Directories are not listed. */
  records: readonly ArchiveRecord[];
};

export const ArchiveRecordSchema = Schema.Struct({
  name: Schema.String,
  path: Schema.String,
  date: Schema.NullOr(Schema.String),
  id: Schema.NullOr(Schema.String),
  title: Schema.NullOr(Schema.String),
  state: Schema.NullOr(Schema.String),
});

export const ArchiveListingSchema = Schema.Struct({
  records: Schema.Array(ArchiveRecordSchema),
});

/**
 * The events a page's stream can carry, by the name each is written under. A
 * page names the ones it reads, and its stream carries only those: the daemon
 * re-reads some sources only while a page is listening for them.
 *
 * - `changed`: a file under the worktree's `.session` was written
 * - `agents`: the Claude Code registry or a Codex writer lock changed
 * - `trailers`: the unpushed commits' trailer problems changed
 * - `links`: gh or linear was asked about the worktree's links again
 * - `worktrees`: the set of tracked worktrees changed, a trailer report
 *   changed, or a tracked worktree's `.session` changed where a row shows it:
 *   its items or its epic
 * - `pull-requests`: gh was asked about a tracked worktree's pull request again
 */
export type StreamEvent = 'changed' | 'agents' | 'trailers' | 'links' | 'worktrees' | 'pull-requests';

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
 * What `GET /api/daemon` reports beside who the daemon is: what it can do for a
 * page. It is its own shape because the CLI recognises a running daemon by
 * `DaemonInfo` alone, and one started from older sources, which reports none of
 * this, must still be recognised in order to be replaced.
 */
export type DaemonCapabilities = {
  /** Whether `cmux` is on the daemon's PATH, which is what the terminal action runs. */
  terminal: boolean;
};

export const DaemonCapabilitiesSchema = Schema.Struct({
  terminal: Schema.Boolean,
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

/**
 * The pull request `gh pr view` reports for a worktree's branch. `state` and
 * `reviewDecision` are gh's own words, carried unmapped.
 */
export type PullRequest = {
  number: number;
  url: string;
  title: string;
  state: 'OPEN' | 'MERGED' | 'CLOSED';
  isDraft: boolean;
  /** `APPROVED`, `CHANGES_REQUESTED` or `REVIEW_REQUIRED` as gh gives it; null when gh gives none. */
  reviewDecision: string | null;
  /**
   * The head commit's checks, counted from gh's `statusCheckRollup`. A check
   * run passed when it completed with `SUCCESS`, `NEUTRAL` or `SKIPPED` and
   * failed when it completed any other way; a commit status, which carries only
   * a `state`, passed on `SUCCESS` and failed on `FAILURE` or `ERROR`.
   * Everything else is pending.
   */
  checks: { passed: number; failed: number; pending: number };
};

/** One Linear issue a worktree names, as the `linear` CLI reports it. */
export type LinearIssue = {
  /** The identifier, e.g. `HEA-5454`. */
  id: string;
  url: string;
  title: string;
  /** The CLI's state name, unmapped. */
  state: string;
};

/**
 * What gh reported about a worktree's branch, and when it was asked. One
 * answer serves the index, which shows it on the worktree's row, and a board,
 * which shows it beside the issues.
 */
export type PullRequestReport = {
  /** Null when the branch has no pull request, when the worktree is on no branch, and when gh did not answer. */
  pr: PullRequest | null;
  /** The sentence saying why gh did not answer; null when it did. */
  notice: string | null;
  /** ISO 8601 of when gh was asked. */
  reportedAt: string;
};

/** What linear reported about the issues a worktree names, and when it was asked. */
export type IssuesReport = {
  /**
   * The issues the branch and its pull request's title and body name, in the
   * order first named, each one confirmed by `linear issue view`; empty when
   * they name none and when linear could not say, which the notice then names.
   */
  issues: readonly LinearIssue[];
  /** The sentence saying why linear did not answer; null when it did. */
  notice: string | null;
  /** ISO 8601 of when linear was asked. */
  reportedAt: string;
};

/**
 * Where a worktree's work lives outside its files: the pull request for its
 * branch and the issues it names, read from the tools that know when they are
 * asked, and never persisted. Each is dated by its own ask, because gh is
 * asked for the index as well, and linear only for a board.
 */
export type Links = {
  pullRequest: PullRequestReport;
  issues: IssuesReport;
};

/**
 * The index's pull requests: gh's last report for each tracked worktree, by
 * the worktree's path. A worktree gh has not been asked about yet is absent,
 * and so is one the index lists as not served.
 */
export type PullRequestReports = { readonly [path: string]: PullRequestReport };

export const PullRequestSchema = Schema.Struct({
  number: Schema.Int,
  url: Schema.String,
  title: Schema.String,
  state: Schema.Literals(['OPEN', 'MERGED', 'CLOSED']),
  isDraft: Schema.Boolean,
  reviewDecision: Schema.NullOr(Schema.String),
  checks: Schema.Struct({
    passed: Schema.Int,
    failed: Schema.Int,
    pending: Schema.Int,
  }),
});

export const LinearIssueSchema = Schema.Struct({
  id: Schema.String,
  url: Schema.String,
  title: Schema.String,
  state: Schema.String,
});

export const PullRequestReportSchema = Schema.Struct({
  pr: Schema.NullOr(PullRequestSchema),
  notice: Schema.NullOr(Schema.String),
  reportedAt: Schema.String,
});

export const IssuesReportSchema = Schema.Struct({
  issues: Schema.Array(LinearIssueSchema),
  notice: Schema.NullOr(Schema.String),
  reportedAt: Schema.String,
});

export const LinksSchema = Schema.Struct({
  pullRequest: PullRequestReportSchema,
  issues: IssuesReportSchema,
});

export const PullRequestReportsSchema = Schema.Record(Schema.String, PullRequestReportSchema);

/** One row of the index: a tracked worktree and what its session holds. */
export type WorktreeSummary = {
  /** Route segment(s) under `/w/`: the worktree name, e.g. `Heartbeat` or `email-backend/Heartbeat`. */
  key: string;
  name: string;
  path: string;
  /** The branch checked out; null on a detached HEAD, and outside Git. */
  branch: string | null;
  /** True when Git has a commit checked out rather than a branch. */
  detached: boolean;
  /** The batch in Execute, and null when Execute is empty. */
  executing: string | null;
  counts: Record<Stage, number>;
  /** ISO 8601 of the newest item file, or null for an empty session. */
  lastChange: string | null;
  /** The newest of the agents' moments and `lastChange`; null when there is none. */
  activity: Activity | null;
  /**
   * Why the row cannot be read or its board served: another tracked worktree
   * already owns this key, the session or Git could not be read, or its
   * `meta/epic` breaks the rules; null when nothing stands in the way.
   */
  conflict: string | null;
  agents: AgentsSummary;
  /** Trailers on this worktree's unpushed commits that could not be acted on. */
  trailerProblems: readonly TrailerProblem[];
  /**
   * The epic this worktree is in: the name its session's `meta/epic` holds,
   * or null when it names none. The index never draws a main worktree in one.
   */
  epic: string | null;
  /** Whether this is its repository's main worktree, which Git lists first and the index pins above the epics. */
  main: boolean;
};

/**
 * The epic a worktree is in, as `POST /api/worktrees/<key>/epic` takes it and
 * answers it: an epic's name to put the worktree in, or null to take it out.
 */
export type WorktreeEpic = { epic: string | null };

export const WorktreeEpicSchema = Schema.Struct({
  epic: Schema.NullOr(Schema.String),
});

export const WorktreeSummarySchema = Schema.Struct({
  key: Schema.String,
  name: Schema.String,
  path: Schema.String,
  branch: Schema.NullOr(Schema.String),
  detached: Schema.Boolean,
  executing: Schema.NullOr(Schema.String),
  counts: Schema.Struct({
    Triage: Schema.Int,
    Design: Schema.Int,
    Batch: Schema.Int,
    Queue: Schema.Int,
    Execute: Schema.Int,
  }),
  lastChange: Schema.NullOr(Schema.String),
  activity: Schema.NullOr(ActivitySchema),
  conflict: Schema.NullOr(Schema.String),
  agents: AgentsSummarySchema,
  trailerProblems: Schema.Array(TrailerProblemSchema),
  epic: Schema.NullOr(Schema.String),
  main: Schema.Boolean,
});

/** The result of asking the daemon to focus a session's terminal. */
export type FocusResult = { ok: true } | { ok: false; reason: string };

export const FocusResultSchema = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true) }),
  Schema.Struct({ ok: Schema.Literal(false), reason: Schema.String }),
]);

/**
 * The result of asking the daemon for a terminal in a worktree: whether cmux
 * did it, and what cmux printed either way, so a refusal is in cmux's words.
 */
export type TerminalResult = { ok: boolean; line: string };

export const TerminalResultSchema = Schema.Struct({
  ok: Schema.Boolean,
  line: Schema.String,
});
