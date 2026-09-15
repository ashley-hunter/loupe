// The domain model. These names are the ones the interface uses too, so a rename
// here is a rename in both places.

/** Identifies a Session. Never interchangeable with a RequestId. */
export type SessionId = string & { readonly __brand: 'SessionId' };
/** Identifies a Request. Never interchangeable with a SessionId. */
export type RequestId = string & { readonly __brand: 'RequestId' };

/**
 * Token counts for one Request.
 *
 * A Request writes one Transcript record per content block and repeats its usage
 * on every one of them, so these are only ever read from a Request's *last*
 * record. Summing across records overcounts by roughly 1.82x.
 */
export interface Usage {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  thinking: number;
}

export type InvalidationCause =
  /** The gap since the previous Request exceeded the cache lifetime. */
  | 'expiry'
  /** A different model was used, so the prefix could not be reused. */
  | 'model-change'
  /**
   * The context was compacted: it did not move, it shrank. A 1M context
   * replaced by 54k is the cache working, not waste, so this is never a
   * Finding and never counted as avoidable.
   */
  | 'compaction'
  /**
   * The prefix was rebuilt while the Session was active and the context as a
   * whole was preserved — the same tokens, re-split between read and written.
   * Happens as a conversation grows large, with gaps far too short to be
   * Expiry. Mechanical, not something done wrong.
   */
  | 'reanchor'
  /** None of the above could be established. Reported as-is, never guessed at. */
  | 'undetermined';

/** A point where a Request rebuilt the cached prefix instead of reading it. */
export interface Invalidation {
  sessionId: SessionId;
  sessionName: string;
  project: string;
  /** The repository behind the project, so worktrees group together. */
  repo: string;
  at: string;
  cause: InvalidationCause;
  /** Tokens written to rebuild the prefix. */
  rewritten: number;
  /** Gap since the previous Request — the thing that causes Expiry. */
  idleMs: number;
  detail?: string;
}

export const EMPTY_USAGE: Usage = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, thinking: 0 };

/**
 * New tokens: everything sent or produced that was not served from cache.
 *
 * This is the only honest "total" for a Session. `cacheRead` must never be added
 * into it — every Request re-reads the whole prefix, so summing cacheRead across
 * a Session counts the same tokens once per Request (21M for a 172-Request
 * Session). Report cacheRead on its own, never inside a total.
 */
export const newTokens = (u: Usage): number => u.input + u.cacheWrite + u.output;

/** What a Session cost in total: its own work and everything it delegated. */
export const totalNewTokens = (s: { usage: Usage; subagentUsage: Usage }): number =>
  newTokens(s.usage) + newTokens(s.subagentUsage);

/** Share of input that came from cache rather than being rewritten. 0..1, or null when there was no input at all. */
export function cacheHitRate(u: Usage): number | null {
  const total = u.cacheRead + u.cacheWrite + u.input;
  return total === 0 ? null : u.cacheRead / total;
}

export type EventKind =
  | 'user'
  | 'asst'
  | 'think'
  | 'read'
  | 'edit'
  | 'bash'
  | 'grep'
  | 'web'
  | 'mcp'
  | 'agent'
  | 'tool'
  | 'compact'
  | 'model'
  | 'config'
  /**
   * Context injected by Claude Code rather than asked for: a file re-sent after
   * an edit, the skill listing, hook output, an environment block. It is real
   * context that nobody typed and no tool returned, and until it had a kind of
   * its own it was the one thing in a Transcript the Timeline could not show.
   */
  | 'inject';

