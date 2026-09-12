import { describe, expect, it } from 'vitest';
import { findInvalidations, summarise } from '../src/main/invalidations.js';
import { EMPTY_USAGE, type Request, type SessionSummary, type Usage } from '../src/shared/model.js';

const session = {
  id: 's1' as SessionSummary['id'],
  name: 'Demo',
  project: 'demo',
} as SessionSummary;

const req = (
  at: string,
  usage: Partial<Usage>,
  opts: { model?: string; oneHourWrite?: number } = {},
): Request => ({
  id: `req-${at}` as Request['id'],
  at,
  model: opts.model ?? 'claude-opus-5',
  usage: { ...EMPTY_USAGE, ...usage },
  toolCalls: 0,
  oneHourWrite: opts.oneHourWrite ?? 0,
});

// A healthy prefix, then a rebuild.
const healthy = (at: string, o?: { model?: string; oneHourWrite?: number }) =>
  req(at, { cacheRead: 90_000, cacheWrite: 500 }, o);
const rebuilt = (at: string, o?: { model?: string }) =>
  req(at, { cacheRead: 0, cacheWrite: 95_000 }, o);

describe('findInvalidations', () => {
  it('blames idle time when the gap exceeds the five-minute TTL', () => {
    const found = findInvalidations(session, [
      healthy('2026-09-12T10:00:00Z'),
      rebuilt('2026-09-12T11:30:00Z'),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]?.cause).toBe('expiry');
    expect(found[0]?.rewritten).toBe(95_000);
  });

  it('allows an hour when the previous request used the one-hour cache', () => {
    const found = findInvalidations(session, [
      healthy('2026-09-12T10:00:00Z', { oneHourWrite: 500 }),
      rebuilt('2026-09-12T10:30:00Z'),
    ]);
    // Thirty minutes is idle for a five-minute cache but not for an hour one, so
    // this must not be blamed on expiry — it is classified on its shape instead.
    expect(found[0]?.cause).not.toBe('expiry');

    // The same gap without the one-hour cache is expiry.
    const fiveMinute = findInvalidations(session, [
      healthy('2026-09-12T10:00:00Z'),
      rebuilt('2026-09-12T10:30:00Z'),
    ]);
    expect(fiveMinute[0]?.cause).toBe('expiry');
  });

  it('blames a model change when it happened inside the TTL', () => {
    const found = findInvalidations(session, [
      healthy('2026-09-12T10:00:00Z', { model: 'claude-opus-5' }),
      rebuilt('2026-09-12T10:01:00Z', { model: 'claude-sonnet-5' }),
    ]);
    expect(found[0]?.cause).toBe('model-change');
    expect(found[0]?.detail).toBe('claude-opus-5 → claude-sonnet-5');
  });

  it('prefers idle time over a model change that followed a long break', () => {
    // The break alone explains the rebuild; the model change is incidental.
    const found = findInvalidations(session, [
      healthy('2026-09-12T10:00:00Z', { model: 'claude-opus-5' }),
      rebuilt('2026-09-12T12:00:00Z', { model: 'claude-sonnet-5' }),
    ]);
    expect(found[0]?.cause).toBe('expiry');
  });

  it('recognises a prefix re-anchored above a small stable base', () => {
    // Measured shape: reads collapse to a ~28k floor, most of the prefix is
    // rewritten, seconds after the previous request. 45% of real invalidations.
    const found = findInvalidations(session, [
      req('2026-09-12T10:00:00Z', { cacheRead: 428_000, cacheWrite: 2_000 }),
      req('2026-09-12T10:00:22Z', { cacheRead: 28_000, cacheWrite: 370_000 }),
    ]);
    expect(found[0]?.cause).toBe('reanchor');
  });

  it('calls a shrinking context compaction, not waste', () => {
    // Measured shape: a 1M context replaced by ~54k. The rebuild is tiny and the
    // saving is large, so reporting it as an avoidable invalidation is wrong.
    const found = findInvalidations(session, [
      req('2026-09-12T10:00:00Z', { cacheRead: 960_000, cacheWrite: 37_000 }),
      req('2026-09-12T10:02:00Z', { cacheRead: 34_000, cacheWrite: 25_000 }),
    ]);
    expect(found[0]?.cause).toBe('compaction');
    expect(summarise(found).avoidable).toEqual([]);
  });

  it('prefers compaction over idle expiry when the context shrank', () => {
    const found = findInvalidations(session, [
      req('2026-09-12T10:00:00Z', { cacheRead: 960_000, cacheWrite: 37_000 }),
      req('2026-09-12T13:00:00Z', { cacheRead: 34_000, cacheWrite: 25_000 }),
    ]);
    expect(found[0]?.cause).toBe('compaction');
  });

  it('says undetermined rather than inventing a cause', () => {
    // Within the TTL, same model. The context neither shrank enough to be
    // compaction nor survived enough to be re-anchoring, so nothing explains it.
    const found = findInvalidations(session, [
      req('2026-09-12T10:00:00Z', { cacheRead: 100_000, cacheWrite: 500 }),
      req('2026-09-12T10:01:00Z', { cacheRead: 25_000, cacheWrite: 40_000 }),
    ]);
    expect(found[0]?.cause).toBe('undetermined');
  });

  it('ignores a small prefix and ordinary cache growth', () => {
    expect(
      findInvalidations(session, [
        req('2026-09-12T10:00:00Z', { cacheRead: 900, cacheWrite: 100 }),
        req('2026-09-12T10:01:00Z', { cacheRead: 0, cacheWrite: 950 }),
      ]),
    ).toHaveLength(0);

    expect(
      findInvalidations(session, [
        healthy('2026-09-12T10:00:00Z'),
        req('2026-09-12T10:01:00Z', { cacheRead: 90_500, cacheWrite: 800 }),
      ]),
    ).toHaveLength(0);
  });
});

describe('summarise', () => {
  it('separates what is worth acting on from idle expiry', () => {
    const all = findInvalidations(session, [
      healthy('2026-09-12T10:00:00Z', { model: 'claude-opus-5' }),
      rebuilt('2026-09-12T10:01:00Z', { model: 'claude-sonnet-5' }),
      healthy('2026-09-12T10:02:00Z'),
      rebuilt('2026-09-12T13:00:00Z'),
    ]);
    const s = summarise(all);
    // Only the model change is actionable; expiry and re-anchoring are counted.
    expect(s.avoidable.map((i) => i.cause)).toEqual(['model-change']);
    expect(s.expiry.count).toBe(1);
    expect(s.expiry.rewritten).toBe(95_000);
    expect(s.reanchor.count).toBe(0);
    expect(s.compaction.count).toBe(0);
  });
});
