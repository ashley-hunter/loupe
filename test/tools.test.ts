import { describe, expect, it } from 'vitest';
import { breakEven, cacheClock } from '../src/main/cache-clock.js';
import { measureThreshold } from '../src/main/compaction.js';
import { turnsLeft } from '../src/shared/tools.js';
import { detectAlerts } from '../src/main/alerts.js';
import { dueWakeUp, stretch, type Holding } from '../src/main/scheduler.js';
import { startupCosts } from '../src/main/startup.js';
import { EMPTY_USAGE, type Request, type SessionDetail, type Usage } from '../src/shared/model.js';
import type { ToolsConfig, WakeUp } from '../src/shared/tools.js';

const req = (at: string, usage: Partial<Usage>, opts: { oneHourWrite?: number } = {}): Request => ({
  id: `req-${at}` as Request['id'],
  at,
  model: 'claude-opus-5',
  usage: { ...EMPTY_USAGE, ...usage },
  toolCalls: 0,
  oneHourWrite: opts.oneHourWrite ?? 0,
});

const detail = (requests: Request[], over: Partial<SessionDetail> = {}): SessionDetail =>
  ({
    id: 's1',
    name: 'Demo',
    project: 'demo',
    repo: 'demo',
    cwd: '/tmp/demo',
    path: '/tmp/demo.jsonl',
    requestCount: requests.length,
    requests,
    events: [],
    invalidations: [],
    subagentDetail: [],
    usage: EMPTY_USAGE,
    endedAt: '2026-09-15T10:00:00Z',
    ...over,
  }) as SessionDetail;

describe('cacheClock', () => {
  it('counts down from the last request against the five-minute lifetime', () => {
    const clock = cacheClock(
      detail([req('2026-09-15T10:00:00Z', { cacheRead: 200_000, cacheWrite: 500 })]),
      Date.parse('2026-09-15T10:04:00Z'),
    );
    expect(clock?.msLeft).toBe(60_000);
    expect(clock?.expiresAt).toBe('2026-09-15T10:05:00.000Z');
    expect(clock?.prefix).toBe(200_500);
  });

  it('gives an hour to a request that wrote to the one-hour cache', () => {
    const clock = cacheClock(
      detail([req('2026-09-15T10:00:00Z', { cacheWrite: 200_000 }, { oneHourWrite: 200_000 })]),
      Date.parse('2026-09-15T10:00:00Z'),
    );
    expect(clock?.ttlMs).toBe(3_600_000);
    expect(clock?.msLeft).toBe(3_600_000);
  });

  it('has nothing to say about a session with no prefix worth holding', () => {
    expect(cacheClock(detail([req('2026-09-15T10:00:00Z', { input: 900 })]))).toBeNull();
    expect(cacheClock(detail([]))).toBeNull();
  });

  // The figure the whole feature turns on: a rebuild costs 12.5 keep-alives,
  // and one keep-alive covers one lifetime.
  it('breaks even at twelve and a half lifetimes', () => {
    expect(breakEven(5 * 60_000)).toBe(3_750_000);
    expect(breakEven(60 * 60_000)).toBe(45_000_000);
  });

  it('reads the working rhythm from the recent requests', () => {
    const clock = cacheClock(
      detail([
        req('2026-09-15T10:00:00Z', { cacheRead: 100_000 }),
        req('2026-09-15T10:01:00Z', { cacheRead: 100_000 }),
        req('2026-09-15T10:02:00Z', { cacheRead: 100_000 }),
      ]),
      Date.parse('2026-09-15T10:02:00Z'),
    );
    expect(clock?.typicalGapMs).toBe(60_000);
  });
});

