import { describe, expect, it } from 'vitest';
import { byFile, byTool } from '../src/shared/aggregate.js';
import type { Event, RequestId } from '../src/shared/model.js';

const ev = (p: Partial<Event> & Pick<Event, 'id' | 'kind'>): Event => ({
  at: '2026-09-12T10:00:00Z',
  title: p.id,
  depth: 0,
  cost: null,
  ...p,
});

describe('byFile', () => {
  it('counts reads and edits per file and ranks by cost', () => {
    const rows = byFile([
      ev({ id: 'a', kind: 'read', path: '/big.ts', cost: 18_000, tool: 'Read' }),
      ev({ id: 'b', kind: 'read', path: '/big.ts', cost: 18_000, tool: 'Read' }),
      ev({ id: 'c', kind: 'edit', path: '/big.ts', cost: 300, tool: 'Edit' }),
      ev({ id: 'd', kind: 'read', path: '/small.ts', cost: 500, tool: 'Read' }),
    ]);

    expect(rows.map((r) => r.key)).toEqual(['/big.ts', '/small.ts']);
    expect(rows[0]).toMatchObject({ reads: 2, edits: 1, cost: 36_300, unmeasured: 0 });
  });

  it('reports unmeasurable costs rather than treating them as zero', () => {
    const [row] = byFile([
      ev({ id: 'a', kind: 'read', path: '/x.ts', cost: 100 }),
      ev({ id: 'b', kind: 'read', path: '/x.ts', cost: null }),
    ]);
    expect(row).toMatchObject({ cost: 100, unmeasured: 1, events: 2 });
  });

  it('ignores events with no file', () => {
    expect(byFile([ev({ id: 'a', kind: 'bash', cost: 10, tool: 'Bash' })])).toEqual([]);
  });
});

describe('byTool', () => {
  it('counts one shared cost per request, not once per tool call', () => {
    // Both calls came from one request whose prefix grew once by 900 tokens.
    const rows = byTool([
      ev({
        id: 'a',
        kind: 'read',
        tool: 'Read',
        cost: 900,
        sharedCost: true,
        request: 'r1' as RequestId,
      }),
      ev({
        id: 'b',
        kind: 'read',
        tool: 'Read',
        cost: 900,
        sharedCost: true,
        request: 'r1' as RequestId,
      }),
    ]);
    expect(rows[0]).toMatchObject({ key: 'Read', events: 2, cost: 900 });
  });

  it('still counts shared costs from different requests separately', () => {
    const rows = byTool([
      ev({
        id: 'a',
        kind: 'read',
        tool: 'Read',
        cost: 900,
        sharedCost: true,
        request: 'r1' as RequestId,
      }),
      ev({
        id: 'b',
        kind: 'read',
        tool: 'Read',
        cost: 500,
        sharedCost: true,
        request: 'r2' as RequestId,
      }),
    ]);
    expect(rows[0]?.cost).toBe(1400);
  });

  it('ranks tools by what their results cost', () => {
    const rows = byTool([
      ev({ id: 'a', kind: 'bash', tool: 'Bash', cost: 100 }),
      ev({ id: 'b', kind: 'read', tool: 'Read', cost: 9000 }),
    ]);
    expect(rows.map((r) => r.key)).toEqual(['Read', 'Bash']);
  });
});
