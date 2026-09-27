import { Schema, SchemaGetter, SchemaTransformation } from 'effect';

/* eslint-disable max-lines -- The one wire contract: every shape the server and the browser exchange is a schema here, and its type is that schema's, so neither side can read a shape the other does not write. */

/*
 * Every noun here is a schema, and its type is the schema's `Type`, never
 * written beside it: `bun run lint` refuses a type in this file that is not
 * `typeof <Name>Schema.Type`. A struct's fields are listed in the order the
 * daemon builds its answer, since an answer is encoded through its schema and
 * a struct is written in its fields' order.
 */

/**
 * The stages by name, in the flow's order. A name is written the same way in
 * the files, the CLI and the board, and the order is the lanes' order.
 */
export const stageNames = ['Triage', 'Design', 'Batch', 'Queue', 'Execute'] as const;

/** A stage, by its name. */
export const StageSchema = Schema.Literals(stageNames);
export type Stage = typeof StageSchema.Type;

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
export const BatchedStageSchema = Schema.Literals(['Queue', 'Execute']);
type BatchedStage = typeof BatchedStageSchema.Type;
export const isBatchedStage: (stage: Stage) => stage is BatchedStage = Schema.is(BatchedStageSchema);

/** One item, as its file holds it. */
export const ItemSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  body: Schema.String,
  /** The card's line: the text of the body's first paragraph, as a reader sees it; empty when it has none. */
  summary: Schema.String,
  /**
   * The group the item belongs to: the name of the directory its file sits in
   * inside the stage. Always set in Queue and Execute, where the group is the
   * batch; null for an item filed directly in Triage, Design or Batch.
   */
  group: Schema.NullOr(Schema.String),
  /** The item's file, relative to the session root: `1-Triage/010-BE-1.md`, `1-Triage/020-Name/010-BE-2.md` or `4-Queue/010-Name/010-BE-3.md`. */
  path: Schema.String,
});
export type Item = typeof ItemSchema.Type;

/** A stage is a directory of numbered item files and group directories. */
export const StageFileSchema = Schema.Struct({
  stage: StageSchema,
  /** Absolute path of the stage's directory, such as `…/.session/1-Triage`. */
  path: Schema.String,
  /** In file order, which is card order: a group's items are consecutive, in its directory's order. */
  items: Schema.Array(ItemSchema).pipe(Schema.mutable),
});
export type StageFile = typeof StageFileSchema.Type;

/** What a worktree has checked out, as Git lists it. */
export const CheckoutSchema = Schema.Struct({
  /** The branch checked out; null on a detached HEAD, and outside Git. */
  branch: Schema.NullOr(Schema.String),
  /** True when Git has a commit checked out rather than a branch. */
  detached: Schema.Boolean,
});
export type Checkout = typeof CheckoutSchema.Type;

/** The user's standing rules for the session, a file at its root that nothing scaffolds. */
export const rulesFile = 'RULES.md';

/** A session as the engine loads it: its stages and their items, as one revision of the files. */
export const SessionSchema = Schema.Struct({
  /** The session's directory, absolute: `…/<worktree>/.session`. */
  directory: Schema.String,
  /** A digest of every item file's path and content, which a write names, so one made on an older read is refused. */
  revision: Schema.String,
  stages: Schema.Array(StageFileSchema).pipe(Schema.mutable),
  /** Whether the session holds `RULES.md`. */
  rules: Schema.Boolean,
  /** The worktree the session is in, which a board's read names and the CLI's leaves out. */
  worktree: Schema.optionalKey(Schema.Struct({
    name: Schema.String,
    path: Schema.String,
    ...CheckoutSchema.fields,
  })),
});
export type Session = typeof SessionSchema.Type;

/**
 * One entry of the session's ledger: something another agent, or the user,
 * must know to act correctly here and would not learn from the items. Entries
 * are files under `ledger/`, written once and never edited; the fields are the
 * file's frontmatter, and the name is derived from `date` and `title`.
 */
