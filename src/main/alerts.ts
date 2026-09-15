import {
  newTokens,
  type Alert,
  type AlertEvidence,
  type Event,
  type SessionDetail,
} from '../shared/model.js';

/**
 * Watch a running Session for things worth interrupting someone over.
 *
 * Transcripts are written after a Request completes, so an Alert always arrives
 * just *after* the cost was paid — this warns, it never prevents. Keeping that
 * honest matters: the wording says what happened, not what to avoid.
 *
 * Only three things qualify, because a notification nobody trusts is worse than
 * none: a single result that dwarfed everything else in the Session, a cached
 * prefix being rebuilt over and over, and delegated work outgrowing the Session
 * that delegated it.
 */

/** Nothing below this interrupts anyone, however unusual it is for the Session. */
const FLOOR = 25_000;

/** How far above a Session's own typical result counts as out of the ordinary. */
const OUTLIER_MULTIPLE = 10;

/**
 * How recent something has to be to be worth interrupting over.
 *
 * An Alert is about what just happened. Without this, opening the app while a
 * long Session is running replays every expensive moment in its history at
 * once, which is noise dressed as urgency. Anything older is still visible in
 * the Session itself and in Insights.
 */
const MAX_AGE_MS = 15 * 60_000;

/** Re-anchoring only matters once it is a pattern, inside this window. */
const REBUILD_WINDOW_MS = 10 * 60_000;
const REBUILD_RUN = 3;

/**
 * Delegated spend worth interrupting over.
 *
 * Subagents are the largest thing in the corpus and the easiest to miss: each
 * has its own context window and its own Transcript, so none of it shows up in
 * the Session's own usage. Measured here, they are 52% of all new tokens, and
 * the heaviest Session spent 138.4M across its agents against 27.6M of its own.
 * Nothing warned about that while it was happening.
 */
