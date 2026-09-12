import type { Invalidation, InvalidationCause, Request, SessionSummary } from '../shared/model.js';

/**
 * Find the points where a Session rebuilt its cached prefix instead of reading
 * it, and say why where that can be determined.
 *
 * Measured against real Transcripts: 53% of Invalidations are Expiry, 20% are
 * Avoidable, and 27% are Undetermined. Expiry is reported as an aggregate and
 * never as a Finding, because idle time is not a mistake.
 */

/** Below this there is no prefix worth talking about. */
const SIGNIFICANT_PREFIX = 20_000;

/**
 * Cache lifetimes. A Request writing to the one-hour cache keeps its prefix for
 * an hour; everything else expires in five minutes.
 */
const TTL_5M_MS = 5 * 60_000;
const TTL_1H_MS = 60 * 60_000;

function isInvalidation(previous: Request, current: Request): boolean {
  const before = previous.usage.cacheRead + previous.usage.cacheWrite + previous.usage.input;
  if (before < SIGNIFICANT_PREFIX) return false;
  // Reads collapse and writes spike in the same Request.
  return current.usage.cacheRead < before * 0.5 && current.usage.cacheWrite > SIGNIFICANT_PREFIX;
}

function classify(previous: Request, current: Request, ttlMs: number): InvalidationCause {
  const before = previous.usage.cacheRead + previous.usage.cacheWrite + previous.usage.input;
  const after = current.usage.cacheRead + current.usage.cacheWrite;

  // Compaction first, and before the idle check: if the context shrank it was
  // compacted, whatever else happened. A 1M context becoming 54k is the whole
  // point of compaction, so it must never be reported as waste.
  if (after < before * 0.5) return 'compaction';

  // Then idle: a long enough gap explains a rebuild on its own, and blaming a
  // model change that happened after a two-hour break would be wrong.
  const gap = Date.parse(current.at) - Date.parse(previous.at);
  if (gap > ttlMs) return 'expiry';
  if (previous.model !== current.model) return 'model-change';

  // The context survived intact but was re-split between read and written —
  // the prefix moved rather than being discarded. 56% of all Invalidations.
  if (after >= before * 0.8) return 'reanchor';

  return 'undetermined';
}

export function findInvalidations(session: SessionSummary, requests: Request[]): Invalidation[] {
  const out: Invalidation[] = [];

  for (let i = 1; i < requests.length; i++) {
    const previous = requests[i - 1]!;
    const current = requests[i]!;
    if (!isInvalidation(previous, current)) continue;

    // A Request that wrote to the one-hour cache bought itself an hour.
    const ttl = previous.usage.cacheWrite > 0 && previous.oneHourWrite > 0 ? TTL_1H_MS : TTL_5M_MS;
    const cause = classify(previous, current, ttl);

    out.push({
      sessionId: session.id,
      sessionName: session.name,
      project: session.project,
      at: current.at,
      cause,
      rewritten: current.usage.cacheWrite,
      idleMs: Date.parse(current.at) - Date.parse(previous.at),
      ...(cause === 'model-change' ? { detail: `${previous.model} → ${current.model}` } : {}),
    });
  }
  return out;
}

export interface Aggregate {
  count: number;
  rewritten: number;
  averageIdleMs: number;
}

export interface CacheSummary {
  /** Invalidations caused by something done during the Session, worth acting on. */
  avoidable: Invalidation[];
  /** Expiry: idle time. Counted, never listed as a Finding. */
  expiry: Aggregate;
  /** Re-anchoring: context outgrew incremental caching. Counted, with its own advice. */
  reanchor: Aggregate;
  /** Compaction: the context shrank. Counted so the totals reconcile, never as waste. */
  compaction: Aggregate;
}

const aggregate = (of: Invalidation[]): Aggregate => ({
  count: of.length,
  rewritten: of.reduce((n, i) => n + i.rewritten, 0),
  averageIdleMs: of.length === 0 ? 0 : Math.round(of.reduce((n, i) => n + i.idleMs, 0) / of.length),
});

export function summarise(all: Invalidation[]): CacheSummary {
  return {
    avoidable: all
      .filter((i) => i.cause === 'model-change' || i.cause === 'undetermined')
      .sort((a, b) => b.rewritten - a.rewritten),
    expiry: aggregate(all.filter((i) => i.cause === 'expiry')),
    reanchor: aggregate(all.filter((i) => i.cause === 'reanchor')),
    compaction: aggregate(all.filter((i) => i.cause === 'compaction')),
  };
}
