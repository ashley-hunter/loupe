import { describe, expect, it } from 'vitest';
import { toTurns } from '../src/shared/turns.js';
import {
  EMPTY_USAGE,
  type Event,
  type Invalidation,
  type Request,
  type SessionDetail,
} from '../src/shared/model.js';

const ev = (p: Partial<Event> & { id: string; kind: Event['kind']; at: string }): Event => ({
  depth: 0,
  title: p.id,
  cost: null,
  ...p,
});

const req = (id: string, at: string, newTokens: number): Request => ({
  id: id as Request['id'],
  at,
  model: 'claude-opus-5',
  usage: { ...EMPTY_USAGE, input: 5, cacheWrite: newTokens - 5, cacheRead: 40_000 },
  oneHourWrite: 0,
  toolCalls: 1,
});

const session = (p: Partial<SessionDetail>): SessionDetail =>
  ({
    id: 's1',
    path: '/s.jsonl',
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
    status: 'completed',
    allowance: null,
    events: [],
    requests: [],
    subagentDetail: [],
    invalidations: [],
    ...p,
  }) as SessionDetail;

describe('toTurns', () => {
  it('opens a turn at each prompt and gathers the work under it', () => {
    const turns = toTurns(
      session({
        events: [
          ev({ id: 'p1', kind: 'user', at: '2026-09-12T10:00:00Z', title: 'Fix the total' }),
          ev({
            id: 'a1',
            kind: 'asst',
            at: '2026-09-12T10:00:10Z',
            request: 'r1' as Request['id'],
          }),
          ev({
            id: 't1',
            kind: 'read',
            at: '2026-09-12T10:00:11Z',
            request: 'r1' as Request['id'],
          }),
          ev({ id: 'p2', kind: 'user', at: '2026-09-12T10:05:00Z', title: 'Now test it' }),
          ev({
            id: 'a2',
            kind: 'asst',
            at: '2026-09-12T10:05:10Z',
            request: 'r2' as Request['id'],
          }),
        ],
        requests: [
          req('r1', '2026-09-12T10:00:10Z', 30_000),
          req('r2', '2026-09-12T10:05:10Z', 9_000),
        ],
      }),
    );

    expect(turns).toHaveLength(2);
    expect(turns[0]?.prompt?.title).toBe('Fix the total');
    // Order is preserved: the reply, then the tool call it led to.
    expect(turns[0]?.items.map((e) => e.id)).toEqual(['a1', 't1']);
    expect(turns[0]?.cost).toBe(30_000);
    expect(turns[1]?.cost).toBe(9_000);
  });

  it('keeps work that precedes the first prompt, as a resumed session has', () => {
    const turns = toTurns(
      session({
        events: [
          ev({
            id: 'a0',
            kind: 'asst',
            at: '2026-09-12T09:59:00Z',
            request: 'r0' as Request['id'],
          }),
          ev({ id: 'p1', kind: 'user', at: '2026-09-12T10:00:00Z' }),
        ],
        requests: [req('r0', '2026-09-12T09:59:00Z', 5_000)],
      }),
    );
    expect(turns).toHaveLength(2);
    expect(turns[0]?.prompt).toBeNull();
    expect(turns[0]?.cost).toBe(5_000);
  });

  it('attaches a rebuild to the turn that paid for it', () => {
    const rebuild: Invalidation = {
      sessionId: 's1' as SessionDetail['id'],
      sessionName: 'Demo',
      project: 'demo',
      repo: 'demo',
      at: '2026-09-12T10:04:30Z',
      cause: 'reanchor',
      rewritten: 240_000,
      idleMs: 20_000,
    };
    const turns = toTurns(
      session({
        events: [
          ev({ id: 'p1', kind: 'user', at: '2026-09-12T10:00:00Z' }),
          ev({ id: 'p2', kind: 'user', at: '2026-09-12T10:05:00Z' }),
        ],
        invalidations: [rebuild],
      }),
    );
    expect(turns[0]?.rebuilds).toHaveLength(0);
    expect(turns[1]?.rebuilds.map((r) => r.rewritten)).toEqual([240_000]);
  });
});
