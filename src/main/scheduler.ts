import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { SessionDetail } from '../shared/model.js';
import {
  DEFAULT_CONFIG,
  type ActionKind,
  type AutoAction,
  type CacheClock,
  type RunRecord,
  type ToolsConfig,
  type WakeUp,
} from '../shared/tools.js';
import { cacheClock } from './cache-clock.js';
import { noteSkipped, readRuns, runAction, runWakeUp } from './runner.js';

/**
 * The part of Loupe that acts without being asked.
 *
 * Two clocks, checked together. Wake-ups fire at a time of day and exist to put
 * the five-hour Block boundary where you want it. Auto-actions fire relative to
 * the running Session's cache deadline and exist to spend the moment before it
 * expires rather than discover afterwards that it did.
 *
 * Both are off until configured, one runs at a time, and everything that
 * happens - including everything deliberately not done - is written to the run
 * log.
 */

const CONFIG_PATH = process.env['LOUPE_ROOT']
  ? join(process.env['LOUPE_ROOT'], '.loupe-tools.json')
  : join(homedir(), '.claude', '.loupe-tools.json');

/** How often the two clocks are compared against the time. */
const TICK_MS = 15_000;

/**
 * How late a wake-up may still fire.
 *
 * A closed laptop does not run timers, so the tick after waking can be well
 * past the scheduled minute. Firing then is usually right; firing four hours
 * later would start the Block at a time nobody chose, which is the exact
 * problem wake-ups exist to solve.
 */
const LATE_WINDOW_MS = 5 * 60_000;

const dayKey = (d: Date): string =>
  `${String(d.getFullYear())}-${String(d.getMonth())}-${String(d.getDate())}`;

export const readConfig = async (): Promise<ToolsConfig> => {
  const raw = await readFile(CONFIG_PATH, 'utf8').catch(() => null);
  if (raw === null) return DEFAULT_CONFIG;
  try {
    return { ...DEFAULT_CONFIG, ...(JSON.parse(raw) as Partial<ToolsConfig>) };
  } catch {
    return DEFAULT_CONFIG;
  }
};

export const writeConfig = (config: ToolsConfig): Promise<void> =>
  writeFile(CONFIG_PATH, JSON.stringify(config, null, 2)).catch(() => undefined);

/**
 * A stretch of keeping one Session's prefix alive.
 *
 * `since` is when the stretch began, which is what the break-even is measured
 * against - not the last ping. `expectedRequests` is the Session's Request
 * count after our own turn lands, so a higher one means somebody real came
 * back and the stretch is over.
 */
export interface Holding {
  sessionId: string;
  since: number;
  expectedRequests: number;
  /** Set once the break-even has been announced, so it is said once rather than every tick. */
  announced: boolean;
  /**
   * How many keep-alives this stretch has sent.
   *
   * A second bound, because the first one is not enough on its own: `since` is
   * only trusted while `expectedRequests` holds, and a ping that costs two
   * Requests rather than one reads as somebody coming back, resetting the
   * stretch and with it the elapsed time the break-even is measured against.
   * A count cannot be reset by miscounting.
   */
  pings: number;
}

export interface Scheduler {
  stop(): void;
  /** Hand the scheduler every running Session. Empty when nothing is running. */
  observe(details: SessionDetail[]): void;
  /** A deadline per running Session, for the screen that draws them. */
  clocks(): CacheClock[];
  config(): ToolsConfig;
  setConfig(config: ToolsConfig): Promise<void>;
  /** Run something now against one Session, from a button rather than a rule. */
  runNow(kind: ActionKind, sessionId: string): Promise<RunRecord>;
}

