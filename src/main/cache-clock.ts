import type { Request, SessionDetail } from '../shared/model.js';
import type { CacheClock } from '../shared/tools.js';

/**
 * When the running Session's cached prefix expires, and whether holding it is
 * cheaper than letting it go.
 *
 * Unlike an Alert, this is ahead of the event rather than behind it: a cache
 * lifetime is fixed and the last Request's timestamp is known, so the deadline
 * is arithmetic rather than a forecast. It is the one thing here that can be
 * said before the cost is paid.
 */

const TTL_5M_MS = 5 * 60_000;
const TTL_1H_MS = 60 * 60_000;

/**
 * Cache reads and writes priced against fresh input.
 *
 * These are the published multiples, not something derived from Transcripts.
 * They set the break-even and nothing else, so if they change, the advice
 * changes with them and no Measured figure moves.
 */
const READ_MULTIPLE = 0.1;
const WRITE_MULTIPLE = 1.25;

/** Recent Requests to judge the working rhythm from. */
const RECENT_REQUESTS = 6;

/**
 * Below this there is no prefix worth acting on. The same floor
 * `invalidations.ts` uses to decide a rebuild is worth reporting.
 */
export const SIGNIFICANT_PREFIX = 20_000;

/** How long a prefix can be held before holding costs more than one rebuild. */
export const breakEven = (ttlMs: number): number =>
  Math.round((ttlMs * WRITE_MULTIPLE) / READ_MULTIPLE);

const prefixOf = (r: Request): number => r.usage.cacheRead + r.usage.cacheWrite + r.usage.input;

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

/**
 * The clock for a Session, or null when it has no prefix worth watching.
 *
 * Null rather than a zeroed record: a Session one Request old has no cached
 * prefix at all, and drawing a countdown for it would be inventing a deadline
 * for something that does not exist.
 */
export function cacheClock(session: SessionDetail, now: number = Date.now()): CacheClock | null {
  const last = session.requests.at(-1);
  if (!last) return null;

  const prefix = prefixOf(last);
  if (prefix < SIGNIFICANT_PREFIX) return null;

  // A Request that wrote to the one-hour cache bought an hour; everything else
  // gets five minutes. Same rule the Invalidation classifier applies.
  const ttlMs = last.oneHourWrite > 0 ? TTL_1H_MS : TTL_5M_MS;
  const lastMs = Date.parse(last.at);
  const expiresAt = lastMs + ttlMs;

  const recent = session.requests.slice(-RECENT_REQUESTS);
  const gaps = recent
    .slice(1)
    .map((r, i) => Date.parse(r.at) - Date.parse(recent[i]!.at))
    .filter((g) => g > 0);

  // Only the turns that grew the context count towards the rate. A Request
  // that shrank it was a compaction, and folding that in would report a context
  // that shrinks on average and therefore never fills.
  const growth = recent
    .slice(1)
    .map((r, i) => prefixOf(r) - prefixOf(recent[i]!))
    .filter((g) => g > 0);

  return {
    sessionId: session.id,
    sessionName: session.name,
    project: session.project,
    cwd: session.cwd,
    path: session.path,
    model: last.model,
    prefix,
    ttlMs,
    lastAt: last.at,
    expiresAt: new Date(expiresAt).toISOString(),
    msLeft: expiresAt - now,
    breakEvenMs: breakEven(ttlMs),
    typicalGapMs: median(gaps),
    perTurn: median(growth),
  };
}