export const LedgerEntrySchema = Schema.Struct({
  /** The file's name, e.g. `2026-09-23 14-02-11Z — Pivot to per-item evidence.md`. */
  name: Schema.String,
  /** `ledger/<name>`, relative to the session root. */
  path: Schema.String,
  /** When it was written: ISO 8601 in UTC, to the second. */
  date: Schema.String,
  title: Schema.String,
  /** Who wrote it: `claude <session id>`, `codex <thread id>`, or a person's name. */
  by: Schema.String,
  /**
   * The Git branch it was written on. Null when the entry names none, as
   * `session log` leaves it out outside a repository or on a detached HEAD.
   */
  branch: Schema.NullOr(Schema.String),
  /**
   * The commit HEAD named when it was written, abbreviated. Null when the entry
   * names none, as outside a repository or before the first commit.
   */
  commit: Schema.NullOr(Schema.String),
  /** The batch Execute was running when it was written; null when the entry names none, as while Execute was empty. */
  batch: Schema.NullOr(Schema.String),
  /** The Markdown after the frontmatter, trimmed; it may be empty and holds no headings. */
  body: Schema.String,
});
export type LedgerEntry = typeof LedgerEntrySchema.Type;

/** The ledger as the board reads it. */
export const LedgerListingSchema = Schema.Struct({
  /** Newest first by date, then by name. */
  entries: Schema.Array(LedgerEntrySchema),
  /** One line per file in `ledger/` that breaks the ledger's rules and is left out; `session check` names the fix. */
  notices: Schema.Array(Schema.String),
});
export type LedgerListing = typeof LedgerListingSchema.Type;

/** One file or directory under the session's `context/`, where agents keep supporting material. */
export const ContextEntrySchema = Schema.Struct({
  /** Relative to the session root: `context/SES-1/design.md`, or `context/SES-1` for a directory. */
  path: Schema.String,
  kind: Schema.Literals(['file', 'directory']),
  /** When it was last written: its modification time, ISO 8601 in UTC. */
  writtenAt: Schema.String,
});
export type ContextEntry = typeof ContextEntrySchema.Type;

/** `context/` as the board reads it. */
export const ContextListingSchema = Schema.Struct({
  /**
   * Every file and directory under `context/`, depth first: a directory comes
   * right before what it holds, and entries that share a directory are sorted
   * by name. Names starting with a dot are left out. A directory named
   * `archive` or `ignore` here is ordinary; only a link into the root's
   * `archive/` or `ignore/` is left out, as `refresh` leaves it out.
   */
  entries: Schema.Array(ContextEntrySchema),
  /** One line per entry that is left out for a reason worth saying, such as a link that leads outside the session. */
  notices: Schema.Array(Schema.String),
});
export type ContextListing = typeof ContextListingSchema.Type;

/**
 * One file under `archive/`, read from its name: the day it was filed, the
 * item, its title, and the state it left in. A name that is not exactly one the
 * engine writes is listed as it is, with all four null.
 */
export const ArchiveRecordSchema = Schema.Struct({
  name: Schema.String,
  /** `archive/<name>`, relative to the session root. */
  path: Schema.String,
  /** The day it was filed, `2026-09-13`; null when the name is not one the engine writes. */
  date: Schema.NullOr(Schema.String),
  id: Schema.NullOr(Schema.String),
  title: Schema.NullOr(Schema.String),
  /** `done` for finished work, or the lowercase stage it was filed from, such as `triage`. */
  state: Schema.NullOr(Schema.String),
});
export type ArchiveRecord = typeof ArchiveRecordSchema.Type;

/** `archive/` as the board reads it. */
export const ArchiveListingSchema = Schema.Struct({
  /** Newest first by date, then by name; names without a date come last, by name. Directories are not listed. */
  records: Schema.Array(ArchiveRecordSchema),
});
export type ArchiveListing = typeof ArchiveListingSchema.Type;

/**
 * The events a page's stream can carry, by the name each is written under. A
 * page names the ones it reads, and its stream carries only those: the daemon
 * re-reads some sources only while a page is listening for them.
 *
 * - `changed`: a file under the worktree's `.session` was written; on the
 *   root's stream, under any tracked worktree's, which is what an epic's or a
 *   project's page follows
 * - `agents`: the Claude Code registry or a Codex writer lock changed
 * - `trailers`: the unpushed commits' trailer problems changed
 * - `links`: gh or linear was asked about the worktree's links again
 * - `worktrees`: the set of tracked worktrees changed, a trailer report
 *   changed, or a tracked worktree's `.session` changed where a row shows it:
 *   its items, its epic or its rank
 * - `pull-requests`: gh was asked about a tracked worktree's pull request again
 */
