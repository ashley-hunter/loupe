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
  at,
  cause: 'reanchor',
  rewritten: 400_000,
  idleMs: 20_000,
});

const session = (p: Partial<SessionDetail> = {}): SessionDetail => ({
  id: 's1' as SessionDetail['id'],
  path: '/s1.jsonl',
  project: 'demo',
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
    const alerts = detectAlerts(session({ events }), new Set());
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.kind).toBe('oversized-result');
    expect(alerts[0]?.title).toContain('90.0k');
    // Compared against this session's own typical result — the median of
    // [900, 1000, 1200, 90000] is the upper middle, 1.2k.
    expect(alerts[0]?.detail).toContain('typical result here is 1.2k');
  });

  it('leaves a merely large result alone when the session is all large', () => {
    const events = [ev('a', 40_000), ev('b', 45_000), ev('c', 50_000)];
    expect(detectAlerts(session({ events }), new Set())).toEqual([]);
  });

  it('never fires below the floor, however unusual', () => {
    // 60x the median, but 3k is not worth interrupting anyone over.
    const events = [ev('a', 50), ev('b', 50), ev('c', 3000)];
    expect(detectAlerts(session({ events }), new Set())).toEqual([]);
  });

  it('does not raise the same alert twice', () => {
    const events = [ev('a', 1000), ev('b', 1000), ev('c', 90_000)];
    const first = detectAlerts(session({ events }), new Set());
    const seen = new Set(first.map((a) => a.id));
    expect(detectAlerts(session({ events }), seen)).toEqual([]);
  });
});

describe('prefix rebuilds', () => {
  it('fires once three land inside the window', () => {
    const invalidations = [
      reanchor('2026-09-12T10:00:00Z'),
      reanchor('2026-09-12T10:03:00Z'),
      reanchor('2026-09-12T10:06:00Z'),
    ];
    const alerts = detectAlerts(session({ invalidations }), new Set());
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
    expect(detectAlerts(session({ invalidations }), new Set())).toEqual([]);
  });

  it('ignores idle expiry, which is nobody being wasteful', () => {
    const idle = [1, 2, 3].map((n) => ({
      ...reanchor(`2026-09-12T10:0${n}:00Z`),
      cause: 'expiry' as const,
    }));
    expect(detectAlerts(session({ invalidations: idle }), new Set())).toEqual([]);
  });
});