describe('dueWakeUp', () => {
  const wake = (over: Partial<WakeUp> = {}): WakeUp => ({
    id: 'w1',
    enabled: true,
    at: '08:00',
    // 2026-09-15 is a Tuesday.
    days: [2],
    cwd: '/tmp/demo',
    prompt: 'ok',
    ...over,
  });
  const config = (w: WakeUp): ToolsConfig => ({ wakeUps: [w], actions: [] });
  const at = (time: string): Date => new Date(`2026-09-15T${time}`);

  it('fires once the scheduled minute has passed', () => {
    expect(dueWakeUp(config(wake()), new Set(), at('08:00:10'))?.id).toBe('w1');
  });

  it('stays quiet before its time, on the wrong day, and when switched off', () => {
    expect(dueWakeUp(config(wake()), new Set(), at('07:59:00'))).toBeNull();
    expect(dueWakeUp(config(wake({ days: [3] })), new Set(), at('08:00:10'))).toBeNull();
    expect(dueWakeUp(config(wake({ enabled: false })), new Set(), at('08:00:10'))).toBeNull();
  });

  // A closed laptop runs no timers, so a little late is fine and hours late is
  // a Block boundary nobody chose.
  it('will fire late, but not hours late', () => {
    expect(dueWakeUp(config(wake()), new Set(), at('08:04:00'))?.id).toBe('w1');
    expect(dueWakeUp(config(wake()), new Set(), at('08:30:00'))).toBeNull();
  });

  it('does not fire twice in one day', () => {
    const fired = new Set(['wake:w1:2026-8-15']);
    expect(dueWakeUp(config(wake()), fired, at('08:00:10'))).toBeNull();
  });
});

describe('startupCosts', () => {
  const session = (project: string, first: Partial<Usage>): SessionDetail =>
    detail([req('2026-09-15T10:00:00Z', first)], { project, repo: project });

  it('reports the typical preamble and what was written for it', () => {
    const [cost] = startupCosts([
      session('big', { cacheWrite: 30_000, input: 200 }),
      session('big', { cacheWrite: 24_000, input: 200 }),
      session('big', { cacheWrite: 26_000, input: 200 }),
    ]);
    expect(cost?.median).toBe(26_200);
    expect(cost?.worst).toBe(30_200);
    expect(cost?.sessions).toBe(3);
    expect(cost?.total).toBe(80_600);
  });

  // A start served from cache occupies the same window but adds nothing to the
  // bill, so it counts towards the median and not towards the total.
  it('counts a cached start in the context but not in what it cost', () => {
    const [cost] = startupCosts([
      session('warm', { cacheRead: 25_000, input: 100 }),
      session('warm', { cacheRead: 25_000, input: 100 }),
    ]);
    expect(cost?.median).toBe(25_100);
    expect(cost?.total).toBe(200);
  });

  it('ignores a project with too little to be typical of anything', () => {
    expect(startupCosts([session('once', { cacheWrite: 30_000 })])).toEqual([]);
  });
});

/**
 * The guard that ends an unattended keep-alive loop. Without it a session left
 * open overnight would be pinged until morning, which is the waste the app
 * exists to find rather than to cause.
 */
describe('stretch', () => {
  const held = (expectedRequests: number): Holding => ({
    sessionId: 's1',
    since: 1000,
    expectedRequests,
    announced: false,
    pings: 1,
  });

  it('keeps the stretch going while only our own turns have landed', () => {
    const holdings = new Map([['s1', held(10)]]);
    expect(stretch(holdings, 's1', 10)?.since).toBe(1000);
    expect(holdings.has('s1')).toBe(true);
  });

  it('ends the stretch as soon as somebody comes back to the session', () => {
    const holdings = new Map([['s1', held(10)]]);
    expect(stretch(holdings, 's1', 11)).toBeNull();
    expect(holdings.has('s1')).toBe(false);
  });

  it('has no stretch for a session it has never held', () => {
    expect(stretch(new Map(), 's9', 3)).toBeNull();
  });
});