export const StreamEventSchema = Schema.Literals(['changed', 'agents', 'trailers', 'links', 'worktrees', 'pull-requests']);
export type StreamEvent = typeof StreamEventSchema.Type;

/**
 * The events a page names in its stream's address, `?events=changed,agents`:
 * their names, joined by commas, and none for an empty list. A name the
 * daemon has no event for still reads as a name, which the stream says it does
 * not carry.
 */
export const StreamEventNamesSchema = Schema.String.pipe(
  Schema.decodeTo(
    Schema.Array(Schema.String),
    SchemaTransformation.transform<ReadonlyArray<string>, string>({
      decode: (names) => (names === '' ? [] : names.split(',')),
      encode: (names) => names.join(','),
    }),
  ),
);

/**
 * What an event carries beside its name: nothing, since an event only says that
 * the answer it names changed and a page reads that answer again. A stream
 * delivers no event without a line of data, so each carries this empty one.
 */
export const StreamPayloadSchema = Schema.Struct({});

/** The one daemon per user listens here; `session open` upserts it. */
export const daemonPort = 53045;

/**
 * A path as an address carries it: each segment URI-encoded, with the slashes
 * between them kept, so a name or a path that holds a slash is still read as
 * its segments. A worktree's key under `/w/` and a file's path under a board's
 * `files/` are both written this way, and decoding one decodes every segment.
 */
export const AddressPathSchema = Schema.String.pipe(
  Schema.decodeTo(
    Schema.String,
    new SchemaTransformation.Transformation(
      SchemaGetter.decodeUriComponent<string>(),
      SchemaGetter.transform((path: string) => path.split('/').map((segment) => encodeURIComponent(segment)).join('/')),
    ),
  ),
);

/**
 * A worktree's key under `/w/`: its name, encoded segment by segment, so a
 * nested name (`email-backend/Heartbeat`) still addresses one board. The daemon
 * routes a board by it, the CLI prints it, and a board's pages reach their API
 * through it, so all three spell it with this one function.
 */
export const encodeWorktreeKey = (name: string): string => Schema.encodeSync(AddressPathSchema)(name);

/** Who the daemon is, which the CLI recognises a running daemon by. */
export const DaemonInfoSchema = Schema.Struct({
  pid: Schema.Int,
  port: Schema.Int,
  /** ISO 8601. */
  startedAt: Schema.String,
  /** Newest mtime across the server, contract, dist and CLI sources the daemon was started from. */
  sourceStamp: Schema.String,
});
export type DaemonInfo = typeof DaemonInfoSchema.Type;

/**
 * What `GET /api/daemon` reports beside who the daemon is: what it can do for a
 * page. It is its own shape because the CLI recognises a running daemon by
 * `DaemonInfo` alone, and one started from older sources, which reports none of
 * this, must still be recognised in order to be replaced.
 */
export const DaemonCapabilitiesSchema = Schema.Struct({
  /** Whether `cmux` is on the daemon's PATH, which is what the terminal action runs. */
  terminal: Schema.Boolean,
  /** Whether `zed` is on the daemon's PATH, which is what the Zed action runs. */
  zed: Schema.Boolean,
});
export type DaemonCapabilities = typeof DaemonCapabilitiesSchema.Type;

/** What `GET /api/daemon` answers: who the daemon is, and what it can do for a page. */
export const DaemonDescriptionSchema = Schema.Struct({ ...DaemonInfoSchema.fields, ...DaemonCapabilitiesSchema.fields });
export type DaemonDescription = typeof DaemonDescriptionSchema.Type;

/**
 * The tokens in a session's context as its last reply left them, from the
 * `usage` on the last assistant line of its transcript. No window size is
 * recorded there or in the listing, so it is a count and never a share.
 */
export const ContextFillSchema = Schema.Struct({
  /**
   * `input_tokens` + `cache_creation_input_tokens` + `cache_read_input_tokens`
   * of that usage, the count Claude Code's own status line works from.
   */
  tokens: Schema.Finite,
  /** The transcript the line was read from, `<config>/projects/<key>/<sessionId>.jsonl`. */
  transcript: Schema.String,
  /** ISO 8601 of the line's `timestamp`; null when it carries none. */
  lineAt: Schema.NullOr(Schema.String),
});
export type ContextFill = typeof ContextFillSchema.Type;