const SUBAGENT_FLOOR = 2_000_000;

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
export function detectAlerts(
  session: SessionDetail,
  seen: ReadonlySet<string>,
  now: number = Date.now(),
): Alert[] {
  const alerts: Alert[] = [];
  const tooOld = (at: string): boolean => now - Date.parse(at) > MAX_AGE_MS;

  // A single result far above this Session's own normal.
  const costs = session.events.map((e) => e.cost).filter((c): c is number => c !== null && c > 0);
  const typical = median(costs);
  const threshold = Math.max(FLOOR, typical * OUTLIER_MULTIPLE);

  for (const e of session.events) {
    const id = `big:${e.id}`;
    if (e.cost === null || e.cost < threshold || seen.has(id) || tooOld(e.at)) continue;
    alerts.push({
      id,
      kind: 'oversized-result',
      sessionId: session.id,
      sessionName: session.name,
      project: session.project,
      repo: session.repo,
      sessionPath: session.path,
      at: e.at,
      title: `One result added ${format(e.cost)} to the context`,
      detail:
        typical > 0
          ? `${e.title.slice(0, 80)} · typical result here is ${format(typical)}`
          : e.title.slice(0, 80),
      tokens: e.cost,
      tab: 'timeline',
      eventId: e.id,
      // One Event is the whole story here, so the evidence is that Event and
      // the yardstick it was judged against.
      evidence: [
        {
          at: e.at,
          label: e.title.slice(0, 120),
          tokens: e.cost,
          ...(e.id ? { eventId: e.id } : {}),
        },
        ...(typical > 0
          ? [{ at: e.at, label: 'Typical result in this session', tokens: typical }]
          : []),
      ],
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

    if (tooOld(last.at)) continue;

    // One Alert per run of rebuilds, not one per sliding position: step over
    // the whole run before looking again.
    //
    // This happens before the `seen` check on purpose. Skipping only unseen
    // runs would make the choice of run depend on what had already been raised,
    // so each re-parse would announce the next overlapping window and say the
    // same thing again with the timestamps shifted by one.
    i += REBUILD_RUN - 1;

    const id = `rebuild:${last.at}`;
    if (seen.has(id)) continue;
    alerts.push({
      id,
      kind: 'prefix-rebuilt',
      sessionId: session.id,
      sessionName: session.name,
      project: session.project,
      repo: session.repo,
      sessionPath: session.path,
      at: last.at,
      title: `Cache rebuilt ${REBUILD_RUN} times in ${Math.max(1, Math.round(span / 60_000))} minutes`,
      detail:
        `${format(run.reduce((n, r) => n + r.rewritten, 0))} rewritten — this session has ` +
        'grown past the size where the cache holds. Finishing up and starting a fresh one is ' +
        'the only real remedy.',
      tokens: run.reduce((n, r) => n + r.rewritten, 0),
      tab: 'cache',
      evidence: [
        ...run.map((r) => ({
          at: r.at,
          label:
            r.idleMs > 0
              ? `Prefix rebuilt, ${Math.round(r.idleMs / 1000)}s after the previous request`
              : 'Prefix rebuilt',
          tokens: r.rewritten,
        })),
        ...grewTheContext(session.events, first.at, last.at),
      ],
    });
  }

  alerts.push(...subagentSpend(session, seen));
  return alerts;
}

/**
 * Delegated work that has outgrown the Session delegating it.
 *
 * Raised on a doubling rather than on a fixed line: a Session that crosses two
 * million will go on to cross three and four, and one Alert per step would be
 * a stream of the same news. The Alert is not "this is too much" - it is
 * "this is where it went", because the figure is invisible everywhere else
 * until the Session is over.
 */
function subagentSpend(session: SessionDetail, seen: ReadonlySet<string>): Alert[] {
  const spent = session.subagentDetail.reduce((n, a) => n + newTokens(a.usage), 0);
  if (spent < SUBAGENT_FLOOR) return [];

  // The step this spend has reached: 2M, 4M, 8M. One Alert per step.
  const step = Math.floor(Math.log2(spent / SUBAGENT_FLOOR));
  const id = `agents:${session.id}:${String(step)}`;
  if (seen.has(id)) return [];

  const own = newTokens(session.usage);
  const costliest = [...session.subagentDetail]
    .sort((a, b) => newTokens(b.usage) - newTokens(a.usage))
    .slice(0, 3);

  return [
    {
      id,
      kind: 'subagent-spend',
      sessionId: session.id,
      sessionName: session.name,
      project: session.project,
      repo: session.repo,
      sessionPath: session.path,
      at: new Date().toISOString(),
      title: `Subagents have spent ${format(spent)} in this session`,
      detail:
        `${String(session.subagentDetail.length)} agents, against ${format(own)} spent by the ` +
        'session itself. Each has its own context window, so none of this appears in the ' +
        "session's own usage.",
      tokens: spent,
      tab: 'agents',
      evidence: costliest.map((a) => ({
        // A Subagent finishes when it finishes; the Session's own clock is the
        // closest honest timestamp for "this is what it had spent by now".
        at: session.endedAt,
        label: `${a.type}: ${a.description.slice(0, 80)}`,
        tokens: newTokens(a.usage),
      })),
    },
  ];
}

/**
 * The costliest results inside the run's span.
 *
 * Re-anchoring has no single culprit — it is what a context does once it is
 * large — so the honest answer to "what caused this" is what was being put into
 * the context at the time. These are measured, not inferred.
 */
function grewTheContext(events: Event[], fromAt: string, toAt: string): AlertEvidence[] {
  const from = Date.parse(fromAt);
  const to = Date.parse(toAt);
  return events
    .filter((e) => {
      const at = Date.parse(e.at);
      return at >= from && at <= to && e.cost !== null && e.cost > 0;
    })
    .sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0))
    .slice(0, 3)
    .map((e) => ({
      at: e.at,
      label: `Added to the context: ${e.title.slice(0, 90)}`,
      tokens: e.cost,
      ...(e.id ? { eventId: e.id } : {}),
    }));
}

function format(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
