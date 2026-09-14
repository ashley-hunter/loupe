import { describe, expect, it } from 'vitest';
import { detectAlerts } from '../src/main/alerts.js';
import {
  EMPTY_USAGE,
  type Event,
  type Invalidation,
  type SessionDetail,
} from '../src/shared/model.js';

const ev = (id: string, cost: number | null, at = '2026-09-12T10:00:00Z'): Event => ({
  id,
  kind: 'read',
  at,
  title: `/file-${id}.ts`,
  depth: 0,
  cost,
});

const reanchor = (at: string): Invalidation => ({
  sessionId: 's1' as SessionDetail['id'],
  sessionName: 'Demo',
  project: 'demo',
  repo: 'demo',
  at,
  cause: 'reanchor',
  rewritten: 400_000,
  idleMs: 20_000,
});

/**
 * A fixed "now" for the fixtures, minutes after they happen, so the recency
 * guard sees them as fresh without the tests depending on the wall clock.
 */
const NOW = Date.parse('2026-09-12T10:10:00Z');

const session = (p: Partial<SessionDetail> = {}): SessionDetail => ({
  id: 's1' as SessionDetail['id'],
  path: '/s1.jsonl',
  project: 'demo',
  repo: 'demo',
  cwd: '/demo',
  name: 'Demo',
  startedAt: '2026-09-12T10:00:00Z',
  endedAt: '2026-09-12T11:00:00Z',
  spanMs: 0,
  activeMs: 0,
  models: [],
  prompts: 0,
  toolCalls: 0,
  requestCount: 0,
  usage: EMPTY_USAGE,
  subagents: 0,
  subagentUsage: EMPTY_USAGE,
  status: 'active',
  allowance: null,
  events: [],
  requests: [],
  subagentDetail: [],
  invalidations: [],
  ...p,
});

describe('oversized results', () => {
  it('flags a result far above the session norm', () => {
    const events = [ev('a', 1000), ev('b', 1200), ev('c', 900), ev('d', 90_000)];
    const alerts = detectAlerts(session({ events }), new Set(), NOW);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.kind).toBe('oversized-result');
    expect(alerts[0]?.title).toContain('90.0k');
    // Compared against this session's own typical result — the median of
    // [900, 1000, 1200, 90000] is the upper middle, 1.2k.
    expect(alerts[0]?.detail).toContain('typical result here is 1.2k');
  });

  it('leaves a merely large result alone when the session is all large', () => {
    const events = [ev('a', 40_000), ev('b', 45_000), ev('c', 50_000)];
    expect(detectAlerts(session({ events }), new Set(), NOW)).toEqual([]);
  });

  it('never fires below the floor, however unusual', () => {
    // 60x the median, but 3k is not worth interrupting anyone over.
    const events = [ev('a', 50), ev('b', 50), ev('c', 3000)];
    expect(detectAlerts(session({ events }), new Set(), NOW)).toEqual([]);
  });

  it('does not raise the same alert twice', () => {
    const events = [ev('a', 1000), ev('b', 1000), ev('c', 90_000)];
    const first = detectAlerts(session({ events }), new Set(), NOW);
    const seen = new Set(first.map((a) => a.id));
    expect(detectAlerts(session({ events }), seen, NOW)).toEqual([]);
  });
});

describe('prefix rebuilds', () => {
  it('fires once three land inside the window', () => {
    const invalidations = [
      reanchor('2026-09-12T10:00:00Z'),
      reanchor('2026-09-12T10:03:00Z'),
      reanchor('2026-09-12T10:06:00Z'),
    ];
    const alerts = detectAlerts(session({ invalidations }), new Set(), NOW);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.kind).toBe('prefix-rebuilt');
    expect(alerts[0]?.title).toContain('3 times');
  });

  it('stays quiet when the three are spread out', () => {
    const invalidations = [
      reanchor('2026-09-12T10:00:00Z'),
      reanchor('2026-09-12T10:30:00Z'),
      reanchor('2026-09-12T11:00:00Z'),
    ];
    expect(detectAlerts(session({ invalidations }), new Set(), NOW)).toEqual([]);
  });

  it('ignores idle expiry, which is nobody being wasteful', () => {
    const idle = [1, 2, 3].map((n) => ({
      ...reanchor(`2026-09-12T10:0${n}:00Z`),
      cause: 'expiry' as const,
    }));
    expect(detectAlerts(session({ invalidations: idle }), new Set(), NOW)).toEqual([]);
  });
});

describe('alert evidence', () => {
  it('names the session and where to look', () => {
    const [alert] = detectAlerts(
      session({ events: [ev('a', 1000), ev('b', 1000), ev('big', 900_000)] }),
      new Set(),
      NOW,
    );
    expect(alert?.sessionName).toBe('Demo');
    expect(alert?.sessionPath).toBe('/s1.jsonl');
    expect(alert?.tab).toBe('timeline');
    // One Event is the whole story, so arriving should select it.
    expect(alert?.eventId).toBe('big');
  });

  it('sends a rebuild to the cache breakdown, listing every rebuild', () => {
    const [alert] = detectAlerts(
      session({
        invalidations: [
          reanchor('2026-09-12T10:00:00Z'),
          reanchor('2026-09-12T10:02:00Z'),
          reanchor('2026-09-12T10:04:00Z'),
        ],
      }),
      new Set(),
      NOW,
    );
    expect(alert?.tab).toBe('cache');
    expect(alert?.evidence.filter((e) => e.label.startsWith('Prefix rebuilt'))).toHaveLength(3);
  });

  it('shows what was growing the context, costliest first', () => {
    const [alert] = detectAlerts(
      session({
        events: [
          ev('small', 5_000, '2026-09-12T10:01:00Z'),
          ev('huge', 300_000, '2026-09-12T10:03:00Z'),
          // Outside the run's span, so not evidence for this rebuild.
          ev('later', 900_000, '2026-09-12T11:30:00Z'),
        ],
        invalidations: [
          reanchor('2026-09-12T10:00:00Z'),
          reanchor('2026-09-12T10:02:00Z'),
          reanchor('2026-09-12T10:04:00Z'),
        ],
      }),
      new Set(),
      NOW,
    );
    const grew = alert?.evidence.filter((e) => e.label.startsWith('Added to the context')) ?? [];
    expect(grew.map((e) => e.tokens)).toEqual([300_000, 5_000]);
    expect(grew.some((e) => e.label.includes('later'))).toBe(false);
  });
});

describe('alert volume', () => {
  it('raises one alert per run of rebuilds, not one per sliding window', () => {
    // Five rebuilds two minutes apart used to produce three near-identical
    // alerts, because every window of three qualified.
    const invalidations = [0, 2, 4, 6, 8].map((m) => reanchor(`2026-09-12T10:0${String(m)}:00Z`));
    const alerts = detectAlerts(session({ invalidations }), new Set(), NOW);
    expect(alerts).toHaveLength(1);
  });
});

describe('repeat parses', () => {
  it('picks the same run however many times the session is re-read', () => {
    // The live Session is re-parsed on every write. If the run chosen depended
    // on what had already been raised, each pass would announce the next
    // overlapping window: the same finding, one rebuild along.
    const invalidations = [0, 2, 4, 6, 8].map((m) => reanchor(`2026-09-12T10:0${String(m)}:00Z`));
    const first = detectAlerts(session({ invalidations }), new Set(), NOW);
    const seen = new Set(first.map((a) => a.id));
    expect(detectAlerts(session({ invalidations }), seen, NOW)).toEqual([]);
  });
});