/** One entry in a Transcript — the unit the Timeline renders. */
export interface Event {
  id: string;
  kind: EventKind;
  /** ISO timestamp. */
  at: string;
  title: string;
  subtitle?: string;
  /** Tool result or message body, truncated for display. */
  body?: string;
  /** Nesting depth. 0 is the main Session, 1+ is inside a Subagent. */
  depth: number;
  /** The Request this Event belongs to, when it belongs to one. */
  request?: RequestId;
  /**
   * What this Event added to the context, in tokens. Null when it cannot be
   * Measured. When `sharedCost` is set, this figure covers every Event in the
   * group and must not be summed with its siblings.
   */
  cost: number | null;
  /** Set when several tool calls shared one Request and their costs cannot be split. */
  sharedCost?: boolean;
  /** Tool name, for Events that are tool calls. Rolled up by tool. */
  tool?: string;
  /** File path, for Events that read or wrote one. Rolled up by file. */
  path?: string;
  /** The `tool_use` id, when this Event is one. Links a Subagent to the call that spawned it. */
  toolUseId?: string;
  /** Tool failure, e.g. a non-zero exit code. */
  failed?: boolean;
  /**
   * Images this tool call returned.
   *
   * A screenshot comes back as an image block in the result and has no path, so
   * without this it is indistinguishable from any other tool call - which is
   * how 119 of them went uncounted while images read from disk were caught.
   */
  images?: number;
}

/** One round trip to the model. */
export interface Request {
  id: RequestId;
  at: string;
  model: string;
  usage: Usage;
  /** Number of tool calls this Request issued. 2+ means their costs are shared. */
  toolCalls: number;
  /** Cache writes made against the one-hour cache rather than the five-minute one. */
  oneHourWrite: number;
}

/**
 * The limits the usage endpoint reports.
 * - `session`       the rolling five-hour Block
 * - `weekly_all`    the seven-day account limit
 * - `weekly_scoped` the seven-day limit for one model
 */
export type LimitKind = 'session' | 'weekly_all' | 'weekly_scoped';

export interface Limit {
  kind: LimitKind;
  /** Percentage of the limit consumed, 0-100, as reported. */
  percent: number;
  /** When this window resets. Doubles as the Block boundary. */
  resetsAt: string | null;
  severity: string;
  /** Only `weekly_scoped` names a model. */
  model: string | null;
}

/** One reading of the Allowance, taken by the poller. */
export interface UsageSample {
  at: string;
  limits: Limit[];
}

/** A gap longer than this is someone walking away, not the Session running. */
export const IDLE_GAP_MS = 5 * 60 * 1000;

export type SessionStatus = 'completed' | 'active' | 'interrupted';

/** A Session as it appears in the sessions list. Cheap to build, cheap to cache. */
export interface SessionSummary {
  id: SessionId;
  /** Absolute path to the Transcript. */
  path: string;
  /** Derived from the Session's cwd. */
  project: string;
  /**
   * The repository the cwd belongs to, which is the project unless the Session
   * ran in a git worktree. Several worktrees of one repository are one place to
   * work, and grouping them apart would answer "where did this come from" with
   * the name of a branch.
   */
  repo: string;
  /** The Session's working directory. File paths are shown relative to it. */
  cwd: string;
  name: string;
  startedAt: string;
  endedAt: string;
  /** First Event to last Event. Spans idle time, so a resumed Session can span days. */
  spanMs: number;
  /**
   * Time actually worked: the gaps between consecutive Events, excluding any
   * gap longer than IDLE_GAP_MS. A Session left open overnight has a span of
   * days and an active time of minutes.
   */
  activeMs: number;
  /** Every model used, most-used first. */
  models: string[];
  prompts: number;
  toolCalls: number;
  /** How many Requests the Session made. The Requests themselves live on SessionDetail. */
  requestCount: number;
  usage: Usage;
  subagents: number;
  /**
   * What this Session's Subagents spent, which is not part of `usage`.
   *
   * A Subagent has its own context window and its own Transcript, so its cost
   * is real, separate, and easy to miss: measured across the Transcripts here,
   * Subagents are 52% of all new tokens, and the heaviest Session shows 27.6M
   * of its own against 138.4M spent by the 363 agents it delegated to.
   */
  subagentUsage: Usage;
  status: SessionStatus;
  /**
   * Share of the Block's rolling limit this Session consumed. Null for every
   * Session that ended before the app was installed: the reading simply does not
   * exist. Never estimated, and never summed across Sessions when
   * `allowanceShared` is set.
   */
  allowance: number | null;
  allowanceShared?: boolean;
  /** Weekly limit consumed across the Session's span, on the same terms as `allowance`. */
  weekly?: number | null;
}

/**
 * A delegated agent with its own context window.
 *
 * Claude Code writes one Transcript plus a `.meta.json` per Subagent under
 * `<session>/subagents/`. The meta names the agent and carries the `toolUseId`
 * of the Task call that spawned it, which is how a Subagent is tied to its
 * place in the parent's Timeline.
 */