/** The cmux refs that name one panel: the surface, and where it is docked. */
export const TerminalSchema = Schema.Struct({
  surface: Schema.String,
  workspace: Schema.String,
  window: Schema.String,
});
export type Terminal = typeof TerminalSchema.Type;

/**
 * One Claude Code session under a worktree, as Claude Code's own listing
 * (`claude agents --json`) reports it. Strings the harness may extend (`kind`,
 * `status`, `state`) are carried raw; the board renders what it is given and
 * never maps an unknown value into a known one.
 */
export const ClaudeSessionSchema = Schema.Struct({
  /** `interactive` or `background` today. */
  kind: Schema.String,
  /** Null for a background session whose process is not running. */
  pid: Schema.NullOr(Schema.Int),
  sessionId: Schema.NullOr(Schema.String),
  /** The listing's `id` of a background session; the handle for `claude attach`. */
  backgroundId: Schema.NullOr(Schema.String),
  /**
   * The listing's `name`: the one given with `/rename` or `--name`, else the
   * `<folder>-<two hex>` Claude Code makes for a session nobody named.
   */
  name: Schema.NullOr(Schema.String),
  /**
   * Where the name came from, as the registry records it: `derived` for the
   * name Claude Code made from the folder, `user` for one given with `/rename`
   * or `--name`, and whatever else it writes carried raw; null when a live
   * session's registry file cannot be read or holds none, and for a session
   * with no process, which has no registry file.
   */
  nameSource: Schema.NullOr(Schema.String),
  /** `busy`, `shell`, `idle`, `waiting`; null when the listing gives none. */
  status: Schema.NullOr(Schema.String),
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
  state: Schema.NullOr(Schema.String),
  /**
   * Why a session is waiting on a person: the reason while `status` is
   * `waiting`, e.g. `permission prompt`, or the open prompt a `blocked`
   * session's live process is holding.
   */
  waitingFor: Schema.NullOr(Schema.String),
  /** ISO 8601. */
  startedAt: Schema.String,
  /**
   * ISO 8601 of when the status last changed: the registry's
   * `statusUpdatedAt`, and null when the registry file cannot be read or holds
   * none. It is an event time, not a heartbeat: an old one means the session
   * has held the same status for a while, never that it is stale or gone.
   */
  statusChangedAt: Schema.NullOr(Schema.String),
  /**
   * What is in a live session's context, read from the tail of its
   * transcript; null for a session with no process, and for one whose
   * transcript cannot be found or read or whose tail holds no reply.
   */
  context: Schema.NullOr(ContextFillSchema),
  /** The cmux refs holding this pid, or null when it runs in no cmux tab (a normal state). */
  terminal: Schema.NullOr(TerminalSchema),
  /** `claude --resume <sessionId>` or `claude attach <id>`; null when neither handle exists. */
  resume: Schema.NullOr(Schema.String),
});
export type ClaudeSession = typeof ClaudeSessionSchema.Type;

/** One Codex thread under a worktree, from `thread/list`; newest first. */
export const CodexThreadSchema = Schema.Struct({
  /** UUID from the listing; the only id ever placed in a link. */
  id: Schema.String,
  /** The thread's name, else its preview. */
  name: Schema.String,
  /** `Desktop`, `CLI` or `app-server`. */
  origin: Schema.String,
  /** ISO 8601 of the thread's recency. */
  updatedAt: Schema.String,
  /** True when a live process holds the thread's writer lock; null when that could not be read. Never turn status. */
  loaded: Schema.NullOr(Schema.Boolean),
  /** `codex://threads/<id>`. */
  link: Schema.String,
  /** `codex resume <id>`, offered only while the thread is not loaded elsewhere. */
  resume: Schema.NullOr(Schema.String),
});
export type CodexThread = typeof CodexThreadSchema.Type;

/** The agents overlay for one worktree: read-only, recomputed on demand, never persisted. */
export const AgentsSummarySchema = Schema.Struct({
  claude: Schema.Array(ClaudeSessionSchema),
  /** At most the newest three. */
  codex: Schema.Array(CodexThreadSchema),
  /** Why a source is missing, e.g. `Codex not available`; one line each, empty when all sources answered. */
  notices: Schema.Array(Schema.String),
  /** ISO 8601 of the listing. */
  fetchedAt: Schema.String,
});
export type AgentsSummary = typeof AgentsSummarySchema.Type;

