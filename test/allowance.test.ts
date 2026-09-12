import { describe, expect, it } from 'vitest';
import { attribute, riseBetween } from '../src/main/allowance.js';
import { parseUsage } from '../src/main/usage.js';
import { EMPTY_USAGE, type SessionSummary, type UsageSample } from '../src/shared/model.js';

const sample = (at: string, session: number, weekly = 0): UsageSample => ({
  at,
  limits: [
    { kind: 'session', percent: session, resetsAt: null, severity: 'normal', model: null },
    { kind: 'weekly_all', percent: weekly, resetsAt: null, severity: 'normal', model: null },
  ],
});

const session = (id: string, startedAt: string, endedAt: string): SessionSummary => ({
  id: id as SessionSummary['id'],
  path: `/${id}.jsonl`,
  project: 'demo',
  cwd: '/x/demo',
  name: id,
  startedAt,
  endedAt,
  spanMs: 0,
  activeMs: 0,
  models: [],
  prompts: 0,
  toolCalls: 0,
  requestCount: 0,
  usage: EMPTY_USAGE,
  subagents: 0,
  status: 'completed',
  allowance: null,
});

describe('parseUsage', () => {
  it('reads the three real limits and ignores the rest', () => {
    // Shape recorded from the live endpoint.
    const body = {
      limits: [
        {
          kind: 'session',
          group: 'session',
          percent: 10,
          severity: 'normal',
          resets_at: '2026-09-12T13:50:00Z',
          scope: null,
          is_active: true,
        },
        {
          kind: 'weekly_all',
          group: 'weekly',
          percent: 9,
          severity: 'normal',
          resets_at: '2026-09-18T15:00:00Z',
          scope: null,
          is_active: false,
        },
        {
          kind: 'weekly_scoped',
          group: 'weekly',
          percent: 2,
          severity: 'normal',
          resets_at: '2026-09-18T15:00:00Z',
          scope: { model: { id: null, display_name: 'Fable' } },
          is_active: false,
        },
        {
          kind: 'some_future_codename',
          group: 'other',
          percent: 4,
          severity: 'normal',
          resets_at: null,
          scope: null,
          is_active: false,
        },
      ],
    };
    const s = parseUsage(body, new Date('2026-09-12T12:00:00Z'));
    expect(s?.limits.map((l) => l.kind)).toEqual(['session', 'weekly_all', 'weekly_scoped']);
    expect(s?.limits[0]?.percent).toBe(10);
    expect(s?.limits[2]?.model).toBe('Fable');
  });

  it('returns null rather than a guess when the response changes shape', () => {
    expect(parseUsage({}, new Date())).toBeNull();
    expect(parseUsage({ limits: [] }, new Date())).toBeNull();
  });
});

describe('riseBetween', () => {
  const samples = [sample('2026-09-12T10:00:00Z', 10), sample('2026-09-12T11:00:00Z', 34)];

  it('is the measured rise across the span', () => {
    expect(
      riseBetween(
        samples,
        'session',
        Date.parse('2026-09-12T10:00:00Z'),
        Date.parse('2026-09-12T11:00:00Z'),
      ),
    ).toBe(24);
  });

  it('reports the post-reset figure when the window reset mid-span', () => {
    // 40% -> 5% is a reset, not a 35-point fall. The pre-reset portion is gone.
    const reset = [sample('2026-09-12T10:00:00Z', 40), sample('2026-09-12T11:00:00Z', 5)];
    expect(
      riseBetween(
        reset,
        'session',
        Date.parse('2026-09-12T10:00:00Z'),
        Date.parse('2026-09-12T11:00:00Z'),
      ),
    ).toBe(5);
  });

  it('is null when no sample is near the moment asked about', () => {
    expect(
      riseBetween(
        samples,
        'session',
        Date.parse('2026-01-01T00:00:00Z'),
        Date.parse('2026-01-01T01:00:00Z'),
      ),
    ).toBeNull();
  });
});

describe('attribute', () => {
  const samples = [sample('2026-09-12T10:00:00Z', 10, 4), sample('2026-09-12T11:00:00Z', 34, 9)];

  it('leaves sessions that ended before polling started blank', () => {
    const [s] = attribute(
      [session('old', '2026-09-01T10:00:00Z', '2026-09-01T11:00:00Z')],
      samples,
    );
    // Never reconstructed.
    expect(s?.allowance).toBeNull();
  });

  it('measures a session that ran while polling', () => {
    const [s] = attribute([session('a', '2026-09-12T10:00:00Z', '2026-09-12T11:00:00Z')], samples);
    expect(s?.allowance).toBe(24);
    expect(s?.weekly).toBe(5);
    expect(s?.allowanceShared).toBeUndefined();
  });

  it('flags overlapping sessions as shared rather than splitting the rise', () => {
    // Polling runs every 60s, so a real series has a sample near every moment.
    const dense = [...samples, sample('2026-09-12T10:30:00Z', 20, 6)];
    const both = attribute(
      [
        session('a', '2026-09-12T10:00:00Z', '2026-09-12T11:00:00Z'),
        session('b', '2026-09-12T10:30:00Z', '2026-09-12T11:00:00Z'),
      ],
      dense,
    );

    expect(both.every((s) => s.allowanceShared === true)).toBe(true);
    // 24 and 14 overlap on the same underlying rise; adding them double-counts
    // the 10:30-11:00 window, which is why they are marked Shared.
    expect(both[0]?.allowance).toBe(24);
    expect(both[1]?.allowance).toBe(14);
  });

  it('reports nothing for a moment no sample is near', () => {
    // Polling was down, so the span cannot be measured. Blank, not interpolated.
    const [s] = attribute([session('a', '2026-09-12T10:20:00Z', '2026-09-12T10:40:00Z')], samples);
    expect(s?.allowance).toBeNull();
  });

  it('does nothing at all when there are no samples yet', () => {
    const [s] = attribute([session('a', '2026-09-12T10:00:00Z', '2026-09-12T11:00:00Z')], []);
    expect(s?.allowance).toBeNull();
  });
});

describe('readToken', () => {
  it('pulls the token out of the stored blob', async () => {
    const { readToken } = await import('../src/main/usage.js');
    // Same shape in the macOS Keychain and in ~/.claude/.credentials.json.
    expect(readToken('{"claudeAiOauth":{"accessToken":"sk-abc","expiresAt":1}}')).toBe('sk-abc');
  });

  it('returns null rather than an empty token', async () => {
    const { readToken } = await import('../src/main/usage.js');
    expect(readToken('{"claudeAiOauth":{"accessToken":""}}')).toBeNull();
    expect(readToken('{"claudeAiOauth":{}}')).toBeNull();
    expect(readToken('{}')).toBeNull();
  });

  it('survives a blob that is not JSON at all', async () => {
    const { readToken } = await import('../src/main/usage.js');
    expect(readToken('not json')).toBeNull();
    expect(readToken('')).toBeNull();
  });
});
