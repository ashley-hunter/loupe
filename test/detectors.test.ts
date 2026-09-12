import { describe, expect, it } from 'vitest';
import { findAll } from '../src/main/detectors.js';
import {
  EMPTY_USAGE,
  type Event,
  type Invalidation,
  type SessionDetail,
} from '../src/shared/model.js';

const invalidation = (p: Partial<Invalidation>): Invalidation => ({
  sessionId: 's1' as SessionDetail['id'],
  sessionName: 'Demo',
  project: 'demo',
  at: '2026-09-12T10:00:00Z',
  cause: 'reanchor',
  rewritten: 400_000,
  idleMs: 20_000,
  ...p,
});

const read = (id: string, path: string, cost: number): Event => ({
  id,
  kind: 'read',
  at: '2026-09-12T10:00:00Z',
  title: path,
  depth: 0,
  cost,
  path,
  tool: 'Read',
});

const session = (p: Partial<SessionDetail> = {}): SessionDetail => ({
  id: 's1' as SessionDetail['id'],
  path: '/s1.jsonl',
  project: 'demo',
  cwd: '/demo',
  name: 'Demo session',
  startedAt: '2026-09-12T10:00:00Z',
  endedAt: '2026-09-12T11:00:00Z',
  spanMs: 0,
  activeMs: 0,
  models: [],
  prompts: 1,
  toolCalls: 0,
  requestCount: 0,
  usage: EMPTY_USAGE,
  subagents: 0,
  status: 'completed',
  allowance: null,
  events: [],
  requests: [],
  subagentDetail: [],
  invalidations: [],
  ...p,
});

describe('re-anchoring', () => {
  it('reports a session that rebuilt its prefix repeatedly', () => {
    const [f] = findAll([
      session({
        invalidations: [invalidation({}), invalidation({}), invalidation({})],
      }),
    ]);
    expect(f?.category).toBe('context');
    expect(f?.recoverable).toBe(1_200_000);
    expect(f?.text).toContain('3 times');
    expect(f?.text).toContain('1.20M');
    expect(f?.tab).toBe('cache');
  });

  it('stays quiet about a single rebuild, which is not a pattern', () => {
    expect(findAll([session({ invalidations: [invalidation({})] })])).toEqual([]);
  });

  it('ignores idle expiry, which is nobody’s mistake', () => {
    const idle = [invalidation({ cause: 'expiry' }), invalidation({ cause: 'expiry' })];
    expect(findAll([session({ invalidations: idle })])).toEqual([]);
  });
});

describe('duplicate reads', () => {
  it('charges only the repeats, not the whole file', () => {
    // Three reads of a 90k file: two of them are the waste.
    const events = [
      read('a', '/big.ts', 30_000),
      read('b', '/big.ts', 30_000),
      read('c', '/big.ts', 30_000),
    ];
    const [f] = findAll([session({ events })]);
    expect(f?.category).toBe('duplication');
    expect(f?.recoverable).toBe(60_000);
    expect(f?.text).toContain('read 3 times');
    expect(f?.tab).toBe('files');
  });

  it('says nothing about a file read once', () => {
    expect(findAll([session({ events: [read('a', '/big.ts', 90_000)] })])).toEqual([]);
  });

  it('ignores repeats too small to be worth acting on', () => {
    const events = [read('a', '/tiny.ts', 500), read('b', '/tiny.ts', 500)];
    expect(findAll([session({ events })])).toEqual([]);
  });
});

describe('mid-session model change', () => {
  it('reports the rewrite and names the change', () => {
    const [f] = findAll([
      session({
        invalidations: [
          invalidation({
            cause: 'model-change',
            rewritten: 90_000,
            detail: 'claude-opus-5 → claude-sonnet-5',
          }),
        ],
      }),
    ]);
    expect(f?.category).toBe('cache');
    expect(f?.recoverable).toBe(90_000);
    expect(f?.evidence).toBe('claude-opus-5 → claude-sonnet-5');
  });
});

describe('findAll', () => {
  it('ranks the worst finding first across sessions', () => {
    const small = session({
      id: 'small' as SessionDetail['id'],
      events: [read('a', '/x.ts', 30_000), read('b', '/x.ts', 30_000)],
    });
    const large = session({
      id: 'large' as SessionDetail['id'],
      invalidations: [invalidation({}), invalidation({})],
    });
    const found = findAll([small, large]);
    expect(found.map((f) => f.recoverable)).toEqual([800_000, 30_000]);
  });
});