/**
 * When a worktree last did something, and what did it: `claude` is a Claude
 * Code session's status change, `codex` a Codex thread's update, `items` an
 * item file written. A moment dates activity and nothing more: no time here is
 * a heartbeat, and none of them says a session is still alive.
 */
export const ActivitySchema = Schema.Struct({
  at: Schema.String,
  kind: Schema.Literals(['claude', 'codex', 'items']),
});
export type Activity = typeof ActivitySchema.Type;

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
export const TrailerProblemSchema = Schema.Struct({
  /** Full hash of the commit carrying the trailer. */
  commit: Schema.String,
  /** The commit's subject line. */
  subject: Schema.String,
  /** The id the line named. */
  id: Schema.String,
  kind: Schema.Literals(['unknown', 'outside-trailers', 'close-failed']),
  /** What the engine said, for `close-failed`; null otherwise. */
  detail: Schema.NullOr(Schema.String),
});
export type TrailerProblem = typeof TrailerProblemSchema.Type;

/**
 * The pull request `gh pr view` reports for a worktree's branch. `state` and
 * `reviewDecision` are gh's own words, carried unmapped.
 */
export const PullRequestSchema = Schema.Struct({
  number: Schema.Int,
  url: Schema.String,
  title: Schema.String,
  state: Schema.Literals(['OPEN', 'MERGED', 'CLOSED']),
  isDraft: Schema.Boolean,
  /** `APPROVED`, `CHANGES_REQUESTED` or `REVIEW_REQUIRED` as gh gives it; null when gh gives none. */
  reviewDecision: Schema.NullOr(Schema.String),
  /**
   * The head commit's checks, counted from gh's `statusCheckRollup`. A check
   * run passed when it completed with `SUCCESS`, `NEUTRAL` or `SKIPPED` and
   * failed when it completed any other way; a commit status, which carries only
   * a `state`, passed on `SUCCESS` and failed on `FAILURE` or `ERROR`.
   * Everything else is pending.
   */
  checks: Schema.Struct({
    passed: Schema.Int,
    failed: Schema.Int,
    pending: Schema.Int,
  }),
});
export type PullRequest = typeof PullRequestSchema.Type;

/** One Linear issue a worktree names, as the `linear` CLI reports it. */
export const LinearIssueSchema = Schema.Struct({
  /** The identifier, e.g. `HEA-5454`. */
  id: Schema.String,
  url: Schema.String,
  title: Schema.String,
  /** The CLI's state name, unmapped. */
  state: Schema.String,
});
export type LinearIssue = typeof LinearIssueSchema.Type;

/**
 * What gh reported about a worktree's branch, and when it was asked. One
 * answer serves the index, which shows it on the worktree's row, and a board,
 * which shows it beside the issues.
 */
export const PullRequestReportSchema = Schema.Struct({
  /** Null when the branch has no pull request, when the worktree is on no branch, and when gh did not answer. */
  pr: Schema.NullOr(PullRequestSchema),
  /** The sentence saying why gh did not answer; null when it did. */
  notice: Schema.NullOr(Schema.String),
  /** ISO 8601 of when gh was asked. */
  reportedAt: Schema.String,
});
export type PullRequestReport = typeof PullRequestReportSchema.Type;

/** What linear reported about the issues a worktree names, and when it was asked. */
export const IssuesReportSchema = Schema.Struct({
  /**
   * The issues the branch and its pull request's title and body name, in the
   * order first named, each one confirmed by `linear issue view`; empty when
   * they name none and when linear could not say, which the notice then names.
   */
  issues: Schema.Array(LinearIssueSchema),
  /** The sentence saying why linear did not answer; null when it did. */
  notice: Schema.NullOr(Schema.String),
  /** ISO 8601 of when linear was asked. */
  reportedAt: Schema.String,
});
export type IssuesReport = typeof IssuesReportSchema.Type;

/**
 * Where a worktree's work lives outside its files: the pull request for its
 * branch and the issues it names, read from the tools that know when they are
 * asked, and never persisted. Each is dated by its own ask, because gh is
 * asked for the index as well, and linear only for a board.
 */
export const LinksSchema = Schema.Struct({
  pullRequest: PullRequestReportSchema,
  issues: IssuesReportSchema,
});
export type Links = typeof LinksSchema.Type;

