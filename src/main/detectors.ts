import { byFile } from '../shared/aggregate.js';
import type { Finding, SessionDetail } from '../shared/model.js';

/**
 * Detectors: one function per named wasteful pattern.
 *
 * Each returns Findings whose sentences are fixed and whose numbers are
 * Measured (ADR-0002) — nothing here asks a model anything. Only patterns that
 * actually occur in real Transcripts get a Detector; a rule that fires zero
 * times is worse than no rule, because it implies the app looked and found
 * nothing when really it never could.
 */
export type Detector = (session: SessionDetail) => Finding[];

/** Below this a Finding is noise, whatever its category. */
const WORTH_REPORTING = 20_000;

/**
 * Repeated failure gets a lower bar than sheer volume.
 *
 * A command that failed three times running is worth knowing about even when
 * its output was small: the signal is that the approach was not working, and
 * the tokens are only part of the cost.
 */
const WORTH_REPORTING_CHURN = 2_000;

/**
 * The prefix was rebuilt repeatedly while the Session was active.
 *
 * Measured as the largest single cost in the corpus — one Session did it 60
 * times for 40.4M tokens. It is not a mistake so much as a ceiling: past a
 * certain size the cache cannot be maintained incrementally any more.
 */
const reanchoring: Detector = (session) => {
  const hits = session.invalidations.filter((i) => i.cause === 'reanchor');
  const rewritten = hits.reduce((n, i) => n + i.rewritten, 0);
  if (hits.length < 2 || rewritten < WORTH_REPORTING) return [];

  return [
    {
      id: `${session.id}:reanchor`,
      kind: 'reanchor',
      category: 'context',
      sessionId: session.id,
      sessionPath: session.path,
      sessionName: session.name,
      project: session.project,
      tab: 'cache',
      recoverable: rewritten,
      explanation:
        'These sessions grew past the size where the cached prefix can be maintained ' +
        'incrementally, so it was rebuilt from a small base again and again while they were ' +
        'still active. Splitting the work across shorter sessions avoids most of the cost.',
      text: `rebuilt its prefix ${hits.length} times, rewriting ${fmt(rewritten)} tokens`,
      evidence: `${hits.length} rebuilds, none idle and none after a model change`,
    },
  ];
};

/**
 * The same file read at full length more than once.
 *
 * Every read after the first pays for the whole file again, so the recoverable
 * amount is what the repeats cost, not the total.
 */
const duplicateReads: Detector = (session) => {
  const repeated = byFile(session.events)
    .filter((f) => f.reads > 1 && f.cost > 0)
    .map((f) => ({ ...f, wasted: Math.round((f.cost * (f.reads - 1)) / f.reads) }))
    .filter((f) => f.wasted >= WORTH_REPORTING)
    .sort((a, b) => b.wasted - a.wasted);

  return repeated.map((f) => ({
    id: `${session.id}:dup:${f.key}`,
    kind: 'duplicate-read',
    category: 'duplication',
    sessionId: session.id,
    sessionPath: session.path,
    sessionName: session.name,
    project: session.project,
    tab: 'files',
    recoverable: f.wasted,
    explanation:
      'A file read at full length more than once pays for the whole file every time. ' +
      'Reading a range, or relying on what is already in context, avoids the repeat.',
    text: `${short(f.key)} read ${f.reads} times, ${fmt(f.cost)} tokens in total`,
    evidence: `${f.reads} reads · ${fmt(f.cost)} total · ${fmt(f.wasted)} of it repeat`,
  }));
};

/**
 * A model change part-way through, which invalidates the prefix.
 *
 * Rare — four across the corpus — but entirely avoidable, because the model can
 * be chosen before the Session starts at no cost at all.
 */
const midSessionModelChange: Detector = (session) => {
  const hits = session.invalidations.filter((i) => i.cause === 'model-change');
  const rewritten = hits.reduce((n, i) => n + i.rewritten, 0);
  if (hits.length === 0 || rewritten < WORTH_REPORTING) return [];

  return [
    {
      id: `${session.id}:model`,
      kind: 'model-change',
      category: 'cache',
      sessionId: session.id,
      sessionPath: session.path,
      sessionName: session.name,
      project: session.project,
      tab: 'cache',
      recoverable: rewritten,
      explanation:
        'The model is part of the cache key, so switching part-way through throws the ' +
        'cached prefix away. Choosing the model before starting costs nothing.',
      text:
        `changed model ${hits.length === 1 ? 'once' : `${hits.length} times`}, ` +
        `rewriting ${fmt(rewritten)} tokens`,
      evidence: hits[0]?.detail ?? `${hits.length} model changes`,
    },
  ];
};

/**
 * The same tool call failing over and over.
 *
 * A failed call costs exactly as much context as a successful one, and the
 * third identical failure says nothing the first did not.
 */