export function startScheduler(onRun: (record: RunRecord) => void): Scheduler {
  let config: ToolsConfig = DEFAULT_CONFIG;
  let running: SessionDetail[] = [];
  let busy = false;
  /** One stretch of holding on per Session, keyed by Session id. */
  const holdings = new Map<string, Holding>();

  /** Wake-ups already fired today, and action windows already spent. */
  const fired = new Set<string>();

  const emit = (record: RunRecord): void => {
    onRun(record);
  };

  /** Record a decision not to run, and tell the screen about it like any other. */
  const skip = async (
    kind: ActionKind | 'wake-up',
    label: string,
    project: string,
    detail: string,
  ): Promise<RunRecord> => {
    const record = await noteSkipped(kind, label, project, detail);
    emit(record);
    return record;
  };

  /**
   * Claim a key, run the job, and give the key back if nothing started.
   *
   * The key is what stops a wake-up firing twice in a day or an action firing
   * twice for one deadline, so it has to be claimed before the run and
   * surrendered when the run did not happen. Both call sites got that wrong in
   * the same way, which is why it is one function now.
   */
  const attempt = (
    key: string,
    what: { kind: ActionKind | 'wake-up'; label: string; project: string; whenBusy: string },
    job: () => Promise<RunRecord>,
  ): void => {
    fired.add(key);
    void guarded(job).then((ran) => {
      if (ran !== null) return;
      fired.delete(key);
      void skip(what.kind, what.label, what.project, what.whenBusy);
    });
  };

  const guarded = async (job: () => Promise<RunRecord>): Promise<RunRecord | null> => {
    // One at a time: two `claude --resume` against the same Session would have
    // the second start a copy, which is a new context rather than a kept one.
    if (busy) return null;
    busy = true;
    try {
      const record = await job();
      emit(record);
      return record;
    } finally {
      busy = false;
    }
  };

  const clocksNow = (): CacheClock[] =>
    running.map((d) => cacheClock(d)).filter((c): c is CacheClock => c !== null);

  const sessionOf = (id: string): SessionDetail | undefined => running.find((d) => d.id === id);

  const checkActions = (): void => {
    for (const clock of clocksNow()) {
      const detail = sessionOf(clock.sessionId);
      if (!detail) continue;

      for (const action of config.actions) {
        if (!applies(action, clock)) continue;

        if (action.kind === 'keep-alive') {
          keepAlive(clock, detail, { holdings, guarded, skip });
          break;
        }

        // Compaction and handoff are terminal: once per deadline, not per tick.
        const key = `${action.kind}:${clock.sessionId}:${clock.expiresAt}`;
        if (fired.has(key)) continue;
        attempt(
          key,
          {
            kind: action.kind,
            label: clock.sessionName,
            project: clock.project,
            whenBusy: 'Another run was still going',
          },
          () => runAction(action.kind, session(clock), clock.prefix),
        );
        break;
      }
    }

    // Sessions that have stopped running keep no state here.
    for (const id of holdings.keys()) if (!sessionOf(id)) holdings.delete(id);
  };

  const tick = (): void => {
    const wake = dueWakeUp(config, fired);
    if (wake) {
      attempt(
        `wake:${wake.id}:${dayKey(new Date())}`,
        {
          kind: 'wake-up',
          label: wake.at,
          project: wake.cwd,
          whenBusy: 'Something else was running; will try again',
        },
        () => runWakeUp(wake),
      );
    }
    checkActions();
  };

  /**
   * Nothing ticks until both the config and the record of what has already run
   * are loaded. Assigning the config first and seeding afterwards left a window
   * where a tick saw the wake-ups with an empty `fired` set and could run one a
   * second time.
   */
  let timer: NodeJS.Timeout | null = null;
  void readConfig().then(async (loaded) => {
    await seedFired(fired);
    config = loaded;
    timer = setInterval(tick, TICK_MS);
  });

  return {
    stop: () => {
      if (timer) clearInterval(timer);
    },
    observe: (details) => {
      running = details;
      // React to a Session changing as well as to the clock: a Request landing
      // moves that deadline, and waiting up to a tick to notice can be the
      // difference between acting before expiry and reporting it after.
      checkActions();
    },
    clocks: clocksNow,
    config: () => config,
    setConfig: async (next) => {
      config = next;
      await writeConfig(next);
    },
    runNow: async (kind, sessionId) => {
      const clock = clocksNow().find((c) => c.sessionId === sessionId);
      if (!clock) return skip(kind, 'No running session', '', 'That session is no longer running');

      const record = await guarded(() => runAction(kind, session(clock), clock.prefix));
      return (
        record ??
        (await skip(kind, clock.sessionName, clock.project, 'Another run was still going'))
      );
    },
  };
}

/**
 * Whether a stretch of holding one Session's prefix alive is still going, and
 * when it began.
 *
 * Somebody coming back to the Session ends it: their Request count overtakes
 * the one our own turn was going to leave behind.
 */
export function stretch(
  holdings: Map<string, Holding>,
  sessionId: string,
  requestCount: number,
): Holding | null {
  const held = holdings.get(sessionId);
  if (held && requestCount > held.expectedRequests) {
    holdings.delete(sessionId);
    return null;
  }
  return held ?? null;
}

