import { describe, expect, it } from 'vitest';
import { byDay, byModel } from '../src/shared/rollup.js';
import { cacheHitRate, EMPTY_USAGE } from '../src/shared/model.js';

describe('a machine with no sessions', () => {
  it('produces a full, empty day series rather than nothing', () => {
    const days = byDay([], 14);
    expect(days).toHaveLength(14);
    expect(days.every((d) => d.cacheHit === null && d.newTokens === 0)).toBe(true);
  });
  it('has no models and no NaN share', () => {
    expect(byModel([])).toEqual([]);
  });
  it('reports an unknowable cache rate as null, not NaN', () => {
    expect(cacheHitRate(EMPTY_USAGE)).toBeNull();
  });
});