/**
 * The index's pull requests: gh's last report for each tracked worktree, by
 * the worktree's path. A worktree gh has not been asked about yet is absent,
 * and so is one the index lists as not served.
 */
export const PullRequestReportsSchema = Schema.Record(Schema.String, PullRequestReportSchema);
export type PullRequestReports = typeof PullRequestReportsSchema.Type;

/**
 * The repository a worktree belongs to, as Git names it for every worktree of
 * it: by what Git lists first for it, its main worktree, which holds the
 * repository, or the Git directory the worktrees share, which Git lists in the
 * main worktree's place when there is none, as in a bare repository, and when
 * the directory is kept apart from it, as a submodule's or a separate one is.
 * Every row of one repository carries the same one, read in the same listing
 * as the row's own branch, so the index heads each repository's section with
 * it whether or not a session is there.
 */
export const RepositorySchema = Schema.Struct({
  /** The name of what Git lists first, its folder's, which names the repository. */
  name: Schema.String,
  /** Where that is, which tells the repository from every other. */
  path: Schema.String,
  /**
   * Whether Git lists the repository's Git directory first, where a main
   * worktree would be: a bare repository's, which Git marks bare, and the Git
   * directory of a submodule or a separate one, which it lists in the main
   * worktree's place unmarked. That directory is no worktree and holds no
   * session, so the index heads the repository with its name alone: always
   * for a bare repository, and for a submodule or a separate Git directory
   * until the daemon tracks its main worktree, which `session open` there
   * does. That worktree's row heads it then, under its own name.
   */
  bare: Schema.Boolean,
  /**
   * What the listing says is checked out there, which the index shows for a
   * main worktree; null when Git could not list the repository, which each of
   * its rows says in place of its own branch.
   */
  checkout: Schema.NullOr(CheckoutSchema),
});
export type Repository = typeof RepositorySchema.Type;

/**
 * A worktree's rank among its siblings, as its `meta/rank` holds it: a
 * non-negative integer, small enough to be counted exactly.
 */
export const RankSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

/** One row of the index: a tracked worktree and what its session holds. */
export const WorktreeSummarySchema = Schema.Struct({
  /** Route segment(s) under `/w/`: the worktree name, e.g. `Heartbeat` or `email-backend/Heartbeat`. */
  key: Schema.String,
  name: Schema.String,
  path: Schema.String,
  ...CheckoutSchema.fields,
  agents: AgentsSummarySchema,
  /** Trailers on this worktree's unpushed commits that could not be acted on. */
  trailerProblems: Schema.Array(TrailerProblemSchema),
  /**
   * The epic this worktree is in: the name its session's `meta/epic` holds,
   * or null when it names none, and when the file breaks the rules. The index
   * never draws a main worktree in one.
   */
  epic: Schema.NullOr(Schema.String),
  /**
   * Why `meta/epic` could not be read as an epic's name, in the sentence
   * `session check` gives with its fix; null when the file is sound or absent.
   * The row is served all the same, in no epic.
   */
  epicProblem: Schema.NullOr(Schema.String),
  /**
   * The rank its session's `meta/rank` holds, which places it among its
   * siblings: a main worktree's orders its project among the projects, and
   * any other worktree's orders it among the worktrees of its epic, ranked
   * ones first. Null when it has none, and when the file breaks the rules.
   */
  rank: Schema.NullOr(RankSchema),
  /**
   * Why `meta/rank` could not be read as a rank, in the sentence `session
   * check` gives with its fix; null when the file is sound or absent. The row
   * is served all the same, unranked.
   */
  rankProblem: Schema.NullOr(Schema.String),
  /** Whether this is its repository's main worktree, the one whose Git directory is the repository's own: the index draws it at the head of the repository's section. */
  main: Schema.Boolean,
  /**
   * Whether Git answered where the worktree is. False for a path the daemon
   * holds but Git could not be asked about, or would not answer for, as when
   * it cannot run: its `conflict` is Git's line, and nothing only Git could
   * say is known of it, so it is not `main`, names no repository and is no
   * folder outside Git either. The index names it in a notice rather than
   * drawing it in a section, until a take-on or a rescan asks again.
   */
  resolved: Schema.Boolean,
  /** The repository the worktree belongs to, named by what Git lists first for it; null for a folder outside Git, which the index gives a section of its own. */
  repository: Schema.NullOr(RepositorySchema),
  /** The batch in Execute, and null when Execute is empty. */
  executing: Schema.NullOr(Schema.String),
  counts: Schema.Struct({
    Triage: Schema.Int,
    Design: Schema.Int,
    Batch: Schema.Int,
    Queue: Schema.Int,
    Execute: Schema.Int,
  }),
  /** ISO 8601 of the newest item file, or null for an empty session. */
  lastChange: Schema.NullOr(Schema.String),
  /** The newest of the agents' moments and `lastChange`; null when there is none. */
  activity: Schema.NullOr(ActivitySchema),
  /**
   * Why the row's board is not served: another tracked worktree already owns
   * this key, or its session or Git could not be read; null when it is served.
   */
  conflict: Schema.NullOr(Schema.String),
});
export type WorktreeSummary = typeof WorktreeSummarySchema.Type;

