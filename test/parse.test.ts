import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { costOfTurn, parseTranscript } from '../src/main/parse.js';
import { cacheHitRate, type Usage } from '../src/shared/model.js';

const u = (p: Partial<Usage> = {}): Usage => ({
  input: 0,
  cacheRead: 0,
  cacheWrite: 0,
  output: 0,
  thinking: 0,
  ...p,
});

function transcript(records: unknown[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-'));
  const path = join(dir, '11111111-2222-3333-4444-555555555555.jsonl');
  writeFileSync(path, records.map((r) => JSON.stringify(r)).join('\n'));
  return path;
}

const usageRecord = (reqId: string, ts: string, usage: object, content: object) => ({
  type: 'assistant',
  requestId: reqId,
  timestamp: ts,
  uuid: `${reqId}-${ts}`,
  cwd: '/Users/x/Projects/demo',
  message: { model: 'claude-opus-5', role: 'assistant', content: [content], usage },
});

const parse = (path: string) => parseTranscript(path, { mtimeMs: 0, withEvents: true });

describe('usage is read once per Request, not once per record', () => {
  // A Request writes one record per content block and repeats its usage on each.
  // Summing per record overcounts by ~1.82x across real transcripts.
  it('does not sum repeated usage within one Request', async () => {
    const usage = {
      input_tokens: 10,
      output_tokens: 100,
      cache_read_input_tokens: 5000,
      cache_creation_input_tokens: 20,
    };
    const path = transcript([
      usageRecord('req_A', '2026-09-01T10:00:00Z', usage, { type: 'thinking', thinking: 'hm' }),
      usageRecord('req_A', '2026-09-01T10:00:01Z', usage, { type: 'text', text: 'Doing it.' }),
      usageRecord('req_A', '2026-09-01T10:00:02Z', usage, {
        type: 'tool_use',
        id: 't1',
        name: 'Read',
        input: { file_path: '/a.ts' },
      }),
    ]);

    const p = await parse(path);
    expect(p?.requests).toHaveLength(1);
    expect(p?.summary.usage.output).toBe(100); // not 300
    expect(p?.summary.usage.cacheRead).toBe(5000); // not 15000
  });

  it('takes the last usage record when they differ', async () => {
    // Verified on disk: every multi-record Request is monotonic and the last is the max.
    const path = transcript([
      usageRecord(
        'req_A',
        '2026-09-01T10:00:00Z',
        { output_tokens: 50 },
        { type: 'thinking', thinking: 'partial' },
      ),
      usageRecord(
        'req_A',
        '2026-09-01T10:00:01Z',
        { output_tokens: 380 },
        { type: 'text', text: 'final' },
      ),
    ]);
    expect((await parse(path))?.summary.usage.output).toBe(380);
  });
});

describe('costOfTurn', () => {
  it('measures what the tool result added to the prefix', () => {
    const prev = u({ cacheRead: 1000, cacheWrite: 0, input: 0, output: 118 });
    const next = u({ cacheRead: 1000, cacheWrite: 271, input: 0 });
    expect(costOfTurn(prev, next)).toBe(153); // 271 - 118
  });

  it('reports blank when the prefix was rebuilt', () => {
    // Cache invalidated: the growth is the whole context, not this turn.
    const prev = u({ cacheRead: 90_000, output: 200 });
    const next = u({ cacheRead: 0, cacheWrite: 95_000 });
    expect(costOfTurn(prev, next)).toBeNull();
  });

  it('reports blank rather than a negative cost', () => {
    const prev = u({ cacheRead: 1000, output: 5000 });
    const next = u({ cacheRead: 1000, cacheWrite: 10 });
    expect(costOfTurn(prev, next)).toBeNull();
  });

  it('reports blank for the final Request, which has nothing after it', () => {
    expect(costOfTurn(u({ cacheRead: 1000 }), null)).toBeNull();
  });
});

describe('Events costed from their Request', () => {
  it('marks cost as shared when one Request made several tool calls', async () => {
    const path = transcript([
      {
        ...usageRecord(
          'req_A',
          '2026-09-01T10:00:00Z',
          { cache_read_input_tokens: 1000, output_tokens: 100 },
          { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/a.ts' } },
        ),
      },
      {
        ...usageRecord(
          'req_A',
          '2026-09-01T10:00:01Z',
          { cache_read_input_tokens: 1000, output_tokens: 100 },
          { type: 'tool_use', id: 't2', name: 'Read', input: { file_path: '/b.ts' } },
        ),
      },
      usageRecord(
        'req_B',
        '2026-09-01T10:00:05Z',
        { cache_read_input_tokens: 1100, cache_creation_input_tokens: 900 },
        { type: 'text', text: 'done' },
      ),
    ]);

    const p = await parse(path);
    const reads = p!.events.filter((e) => e.kind === 'read');
    expect(reads).toHaveLength(2);
    expect(reads.every((e) => e.sharedCost === true)).toBe(true);
    // Both report the same figure; it must not be summed across them.
    expect(new Set(reads.map((e) => e.cost)).size).toBe(1);
  });

  it('does not mark cost as shared for a single tool call', async () => {
    const path = transcript([
      usageRecord(
        'req_A',
        '2026-09-01T10:00:00Z',
        { cache_read_input_tokens: 1000, output_tokens: 100 },
        { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } },
      ),
      usageRecord(
        'req_B',
        '2026-09-01T10:00:05Z',
        { cache_read_input_tokens: 1100, cache_creation_input_tokens: 900 },
        { type: 'text', text: 'done' },
      ),
    ]);
    const p = await parse(path);
    expect(p!.events.find((e) => e.kind === 'bash')?.sharedCost).toBeUndefined();
  });
});

describe('prompt counting', () => {
  it('counts what the person typed, not plumbing', async () => {
    const at = (ts: string, extra: object, content: unknown) => ({
      type: 'user',
      uuid: ts,
      timestamp: ts,
      cwd: '/Users/x/Projects/demo',
      message: { role: 'user', content },
      ...extra,
    });
    const path = transcript([
      at('2026-09-01T10:00:00Z', { isMeta: true }, '<local-command-caveat>Caveat: …'),
      at('2026-09-01T10:00:01Z', {}, '<command-name>/clear</command-name>'),
      at('2026-09-01T10:00:02Z', {}, 'Find out why the specs are flaky.'),
      at('2026-09-01T10:00:03Z', {}, [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }]),
      at('2026-09-01T10:00:04Z', { isSidechain: true }, 'subagent prompt'),
    ]);

    const p = await parse(path);
    expect(p?.summary.prompts).toBe(1);
    expect(p?.summary.name).toBe('Find out why the specs are flaky.');
  });
});