/**
 * Wake-ups already fired before a restart must not fire again. The run log is
 * the record of what happened, so it is also the record of what not to redo.
 */
async function seedFired(fired: Set<string>): Promise<void> {
  const today = dayKey(new Date());
  for (const run of await readRuns()) {
    // Only a run that actually started counts. `noteSkipped` writes `skip:...`
    // records that also carry kind 'wake-up', and reading an id out of one of
    // those seeds a key for a wake-up that never happened.
    if (run.kind !== 'wake-up' || !run.id.startsWith('wake:')) continue;
    const id = run.id.split(':')[1];
    if (id && dayKey(new Date(run.at)) === today) fired.add(`wake:${id}:${today}`);
  }
}

/** What a keep-alive needs from the scheduler that owns it. */
interface Keeping {
  holdings: Map<string, Holding>;
  guarded: (job: () => Promise<RunRecord>) => Promise<RunRecord | null>;
  skip: (
    kind: ActionKind | 'wake-up',
    label: string,
    project: string,
    detail: string,
  ) => Promise<RunRecord>;
}

/**
 * Hold one Session's prefix open, for as long as that is the cheaper choice.
 *
 * Lives outside the scheduler because it is the only part of it with real
 * rules of its own, and reading them buried in a closure was harder than it
 * needed to be.
 */
function keepAlive(clock: CacheClock, detail: SessionDetail, ctx: Keeping): void {
  const held = stretch(ctx.holdings, clock.sessionId, detail.requestCount);
  const since = held?.since ?? Date.now();
  const pings = held?.pings ?? 0;

  // Either bound ends it: the time held, or the number of pings that time is
  // worth. One keep-alive covers one lifetime, so the break-even in pings is
  // the break-even in time divided by the lifetime.
  const affordable = Math.max(1, Math.floor(clock.breakEvenMs / clock.ttlMs));
  if (Date.now() - since > clock.breakEvenMs || pings >= affordable) {
    // Past the point where holding on has cost more than one rebuild would
    // have. Stopping is the whole reason the figure is computed.
    if (held && !held.announced) {
      held.announced = true;
      void ctx.skip(
        'keep-alive',
        clock.sessionName,
        clock.project,
        `Held for ${minutes(Date.now() - since)}, past the break-even of ` +
          `${minutes(clock.breakEvenMs)} - letting it expire is now the cheaper of the two`,
      );
    }
    return;
  }

  void ctx.guarded(async () => {
    const record = await runAction('keep-alive', session(clock), clock.prefix);
    ctx.holdings.set(clock.sessionId, {
      sessionId: clock.sessionId,
      since,
      expectedRequests: detail.requestCount + 1,
      announced: false,
      pings: pings + 1,
    });
    return record;
  });
}

/** Does this rule apply to what is running, right now? */
const applies = (action: AutoAction, clock: CacheClock): boolean =>
  action.enabled &&
  clock.prefix >= action.minPrefix &&
  (action.project === '' || action.project === clock.project) &&
  clock.msLeft > 0 &&
  clock.msLeft <= action.leadSeconds * 1000;

/**
 * The wake-up whose moment has arrived and has not already been taken today,
 * or null. One at a time: two Sessions starting together would begin the same
 * Block twice and the second would be spending the first one's window.
 */
export function dueWakeUp(
  config: ToolsConfig,
  fired: ReadonlySet<string>,
  now = new Date(),
): WakeUp | null {
  for (const wake of config.wakeUps) {
    if (!wake.enabled || !wake.days.includes(now.getDay())) continue;

    const [h, m] = wake.at.split(':').map(Number);
    if (h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m)) continue;

    const due = new Date(now);
    due.setHours(h, m, 0, 0);
    const late = now.getTime() - due.getTime();
    if (late < 0 || late > LATE_WINDOW_MS) continue;
    if (fired.has(`wake:${wake.id}:${dayKey(now)}`)) continue;
    return wake;
  }
  return null;
}

const session = (
  clock: CacheClock,
): { id: string; cwd: string; name: string; project: string } => ({
  id: clock.sessionId,
  cwd: clock.cwd,
  name: clock.sessionName,
  project: clock.project,
});

const minutes = (ms: number): string => `${String(Math.round(ms / 60_000))} min`;