export interface Subagent {
  id: string;
  /** "Explore", "general-purpose", and so on. */
  type: string;
  description: string;
  /** The parent Event that spawned this Subagent, if it is still in the Transcript. */
  toolUseId: string | null;
  /** 1 for a Subagent of the main Session, 2 for one it spawned in turn. */
  spawnDepth: number;
  model: string;
  usage: Usage;
  requestCount: number;
  toolCalls: number;
  durationMs: number;
}

export type FindingCategory = 'context' | 'duplication' | 'cache' | 'behaviour';

/**
 * One occurrence a Detector reported: a fixed explanatory sentence with
 * Measured numbers slotted into it, the evidence it came from, and what acting
 * on it would give back.
 */
/** Which Detector produced a Finding. Findings of one kind group into one card. */
export type FindingKind =
  | 'reanchor'
  | 'duplicate-read'
  | 'model-change'
  | 'retry-churn'
  | 'binary-read'
  | 'thinking-heavy'
  | 'web-repeat'
  | 'noisy-command'
  /** A file put back into the context after each edit to it. */
  | 'edit-reinjected';

export interface Finding {
  id: string;
  kind: FindingKind;
  category: FindingCategory;
  sessionId: SessionId;
  sessionPath: string;
  sessionName: string;
  project: string;
  /** Tokens that acting on this would give back. */
  recoverable: number;
  /**
   * Set when `recoverable` is derived from content length rather than from a
   * usage figure.
   *
   * Injected context has no Request of its own, so what it added is only
   * knowable from how long it is. That is still a fact about the Transcript,
   * but it is not the same kind of fact as a Measured one, and a total that
   * mixes the two without saying so is the sort of quiet overclaim this app
   * exists to catch.
   */
  estimated?: true;
  /**
   * The shared explanation for this kind of Finding. Identical across every
   * Finding of the same kind, so it is shown once per group rather than
   * repeated on each.
   */
  explanation: string;
  /** What happened in this particular Session, with its own Measured numbers. */
  text: string;
  evidence: string;
}

export type AlertKind = 'oversized-result' | 'prefix-rebuilt' | 'subagent-spend';

/**
 * Something expensive that just happened in the running Session.
 *
 * Raised after the fact — Transcripts are written once a Request completes — so
 * an Alert reports what was spent, never what to avoid.
 */
/**
 * One measured fact behind an Alert.
 *
 * An Alert says a thing happened; the evidence is what it is standing on. For a
 * rebuilt prefix that is each rebuild and the results that grew the context
 * before it, because there is rarely a single culprit and pretending otherwise
 * would be inventing one.
 */
export interface AlertEvidence {
  at: string;
  label: string;
  tokens: number | null;
  /** Set when this line corresponds to an Event, so it can be selected. */
  eventId?: string;
}

export interface Alert {
  id: string;
  kind: AlertKind;
  sessionId: SessionId;
  sessionName: string;
  project: string;
  /** The repository behind the project, so worktrees group together. */
  repo: string;
  /** Where the Transcript is, so the Session can be reopened from an Alert. */
  sessionPath: string;
  at: string;
  title: string;
  detail: string;
  tokens: number;
  /** The Event to select on arrival, when one Event is the whole story. */
  eventId?: string;
  evidence: AlertEvidence[];
}

export type RecommendationKind = 'unused-mcp' | 'model-routing';

/**
 * Something worth acting on whose saving cannot be Measured.
 *
 * Kept distinct from a Finding, which always carries a token figure. A
 * Recommendation states what it found and why it matters, and never a number
 * it cannot back up.
 */
export interface Recommendation {
  id: string;
  kind: RecommendationKind;
  title: string;
  text: string;
  /** The specifics — which servers, which agents. */
  detail: string;
  /** Always false. Present so that adding a costable one later is a type error. */
  costable: false;
}

/** A Session with its Events loaded. Built on demand, never cached. */
export interface SessionDetail extends SessionSummary {
  events: Event[];
  requests: Request[];
  subagentDetail: Subagent[];
  invalidations: Invalidation[];
}