const retryChurn: Detector = (session) => {
  const failures = new Map<string, { runs: number; cost: number; unmeasured: number }>();
  for (const e of session.events) {
    if (!e.failed) continue;
    const seen = failures.get(e.title) ?? { runs: 0, cost: 0, unmeasured: 0 };
    seen.runs++;
    if (e.cost === null) seen.unmeasured++;
    else seen.cost += e.cost;
    failures.set(e.title, seen);
  }

  return (
    [...failures.entries()]
      .filter(([, f]) => f.runs >= 3)
      // Everything after the first failure is the waste, not the whole run.
      .map(([title, f]) => ({ title, ...f, wasted: Math.round((f.cost * (f.runs - 1)) / f.runs) }))
      .filter((f) => f.wasted >= WORTH_REPORTING_CHURN)
      .sort((a, b) => b.wasted - a.wasted)
      .map((f) => ({
        id: `${session.id}:churn:${f.title}`,
        kind: 'retry-churn' as const,
        category: 'behaviour' as const,
        sessionId: session.id,
        sessionPath: session.path,
        sessionName: session.name,
        project: session.project,
        tab: 'timeline' as const,
        recoverable: f.wasted,
        explanation:
          'A tool call that fails costs the same context as one that succeeds, and ' +
          'repeating it unchanged rarely produces a different answer. Changing the approach ' +
          'after the first failure is cheaper than trying again.',
        text: `${short(f.title)} failed ${f.runs} times, costing ${fmt(f.cost)} tokens`,
        evidence: `${f.runs} failures · ${fmt(f.wasted)} of it repeat`,
      }))
  );
};

/** Extensions whose contents are large and rarely referenced twice. */
const BINARY = /\.(png|jpe?g|gif|webp|bmp|ico|pdf|mp4|mov|zip|tar|gz)$/i;

/**
 * Screenshots, images and PDFs read into context.
 *
 * They are among the most expensive single reads and are almost never referred
 * back to once described.
 */
const binaryReads: Detector = (session) => {
  const reads = byFile(session.events).filter((f) => BINARY.test(f.key) && f.cost > 0);
  const cost = reads.reduce((n, f) => n + f.cost, 0);
  if (reads.length === 0 || cost < WORTH_REPORTING) return [];

  return [
    {
      id: `${session.id}:binary`,
      kind: 'binary-read',
      category: 'context',
      sessionId: session.id,
      sessionPath: session.path,
      sessionName: session.name,
      project: session.project,
      tab: 'files',
      recoverable: cost,
      explanation:
        'Images and PDFs are expensive to read and are seldom referred back to once ' +
        'they have been described. Reading one, acting on it, and not re-reading it keeps the ' +
        'cost to a single turn.',
      text: `${reads.length} image or PDF ${reads.length === 1 ? 'read' : 'reads'} costing ${fmt(cost)} tokens`,
      evidence: reads
        .slice(0, 3)
        .map((f) => short(f.key))
        .join(', '),
    },
  ];
};

/**
 * Extended thinking that dwarfs the answer it produced.
 *
 * Thinking tokens are billed output. When a turn spends far more of them than
 * it produced visible text, the reasoning budget outweighed the task.
 */
const thinkingHeavy: Detector = (session) => {
  let thinking = 0;
  let visible = 0;
  let turns = 0;

  for (const r of session.requests) {
    const think = r.usage.thinking;
    const text = r.usage.output - think;
    // Only lopsided turns count: heavy reasoning for a slight answer.
    if (think < 1000 || think < text * 5) continue;
    thinking += think;
    visible += text;
    turns++;
  }

  if (turns < 5 || thinking < 50_000) return [];

  return [
    {
      id: `${session.id}:thinking`,
      kind: 'thinking-heavy',
      category: 'behaviour',
      sessionId: session.id,
      sessionPath: session.path,
      sessionName: session.name,
      project: session.project,
      tab: 'timeline',
      recoverable: thinking,
      explanation:
        'Extended thinking is billed as output. These turns spent at least five times ' +
        'more on reasoning than on the answer they produced, which usually means the effort ' +
        'setting outweighed the task rather than that the task was hard.',
      text: `${turns} turns spent ${fmt(thinking)} thinking tokens for ${fmt(visible)} of answer`,
      evidence: `${turns} turns at 5:1 or worse`,
    },
  ];
};

/** The same page fetched more than once in a Session. */
const webRepeats: Detector = (session) => {
  const fetches = new Map<string, { runs: number; cost: number }>();
  for (const e of session.events) {
    if (e.kind !== 'web') continue;
    const seen = fetches.get(e.title) ?? { runs: 0, cost: 0 };
    seen.runs++;
    seen.cost += e.cost ?? 0;
    fetches.set(e.title, seen);
  }

  const repeated = [...fetches.entries()]
    .filter(([, f]) => f.runs > 1)
    .map(([url, f]) => ({ url, ...f, wasted: Math.round((f.cost * (f.runs - 1)) / f.runs) }))
    .filter((f) => f.wasted >= WORTH_REPORTING)
    .sort((a, b) => b.wasted - a.wasted);

  return repeated.map((f) => ({
    id: `${session.id}:web:${f.url}`,
    kind: 'web-repeat' as const,
    category: 'duplication' as const,
    sessionId: session.id,
    sessionPath: session.path,
    sessionName: session.name,
    project: session.project,
    tab: 'timeline' as const,
    recoverable: f.wasted,
    explanation:
      'A fetched page stays in context, so fetching it again pays for the same ' + 'content twice.',
    text: `${short(f.url)} fetched ${f.runs} times, costing ${fmt(f.cost)} tokens`,
    evidence: `${f.runs} fetches of the same URL`,
  }));
};

export const DETECTORS: Detector[] = [
  reanchoring,
  duplicateReads,
  midSessionModelChange,
  retryChurn,
  binaryReads,
  thinkingHeavy,
  webRepeats,
];

/** Every Finding across the given Sessions, worst first. */
export const findAll = (sessions: SessionDetail[]): Finding[] =>
  sessions
    .flatMap((s) => DETECTORS.flatMap((d) => d(s)))
    .sort((a, b) => b.recoverable - a.recoverable);

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/** The last segment, whichever separator the machine that wrote it used. */
const short = (path: string): string => path.split(/[\\/]/).pop() ?? path;