describe('session summary', () => {
  it('derives project from cwd and allowance stays blank', async () => {
    const path = transcript([
      usageRecord(
        'req_A',
        '2026-09-01T10:00:00Z',
        { output_tokens: 10 },
        { type: 'text', text: 'hi' },
      ),
    ]);
    const p = await parse(path);
    expect(p?.summary.project).toBe('demo');
    // Never reconstructed for historical Sessions.
    expect(p?.summary.allowance).toBeNull();
  });
});

describe('active time', () => {
  it('excludes gaps longer than the idle threshold', async () => {
    const path = transcript([
      usageRecord(
        'req_A',
        '2026-09-01T10:00:00Z',
        { output_tokens: 1 },
        { type: 'text', text: 'a' },
      ),
      usageRecord(
        'req_B',
        '2026-09-01T10:02:00Z',
        { output_tokens: 1 },
        { type: 'text', text: 'b' },
      ),
      // Two hours away from the keyboard, then one more minute of work.
      usageRecord(
        'req_C',
        '2026-09-01T12:02:00Z',
        { output_tokens: 1 },
        { type: 'text', text: 'c' },
      ),
      usageRecord(
        'req_D',
        '2026-09-01T12:03:00Z',
        { output_tokens: 1 },
        { type: 'text', text: 'd' },
      ),
    ]);
    const p = await parse(path);
    expect(p?.summary.activeMs).toBe(3 * 60_000); // 2m + 1m, not 2h 3m
    expect(p?.summary.spanMs).toBe(123 * 60_000);
  });
});

describe('cacheHitRate', () => {
  it('is the share of input served from cache', () => {
    expect(cacheHitRate(u({ cacheRead: 900, cacheWrite: 100 }))).toBeCloseTo(0.9);
  });
  it('is null when nothing was sent', () => {
    expect(cacheHitRate(u())).toBeNull();
  });
});
