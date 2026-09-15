// The Tools screen's model: what the cached prefix is doing, what may act on it
// unattended, and what was actually run.

/**
 * The state of the running Session's cached prefix.
 *
 * Everything here is Measured from the last Request except `expiresAt`, which
 * is that Request's timestamp plus the cache lifetime it bought. That is a
 * deadline, not a prediction: the lifetime is fixed and the clock is arithmetic.
 */
export interface CacheClock {
  sessionId: string;
  sessionName: string;
  project: string;
  /** Where the Session is running, so an action can be run in the same place. */
  cwd: string;
  path: string;
  model: string;
  /** Tokens held in the cached prefix, and so the tokens a rebuild rewrites. */
  prefix: number;
  /** The lifetime the last Request bought: an hour if it wrote to the 1h cache. */
  ttlMs: number;
  /** Timestamp of the last Request. */
  lastAt: string;
  expiresAt: string;
  msLeft: number;
  /**
   * How long the prefix can be held by keep-alive before that costs more than
   * letting it go and rebuilding once.
   *
   * A keep-alive re-reads the whole prefix at the cache-read rate; a rebuild
   * rewrites it at the cache-write rate. The write is 12.5x the read, and one
   * keep-alive covers one lifetime, so holding pays until 12.5 lifetimes have
   * passed. Above that, rebuilding once is cheaper than having held on.
   */
  breakEvenMs: number;
  /**
   * The typical gap between recent Requests. A short one means the Session is
   * being worked on and the expiry is worth interrupting over; a long one means
   * it was already winding down.
   */
  typicalGapMs: number;
  /**
   * What a turn currently adds to the context, typically.
   *
   * Taken from recent Requests rather than the Session as a whole: early turns
   * of any Session are cheap, and what matters is the rate it is growing at
   * now. Divided into the room left below the compaction threshold, this is how
   * many turns are left.
   */
  perTurn: number;
}

/** What Loupe can run against a Session on your behalf. */
export type ActionKind = 'keep-alive' | 'compact' | 'handoff';

/**
 * A standing instruction to run something before the prefix expires.
 *
 * These write to your Sessions. A keep-alive appends a turn, a compaction
 * replaces the context, a handoff writes a file - so each is off until it is
 * switched on, and every run is recorded.
 */
export interface AutoAction {
  id: string;
  kind: ActionKind;
  enabled: boolean;
  /** Fire this many seconds before the prefix expires. */
  leadSeconds: number;
  /** Ignore anything smaller: a small prefix is not worth acting on. */
  minPrefix: number;
  /** Restrict to one project. Empty means every project. */
  project: string;
}

/**
 * A Session started deliberately at a chosen time.
 *
 * The five-hour Block begins at its first Request, so the point of this is to
 * put that boundary where you want it rather than where an early question left
 * it.
 */
export interface WakeUp {
  id: string;
  enabled: boolean;
  /** Local clock time, `HH:MM`. */
  at: string;
  /** Weekdays it fires on, 0 = Sunday. */
  days: number[];
  /** Where to start it. The Block is account-wide, but the Session needs a home. */
  cwd: string;
  /** What to send. Kept short: the point is the first Request, not its answer. */
  prompt: string;
}

export interface ToolsConfig {
  wakeUps: WakeUp[];
  actions: AutoAction[];
}

/** Something Loupe ran. Recorded whether it worked or not. */
export interface RunRecord {
  id: string;
  at: string;
  kind: ActionKind | 'wake-up';
  /** Which Session or wake-up this was, in words. */
  label: string;
  project: string;
  ok: boolean;
  /** The command's own last words, or why it was not run. Never reworded. */
  detail: string;
  /** Tokens the prefix held when this fired, where that was known. */
  prefix?: number;
}

/**
 * What starting a Session in a project costs before you type anything.
 *
 * The first Request of a Session carries the system prompt, the tool
 * definitions, every MCP server's schema, the skill listing and CLAUDE.md. None
 * of that is itemised in a Transcript, so this is the total and never a split
 * per server - the figure is real, the attribution would be invented.
 */
export interface StartupCost {
  project: string;
  repo: string;
  /** Median first-Request preamble across the project's Sessions. */
  median: number;
  /** The largest one seen, which is usually the configuration at its fullest. */
  worst: number;
  sessions: number;
  /**
   * What the project actually paid to start its Sessions: the new tokens each
   * first Request wrote. A Session whose preamble was served from cache
   * occupies the same window but adds nothing here.
   */
  total: number;
}

/**
 * The context size compaction has been seen at, measured from your own history.
 * Null when nothing here has compacted yet, because there is then no limit to
 * count down to and inventing one would be a guess.
 */
export interface Threshold {
  tokens: number | null;
  /** How many compactions the figure stands on. */
  samples: number;
}

/**
 * Turns left before the context reaches that size, at the rate it is currently
 * growing. Null whenever any part of the sum is unknown, never a guess.
 *
 * Lives here rather than beside the measuring because the screen that draws it
 * runs in the renderer, and reaching into `src/main` for it would cross the
 * boundary every other shared value in this app respects.
 */
export function turnsLeft(
  context: number,
  perTurn: number,
  threshold: number | null,
): number | null {
  if (threshold === null || perTurn <= 0) return null;
  return Math.max(0, Math.floor((threshold - context) / perTurn));
}

export const DEFAULT_CONFIG: ToolsConfig = { wakeUps: [], actions: [] };

/** Weekdays, indexed to match `Date.getDay`. */
export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
