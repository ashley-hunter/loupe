import {
  type Limit,
  type LimitKind,
  type SessionSummary,
  type UsageSample,
} from '../shared/model.js';

/**
 * Attribute Allowance to Sessions.
 *
 * The endpoint reports one account-wide figure, so a Session's Allowance is the
 * measured rise across its span. When Sessions overlap they each
 * report the same rise and are flagged Shared: correct individually, never
 * summable. Sessions that ended before the first sample get null.
 */

const percentAt = (samples: UsageSample[], kind: LimitKind, at: number): number | null => {
  let best: { d: number; limit: Limit } | null = null;
  for (const s of samples) {
    const d = Math.abs(Date.parse(s.at) - at);
    for (const limit of s.limits) {
      if (limit.kind !== kind) continue;
      if (!best || d < best.d) best = { d, limit };
    }
  }
  // A sample more than half a window away says nothing useful about this moment.
  return best && best.d <= 10 * 60_000 ? best.limit.percent : null;
};

/**
 * The rise between two moments, in percentage points.
 *
 * A window that reset in between shows a fall rather than a rise; the portion
 * before the reset is unrecoverable, so the result is the post-reset figure
 * alone and is therefore a floor, not a total.
 */
export function riseBetween(
  samples: UsageSample[],
  kind: LimitKind,
  fromMs: number,
  toMs: number,
): number | null {
  const start = percentAt(samples, kind, fromMs);
  const end = percentAt(samples, kind, toMs);
  if (start === null || end === null) return null;
  return end >= start ? end - start : end;
}

/** True when any other Session was running during this one's span. */
const overlaps = (s: SessionSummary, all: SessionSummary[]): boolean =>
  all.some(
    (o) =>
      o.id !== s.id &&
      Date.parse(o.startedAt) < Date.parse(s.endedAt) &&
      Date.parse(o.endedAt) > Date.parse(s.startedAt),
  );

export function attribute(sessions: SessionSummary[], samples: UsageSample[]): SessionSummary[] {
  if (samples.length === 0) return sessions;
  const earliest = Math.min(...samples.map((s) => Date.parse(s.at)));

  return sessions.map((s) => {
    // Nothing was being recorded yet, so there is nothing to report.
    if (Date.parse(s.endedAt) < earliest) return s;

    const from = Date.parse(s.startedAt);
    const to = Date.parse(s.endedAt);
    const allowance = riseBetween(samples, 'session', from, to);
    const weekly = riseBetween(samples, 'weekly_all', from, to);

    return {
      ...s,
      allowance,
      weekly,
      ...(allowance !== null && overlaps(s, sessions) ? { allowanceShared: true } : {}),
    };
  });
}
