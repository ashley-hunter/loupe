import type { Alert, SessionDetail } from '../shared/model.js';

/**
 * Watch a running Session for things worth interrupting someone over.
 *
 * Transcripts are written after a Request completes, so an Alert always arrives
 * just *after* the cost was paid — this warns, it never prevents. Keeping that
 * honest matters: the wording says what happened, not what to avoid.
 *
 * Only two things qualify, because a notification nobody trusts is worse than
 * none: a single result that dwarfed everything else in the Session, and a
 * cached prefix being rebuilt over and over.
 */

/** Nothing below this interrupts anyone, however unusual it is for the Session. */
const FLOOR = 25_000;

/** How far above a Session's own typical result counts as out of the ordinary. */
const OUTLIER_MULTIPLE = 10;

/** Re-anchoring only matters once it is a pattern, inside this window. */
const REBUILD_WINDOW_MS = 10 * 60_000;
const REBUILD_RUN = 3;

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

/**
 * Alerts for a Session, given what has already been raised.
 *
 * `seen` carries the ids already alerted on, so a Session being re-parsed on
 * every write does not re-announce the same event. Returns the new Alerts only.
 */
export function detectAlerts(session: SessionDetail, seen: ReadonlySet<string>): Alert[] {
  const alerts: Alert[] = [];

  // A single result far above this Session's own normal.
  const costs = session.events.map((e) => e.cost).filter((c): c is number => c !== null && c > 0);
  const typical = median(costs);
  const threshold = Math.max(FLOOR, typical * OUTLIER_MULTIPLE);

  for (const e of session.events) {
    const id = `big:${e.id}`;
    if (e.cost === null || e.cost < threshold || seen.has(id)) continue;
    alerts.push({
      id,
      kind: 'oversized-result',
      sessionId: session.id,
      sessionName: session.name,
      project: session.project,
      at: e.at,
      title: `One result added ${format(e.cost)} to the context`,
      detail:
        typical > 0
          ? `${e.title.slice(0, 80)} · typical result here is ${format(typical)}`
          : e.title.slice(0, 80),
      tokens: e.cost,
    });
  }

  // The prefix being rebuilt repeatedly, which is the largest cost in the corpus.
  const rebuilds = session.invalidations.filter((i) => i.cause === 'reanchor');
  for (let i = REBUILD_RUN - 1; i < rebuilds.length; i++) {
    const run = rebuilds.slice(i - REBUILD_RUN + 1, i + 1);
    const first = run[0]!;
    const last = run.at(-1)!;
    const span = Date.parse(last.at) - Date.parse(first.at);
    if (span > REBUILD_WINDOW_MS) continue;

    const id = `rebuild:${last.at}`;
    if (seen.has(id)) continue;
    alerts.push({
      id,
      kind: 'prefix-rebuilt',
      sessionId: session.id,
      sessionName: session.name,
      project: session.project,
      at: last.at,
      title: `Cache rebuilt ${REBUILD_RUN} times in ${Math.max(1, Math.round(span / 60_000))} minutes`,
      detail:
        `${format(run.reduce((n, r) => n + r.rewritten, 0))} rewritten — this session has ` +
        'grown past the size where the cache holds. Finishing up and starting a fresh one is ' +
        'the only real remedy.',
      tokens: run.reduce((n, r) => n + r.rewritten, 0),
    });
  }

  return alerts;
}

function format(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