describe('measureThreshold', () => {
  /** A Session that compacted at `at`, having reached `before` tokens first. */
  const compacted = (sizes: number[]): SessionDetail => {
    const requests = sizes.flatMap((size, i) => [
      req(`2026-09-15T1${i}:00:00Z`, { cacheRead: size }),
      req(`2026-09-15T1${i}:01:00Z`, { cacheRead: 5_000 }),
    ]);
    return detail(requests, {
      invalidations: sizes.map((_, i) => ({
        at: `2026-09-15T1${i}:01:00Z`,
        cause: 'compaction' as const,
      })),
    } as Partial<SessionDetail>);
  };

  it('reads the limit from the request before each compaction', () => {
    const found = measureThreshold([compacted([160_000, 172_000, 168_000])]);
    expect(found.samples).toBe(3);
    expect(found.tokens).toBe(168_000);
  });

  // Nothing to stand on is reported as nothing, never as a guessed default.
  it('reports no threshold when too little has compacted', () => {
    expect(measureThreshold([compacted([160_000])])).toEqual({ tokens: null, samples: 1 });
    expect(measureThreshold([detail([])])).toEqual({ tokens: null, samples: 0 });
  });
});

describe('turnsLeft', () => {
  it('divides the room left by the rate it is filling at', () => {
    expect(turnsLeft(100_000, 10_000, 160_000)).toBe(6);
  });

  it('is null when any part of the sum is unknown, and never negative', () => {
    expect(turnsLeft(100_000, 10_000, null)).toBeNull();
    expect(turnsLeft(100_000, 0, 160_000)).toBeNull();
    expect(turnsLeft(200_000, 10_000, 160_000)).toBe(0);
  });
});

describe('subagent spend alerts', () => {
  const withAgents = (each: number, count: number): SessionDetail =>
    detail([req('2026-09-15T10:00:00Z', { cacheWrite: 1000 })], {
      subagentDetail: Array.from({ length: count }, (_, i) => ({
        id: `a${i}`,
        type: 'Explore',
        description: 'look something up',
        usage: { ...EMPTY_USAGE, cacheWrite: each },
      })),
    } as Partial<SessionDetail>);

  it('says nothing until delegated spend is worth interrupting over', () => {
    expect(detectAlerts(withAgents(100_000, 4), new Set())).toEqual([]);
  });

  it('raises one alert naming the spend and the agent count', () => {
    const [alert] = detectAlerts(withAgents(1_000_000, 3), new Set());
    expect(alert?.kind).toBe('subagent-spend');
    expect(alert?.tokens).toBe(3_000_000);
  });

  // One per doubling, so crossing 2M does not re-announce at 2.1M and 2.2M.
  it('does not repeat itself until the spend doubles', () => {
    const seen = new Set(detectAlerts(withAgents(1_000_000, 3), new Set()).map((a) => a.id));
    expect(detectAlerts(withAgents(1_100_000, 3), seen)).toEqual([]);
    expect(detectAlerts(withAgents(2_000_000, 3), seen)).toHaveLength(1);
  });
});

/**
 * A wake-up that did not run must not count as having run.
 *
 * `dueWakeUp` decides purely from the config, the clock and the set of keys
 * already fired, so the guarantee being checked is that a key only keeps a
 * wake-up quiet for the day it actually names.
 */
describe('dueWakeUp and the fired set', () => {
  const wake: WakeUp = {
    id: 'w1',
    enabled: true,
    days: [2],
    at: '08:00',
    cwd: '/tmp/demo',
    prompt: 'ok',
  };
  const config: ToolsConfig = { wakeUps: [wake], actions: [] };
  const at = (t: string): Date => new Date(`2026-09-15T${t}`);

  it('comes back as due again once its key is withdrawn', () => {
    const fired = new Set(['wake:w1:2026-8-15']);
    expect(dueWakeUp(config, fired, at('08:01:00'))).toBeNull();

    // What the scheduler does when nothing actually started.
    fired.delete('wake:w1:2026-8-15');
    expect(dueWakeUp(config, fired, at('08:02:00'))?.id).toBe('w1');
  });

  // A key naming another day must not silence today's.
  it('is not silenced by a key from a different day', () => {
    expect(dueWakeUp(config, new Set(['wake:w1:2026-8-14']), at('08:01:00'))?.id).toBe('w1');
  });
});
