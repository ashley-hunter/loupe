import { byFile, sumCost } from '../shared/aggregate.js';
import type { Event, Finding, SessionDetail } from '../shared/model.js';

/**
 * Detectors: one function per named wasteful pattern.
 *
 * Each returns Findings whose sentences are fixed and whose numbers are
 * Measured — nothing here asks a model anything. Only patterns that
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

/**
 * Roughly four characters per token, the same yardstick the Inspector uses.
 *
 * Injected context is the one thing here without a Measured cost: it has no
 * Request of its own, so what it added is only knowable from its length. Every
 * figure derived from this says "about".
 */
const estimate = (chars: number): number => Math.round(chars / 4);

/**
 * The same file re-sent into the context after every edit.
 *
 * Claude Code re-injects a file once it has been edited, so a file edited ten
 * times is ten whole copies of it in the context. Nobody asks for this and no
 * tool call records it, which is why it went unseen: it arrives as an
 * `attachment`, not as a Read, so the duplicate-read Detector cannot see it.
 * Measured here at 12.2k tokens per Session, and 63.6k in the worst one.
 */
const reinjectedEdits: Detector = (session) => {
  const byPath = new Map<string, { copies: number; chars: number }>();
  for (const e of session.events) {
    if (e.kind !== 'inject' || e.subtitle !== 'edited_text_file' || e.path === undefined) continue;
    const at = byPath.get(e.path) ?? { copies: 0, chars: 0 };
    at.copies++;
    at.chars += (e.body ?? '').length;
    byPath.set(e.path, at);
  }

  return [...byPath.entries()]
    .map(([path, f]) => ({
      path,
      copies: f.copies,
      cost: estimate(f.chars),
      // The first copy is the edit being confirmed; the repeats are the waste.
      wasted: estimate(Math.round((f.chars * (f.copies - 1)) / f.copies)),
    }))
    .filter((f) => f.copies > 1 && f.wasted >= WORTH_REPORTING_CHURN)
    .sort((a, b) => b.wasted - a.wasted)
    .map((f) => ({
      id: `${session.id}:reinject:${f.path}`,
      kind: 'edit-reinjected' as const,
      category: 'duplication' as const,
      sessionId: session.id,
      sessionPath: session.path,
      sessionName: session.name,
      project: session.project,
      tab: 'files' as const,
      recoverable: f.wasted,
      // Counted from the length of what was injected, not from a usage figure.
      estimated: true as const,
      explanation:
        'Claude Code puts a file back into the context after each edit to it, so a file ' +
        'edited repeatedly is held several times over. Making the changes to one file ' +
        'together, rather than returning to it, costs one copy instead of several.',
      text: `${short(f.path)} was re-sent ${f.copies} times after edits, about ${fmt(f.cost)} tokens`,
      evidence: `${f.copies} copies · about ${fmt(f.wasted)} of it repeat`,
    }));
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
  const isPicture = (e: Event): boolean =>
    (e.path !== undefined && BINARY.test(e.path)) || (e.images !== undefined && e.images > 0);

  /**
   * Every picture that entered the context, however it got there.
   *
   * Read from disk it has a path and a matching extension; handed back by a
   * tool it has neither, only image blocks in its result - which is how 119
   * screenshots went uncounted while 1,393 image reads were caught.
   *
   * Summed as one set, and through `sumCost`, because a Request that took a
   * screenshot and read an image shares one cost between both of them. Adding
   * the two groups separately counted that Request twice.
   */
  const pictures = session.events.filter((e) => isPicture(e) && (e.cost ?? 0) > 0);
  if (pictures.length === 0) return [];

  const cost = sumCost(pictures);
  if (cost < WORTH_REPORTING) return [];

  const shots = pictures.filter((e) => e.path === undefined);
  const reads = pictures.filter((e) => e.path !== undefined);
  const named = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

  const what =
    shots.length === 0
      ? named(reads.length, 'image or PDF read', 'image or PDF reads')
      : reads.length === 0
        ? named(shots.length, 'screenshot', 'screenshots')
        : `${named(reads.length, 'image or PDF read', 'image or PDF reads')} and ${named(shots.length, 'screenshot', 'screenshots')}`;

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
        'Images and PDFs are expensive to put into a context and are seldom referred back to ' +
        'once they have been described. Reading or capturing one, acting on it, and not ' +
        'repeating it keeps the cost to a single turn.',
      text: `${what} costing ${fmt(cost)} tokens`,
      evidence: [
        ...reads.slice(0, 3).map((e) => short(e.path ?? e.title)),
        ...shots.slice(0, 2).map((e) => short(e.title)),
      ].join(', '),
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

/** The program a command runs, with any leading `cd ... &&` stripped. */
function program(command: string): string {
  const withoutCd = command.replace(/^cd\s+(?:'[^']*'|"[^"]*"|\S+)\s*(?:&&\s*)?/, '');
  const first = (withoutCd.trim() || command.trim()).split(/\s+/)[0] ?? '';
  return first.replace(/^.*\//, '').slice(0, 24);
}

/**
 * Command output filling the context, grouped by the program that produced it.
 *
 * Measured across the Transcripts here, command output is 62.5% of everything
 * that grows a context — more than twice what file reads add — but it does it
 * by volume rather than by size: 24,440 outputs at a median of 196 tokens, and
 * only five above 20k. Naming individual commands would therefore find almost
 * nothing, so this groups by program: what you would actually change is how a
 * tool is invoked, not one invocation of it.
 */
const noisyCommands: Detector = (session) => {
  const byProgram = new Map<string, { runs: number; cost: number }>();
  for (const e of session.events) {
    if (e.kind !== 'bash' || e.cost === null || e.cost <= 0) continue;
    const name = program(e.title);
    if (!name) continue;
    const seen = byProgram.get(name) ?? { runs: 0, cost: 0 };
    seen.runs++;
    seen.cost += e.cost;
    byProgram.set(name, seen);
  }

  return [...byProgram.entries()]
    .map(([name, c]) => ({ name, ...c }))
    .filter((c) => c.cost >= WORTH_REPORTING)
    .sort((a, b) => b.cost - a.cost)
    .map((c) => ({
      id: `${session.id}:bash:${c.name}`,
      kind: 'noisy-command' as const,
      category: 'context' as const,
      sessionId: session.id,
      sessionPath: session.path,
      sessionName: session.name,
      project: session.project,
      tab: 'tools' as const,
      recoverable: c.cost,
      explanation:
        'Command output goes into the context in full, and is the largest single ' +
        'source of growth. Quietening a command, piping it through head, or writing ' +
        'it to a file and reading back only the part that matters keeps it out.',
      text: `${c.name} produced ${fmt(c.cost)} tokens of output over ${String(c.runs)} ${
        c.runs === 1 ? 'run' : 'runs'
      }`,
      evidence: `${String(c.runs)} runs · ${fmt(Math.round(c.cost / c.runs))} each on average`,
    }));
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
  reinjectedEdits,
  reanchoring,
  noisyCommands,
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