/**
 * What `POST /api/worktrees/epic` takes: the worktree by its path, as
 * `/api/terminal` takes it, so no row is ever out of reach and no key shared
 * by two rows can route a write to the wrong one; the epic to put it in, or
 * null for none; and the epic the index last read for it. A file that names
 * anything else by then refuses the write, as a stale revision refuses a move.
 * A worktree that is not a main one loses its rank with any change of epic.
 */
export const EpicWriteSchema = Schema.Struct({
  path: Schema.String,
  epic: Schema.NullOr(Schema.String),
  from: Schema.NullOr(Schema.String),
});
export type EpicWrite = typeof EpicWriteSchema.Type;

/**
 * What `POST /api/worktrees/rename` takes: the epic by its name, and the
 * name it takes. The daemon moves every tracked worktree in it, and tells from
 * the worktrees it tracks whether the name is new, when each keeps its rank,
 * or another epic's, when they merge and arrive unranked.
 */
export const EpicRenameSchema = Schema.Struct({
  from: Schema.String,
  to: Schema.String,
});
export type EpicRename = typeof EpicRenameSchema.Type;

/** What the rename route answers: the epic's name now, and whether it merged into one that had it. */
export const EpicRenamedSchema = Schema.Struct({
  epic: Schema.String,
  merged: Schema.Boolean,
});
export type EpicRenamed = typeof EpicRenamedSchema.Type;

/** What the epic route answers: the epic the worktree is in now. */
export const WorktreeEpicSchema = Schema.Struct({
  epic: Schema.NullOr(Schema.String),
});
export type WorktreeEpic = typeof WorktreeEpicSchema.Type;

/**
 * What `POST /api/worktrees/order` takes: the worktree by its path, as the
 * epic route takes it; the ranked sibling it goes before, by its path, or
 * null; and the unranked siblings drawn above the place it was dropped, in
 * their drawn order, which are ranked first so it lands where it was dropped,
 * right after them. With neither it goes last among the ranked ones; a
 * placement names one or the other, never both.
 */
export const OrderWriteSchema = Schema.Struct({
  path: Schema.String,
  before: Schema.NullOr(Schema.String),
  after: Schema.Array(Schema.String),
});
export type OrderWrite = typeof OrderWriteSchema.Type;

/** What the order route answers: the rank the worktree holds now. */
export const WorktreeRankSchema = Schema.Struct({
  rank: RankSchema,
});
export type WorktreeRank = typeof WorktreeRankSchema.Type;

/**
 * What `POST /api/move` takes: the item, the stage it goes to, and where in
 * it, with the revision the page read.
 */
export const MoveItemSchema = Schema.Struct({
  id: Schema.String,
  to: StageSchema,
  /** The item it goes in front of, in its group or in none, as the item goes. */
  beforeId: Schema.NullOr(Schema.String).pipe(Schema.optionalKey),
  /** A group the item, landing in no group, goes in front of; given instead of `beforeId`. */
  beforeGroup: Schema.NullOr(Schema.String).pipe(Schema.optionalKey),
  /** The drop target's group, or null for none; left out, as `session mv` leaves it out. */
  group: Schema.NullOr(Schema.String).pipe(Schema.optionalKey),
  revision: Schema.String,
});
export type MoveItem = typeof MoveItemSchema.Type;

