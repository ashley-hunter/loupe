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

/**
 * The four-way split is what the whole conversation view reads from, and the
 * one invariant that must never break is that it sums to the turn's own cost.
 * A ledger that drifts from the figure printed beside it is worse than no
 * ledger at all.
 */
describe('what a turn spent it on', () => {
  const usage = (over: Partial<Request['usage']>): Request['usage'] => ({
    ...EMPTY_USAGE,
    ...over,
  });

  const turnOf = (
    r: Request,
    invalidations: Invalidation[] = [],
  ): ReturnType<typeof toTurns>[0] => {
    const [turn] = toTurns(
      session({
        events: [
          ev({ id: 'p', kind: 'user', at: r.at, title: 'do a thing' }),
          ev({ id: 'w', kind: 'bash', at: r.at, request: r.id }),
        ],
        requests: [r],
        invalidations,
      }),
    );
    return turn!;
  };

  const rebuild = (at: string, rewritten: number): Invalidation =>
    ({ at, cause: 'expiry', rewritten, idleMs: 0 }) as Invalidation;

  it('always sums to the turn cost', () => {
    const t = turnOf({
      ...req('r1', '2026-09-12T10:00:00Z', 0),
      usage: usage({ cacheWrite: 80, output: 15, input: 5 }),
    });
    const { rewritten, added, produced, input } = t.ledger;
    expect(rewritten + added + produced + input).toBe(t.cost);
  });

  it('calls a cache write growth when nothing was invalidated', () => {
    const t = turnOf({
      ...req('r1', '2026-09-12T10:00:00Z', 0),
      usage: usage({ cacheWrite: 50_000, output: 900 }),
    });
    expect(t.ledger.added).toBe(50_000);
    expect(t.ledger.rewritten).toBe(0);
    expect(t.why).toBe('added');
  });

  // The distinction the whole design turns on: the same cache write means
  // opposite things depending on whether a rebuild happened.
  it('calls it re-payment when one did', () => {
    const t = turnOf(
      { ...req('r1', '2026-09-12T10:00:00Z', 0), usage: usage({ cacheWrite: 50_000 }) },
      [rebuild('2026-09-12T10:00:00Z', 50_000)],
    );
    expect(t.ledger.rewritten).toBe(50_000);
    expect(t.ledger.added).toBe(0);
    expect(t.why).toBe('rewritten');
  });

  // A rebuild is recorded against one request; a turn must never report more
  // re-payment than it actually wrote.
  it('never reports more re-paid than was written', () => {
    const t = turnOf(
      { ...req('r1', '2026-09-12T10:00:00Z', 0), usage: usage({ cacheWrite: 1_000 }) },
      [rebuild('2026-09-12T10:00:00Z', 900_000)],
    );
    expect(t.ledger.rewritten).toBe(1_000);
    expect(t.ledger.added).toBe(0);
  });

  it('names the biggest part, and nothing when there was no cost', () => {
    const quiet = turnOf({ ...req('r1', '2026-09-12T10:00:00Z', 0), usage: usage({}) });
    expect(quiet.why).toBeNull();

    const thought = turnOf({
      ...req('r1', '2026-09-12T10:00:00Z', 0),
      usage: usage({ cacheWrite: 100, output: 9_000 }),
    });
    expect(thought.why).toBe('produced');
  });
});

describe('subagents belong to the turn that spawned them', () => {
  const agent = (toolUseId: string | null, cost: number) =>
    ({
      id: `a-${String(toolUseId)}`,
      type: 'Explore',
      description: 'look it up',
      toolUseId,
      usage: { ...EMPTY_USAGE, cacheWrite: cost },
    }) as SessionDetail['subagentDetail'][0];

  const spawned = (agents: SessionDetail['subagentDetail']) =>
    toTurns(
      session({
        events: [
          ev({ id: 'p', kind: 'user', at: '2026-09-12T10:00:00Z', title: 'delegate it' }),
          ev({ id: 'call', kind: 'agent', at: '2026-09-12T10:00:01Z', toolUseId: 'tu-1' }),
        ],
        requests: [],
        subagentDetail: agents,
      }),
    )[0]!;

  it('attributes an agent to the turn holding the call that started it', () => {
    const t = spawned([agent('tu-1', 900_000)]);
    expect(t.agents).toHaveLength(1);
    expect(t.delegated).toBe(900_000);
    // Delegated spend competes with the rest even though it sits outside cost.
    expect(t.why).toBe('delegated');
  });

  // Subagent spend has its own context window and must never join the session's
  // own total, or every figure in the app double-counts it.
  it('keeps delegated spend out of the turn cost', () => {
    const t = spawned([agent('tu-1', 900_000)]);
    expect(t.cost).toBe(0);
  });

  it('claims no agent whose spawning call has gone', () => {
    const t = spawned([agent(null, 500_000), agent('tu-other', 500_000)]);
    expect(t.agents).toEqual([]);
    expect(t.delegated).toBe(0);
  });
});
