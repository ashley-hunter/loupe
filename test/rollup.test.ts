import { describe, expect, it } from 'vitest';
import { byDay, byModel } from '../src/shared/rollup.js';
import { EMPTY_USAGE, type SessionSummary, type Usage } from '../src/shared/model.js';

const s = (
  id: string,
  startedAt: string,
  model: string,
  usage: Partial<Usage> = {},
): SessionSummary => ({
  id: id as SessionSummary['id'],
  path: `/${id}.jsonl`,
  project: 'demo',
  cwd: '/demo',
  name: id,
  startedAt,
  endedAt: startedAt,
  spanMs: 0,
  activeMs: 0,
  models: [model],
  prompts: 0,
  toolCalls: 0,
  requestCount: 0,
  usage: { ...EMPTY_USAGE, ...usage },
  subagents: 0,
  status: 'completed',
  allowance: null,
});

describe('byDay', () => {
  const today = new Date('2026-09-12T12:00:00Z');

  it('keeps quiet days as gaps, not zeroes', () => {
    const days = byDay(
      [s('a', '2026-09-12T09:00:00Z', 'claude-opus-5', { output: 100 })],
      3,
      today,
    );
    expect(days).toHaveLength(3);
    // A day with no sessions must be null so the chart can draw a gap.
    expect(days[0]?.cacheHit).toBeNull();
    expect(days[0]?.sessions).toBe(0);
    expect(days[2]?.sessions).toBe(1);
  });

  it('sums new tokens per day without counting cache reads', () => {
    const day = '2026-09-12T09:00:00Z';
    const days = byDay(
      [
        s('a', day, 'claude-opus-5', { input: 10, cacheWrite: 20, output: 30, cacheRead: 9_000 }),
        s('b', day, 'claude-opus-5', { input: 1, cacheWrite: 2, output: 3, cacheRead: 9_000 }),
      ],
      1,
      today,
    );
    expect(days[0]?.newTokens).toBe(66); // cacheRead excluded
  });
});

describe('byModel', () => {
  it('ranks models by new tokens and shares sum to one', () => {
    const rows = byModel([
      s('a', '2026-09-12T09:00:00Z', 'claude-opus-5', { output: 300 }),
      s('b', '2026-09-12T09:00:00Z', 'claude-haiku-4-5', { output: 100 }),
    ]);
    expect(rows.map((r) => r.model)).toEqual(['claude-opus-5', 'claude-haiku-4-5']);
    expect(rows[0]?.share).toBeCloseTo(0.75);
    expect(rows.reduce((n, r) => n + r.share, 0)).toBeCloseTo(1);
  });

  it('ignores sessions with no model recorded', () => {
    const none = { ...s('a', '2026-09-12T09:00:00Z', 'x'), models: [] };
    expect(byModel([none])).toEqual([]);
  });
});