/** What `POST /api/group` takes: items of one flat stage, gathered into the group of that name. */
export const GroupItemsSchema = Schema.Struct({
  ids: Schema.Array(Schema.String),
  name: Schema.String,
  /**
   * One of `ids`, in no group, gathered first and in whose place a group the
   * stage does not hold yet starts, numbered as its file was, as a card
   * dropped on another on the board starts one where that card stood; left
   * out, the group starts at the end of the stage, as `session group` starts
   * one. A group the stage holds keeps its place either way.
   */
  at: Schema.String.pipe(Schema.optionalKey),
  revision: Schema.String,
});
export type GroupItems = typeof GroupItemsSchema.Type;

/** What `POST /api/ungroup` takes: items taken out of their groups. */
export const UngroupItemsSchema = Schema.Struct({
  ids: Schema.Array(Schema.String),
  revision: Schema.String,
});
export type UngroupItems = typeof UngroupItemsSchema.Type;

/** What `POST /api/batch` takes: Batch items, queued as the batch of that name. */
export const QueueBatchSchema = Schema.Struct({
  ids: Schema.Array(Schema.String),
  name: Schema.String,
  revision: Schema.String,
});
export type QueueBatch = typeof QueueBatchSchema.Type;

/** What `POST /api/start` takes: the revision the first queued batch starts on. */
export const StartBatchSchema = Schema.Struct({
  revision: Schema.String,
});
export type StartBatch = typeof StartBatchSchema.Type;

/** What `POST /api/complete` takes: the Execute item completed. */
export const CompleteItemSchema = Schema.Struct({
  id: Schema.String,
  revision: Schema.String,
});
export type CompleteItem = typeof CompleteItemSchema.Type;

/**
 * Every write a board makes to its records, by its route, with the body each
 * takes. Each answers the session as the write left it, and the board and the
 * item page send them through this one table.
 */
export const sessionWrites = {
  '/api/move': MoveItemSchema,
  '/api/group': GroupItemsSchema,
  '/api/ungroup': UngroupItemsSchema,
  '/api/batch': QueueBatchSchema,
  '/api/start': StartBatchSchema,
  '/api/complete': CompleteItemSchema,
} as const;

/** What `POST /api/agents/focus` takes: the session by its process. */
export const FocusSessionSchema = Schema.Struct({
  pid: Schema.Int,
});

/**
 * A worktree by its path, which is how the terminal and Zed routes take it,
 * and how `session` asks the daemon to take one on at
 * `POST /api/worktrees/refresh`.
 */
export const WorktreePathSchema = Schema.Struct({
  path: Schema.String,
});

/** The result of asking the daemon to focus a session's terminal. */
export const FocusResultSchema = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true) }),
  Schema.Struct({ ok: Schema.Literal(false), reason: Schema.String }),
]);
export type FocusResult = typeof FocusResultSchema.Type;

/**
 * The result of asking the daemon to open a worktree in cmux or in Zed:
 * whether the tool did it, and what it printed either way, so a refusal is in
 * the tool's own words.
 */
export const OpenResultSchema = Schema.Struct({
  ok: Schema.Boolean,
  line: Schema.String,
});
export type OpenResult = typeof OpenResultSchema.Type;

/** What the daemon answers when it refuses a request: the sentence that says why. */
export const RefusalSchema = Schema.Struct({
  error: Schema.String,
});

/**
 * A content hash for every file an agent's refresh reads, by its path under
 * the session: SHA-256, in hex.
 */
export const FileInventorySchema = Schema.Record(Schema.String, Schema.String);
export type FileInventory = typeof FileInventorySchema.Type;

/** An entry a refresh could not take into the inventory, and why. */
export const SkippedEntrySchema = Schema.Struct({
  path: Schema.String,
  reason: Schema.String,
});
export type SkippedEntry = typeof SkippedEntrySchema.Type;

/**
 * What `session refresh` prints: the session's directory, its inventory, what
 * changed since the inventory `--previous` names, and what could not be taken
 * in. `refresh --previous` reads the inventory of an earlier one.
 */
export const RefreshSchema = Schema.Struct({
  directory: Schema.String,
  inventory: FileInventorySchema,
  changes: Schema.Struct({
    added: Schema.Array(Schema.String),
    changed: Schema.Array(Schema.String),
    deleted: Schema.Array(Schema.String),
  }),
  skipped: Schema.Array(SkippedEntrySchema),
});
