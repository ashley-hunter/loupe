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
  repo: 'demo',
  at: '2026-09-12T10:00:00Z',
  cause: 'reanchor',
  rewritten: 400_000,
  idleMs: 20_000,
  ...p,
});

/** A bare Event for the command tests, where only kind, title and cost matter. */
const ev = (p: Pick<Event, 'id' | 'kind' | 'title' | 'cost'>): Event => ({
  at: '2026-09-12T10:00:00Z',
  depth: 0,
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
  repo: 'demo',
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
  subagentUsage: EMPTY_USAGE,
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

describe('noisy commands', () => {
  it('reports a command whose output filled the context', () => {
    const found = findAll([
      session({
        events: [
          ev({ id: 'b1', kind: 'bash', title: 'npm test', cost: 90_000 }),
          ev({ id: 'r1', kind: 'read', title: '/a.ts', cost: 400 }),
        ],
      }),
    ]).filter((f) => f.kind === 'noisy-command');

    expect(found).toHaveLength(1);
    expect(found[0]?.text).toContain('npm');
    expect(found[0]?.recoverable).toBe(90_000);
  });

  it('counts only the repeats when the same command ran more than once', () => {
    const found = findAll([
      session({
        events: [
          // A leading `cd` must not become the program's name.
          ev({ id: 'b1', kind: 'bash', title: 'cd /app && npm run build', cost: 40_000 }),
          ev({ id: 'b2', kind: 'bash', title: 'npm run build', cost: 40_000 }),
        ],
      }),
    ]).filter((f) => f.kind === 'noisy-command');

    expect(found[0]?.recoverable).toBe(80_000);
    expect(found[0]?.text).toContain('npm produced');
    expect(found[0]?.text).toContain('2 runs');
  });

  it('ignores quiet commands, however many times they run', () => {
    const found = findAll([
      session({
        events: [1, 2, 3, 4].map((n) =>
          ev({ id: `b${String(n)}`, kind: 'bash', title: 'git status', cost: 300 }),
        ),
      }),
    ]).filter((f) => f.kind === 'noisy-command');
    expect(found).toEqual([]);
  });
});

/** A file Claude Code put back into the context after an edit to it. */
const reinjected = (id: string, path: string, chars: number): Event => ({
  id,
  kind: 'inject',
  at: '2026-09-12T10:00:00Z',
  title: `File re-sent after an edit: ${path}`,
  subtitle: 'edited_text_file',
  body: 'x'.repeat(chars),
  depth: 0,
  cost: null,
  path,
});

describe('edited files put back into the context', () => {
  it('counts the repeats, not the first copy', () => {
    const found = findAll([
      session({
        events: [
          reinjected('a', '/demo/big.ts', 40_000),
          reinjected('b', '/demo/big.ts', 40_000),
          reinjected('c', '/demo/big.ts', 40_000),
        ],
      }),
    ]).filter((f) => f.kind === 'edit-reinjected');

    expect(found).toHaveLength(1);
    // 120k chars is about 30k tokens; two copies of the three are the waste.
    expect(found[0]?.recoverable).toBe(20_000);
    expect(found[0]?.text).toContain('re-sent 3 times');
  });

  it('says nothing about a file re-sent once', () => {
    const found = findAll([session({ events: [reinjected('a', '/demo/big.ts', 200_000)] })]).filter(
      (f) => f.kind === 'edit-reinjected',
    );
    expect(found).toEqual([]);
  });

  // The whole point: this arrives as an injection, so the read-based detector
  // must not also claim it.
  it('is not confused with a duplicate read', () => {
    const found = findAll([
      session({
        events: [
          reinjected('a', '/demo/big.ts', 200_000),
          reinjected('b', '/demo/big.ts', 200_000),
        ],
      }),
    ]);
    expect(found.some((f) => f.kind === 'duplicate-read')).toBe(false);
    expect(found.some((f) => f.kind === 'edit-reinjected')).toBe(true);
  });
});

describe('screenshots returned by a tool', () => {
  const shot = (id: string, cost: number): Event => ({
    id,
    kind: 'mcp',
    at: '2026-09-12T10:00:00Z',
    title: 'take_screenshot',
    depth: 0,
    cost,
    images: 1,
    tool: 'mcp__chrome__take_screenshot',
  });

  // These have no path, so the extension test never saw them.
  it('counts a screenshot even though it has no filename', () => {
    const found = findAll([session({ events: [shot('a', 12_000), shot('b', 12_000)] })]).filter(
      (f) => f.kind === 'binary-read',
    );

    expect(found).toHaveLength(1);
    expect(found[0]?.recoverable).toBe(24_000);
    expect(found[0]?.text).toContain('2 screenshots');
  });

  it('counts images read from disk and screenshots together', () => {
    const [found] = findAll([
      session({ events: [read('r', '/demo/shot.png', 15_000), shot('a', 15_000)] }),
    ]).filter((f) => f.kind === 'binary-read');

    expect(found?.recoverable).toBe(30_000);
    expect(found?.text).toContain('1 image or PDF read and 1 screenshot');
  });

  it('ignores a tool call that returned no image', () => {
    const found = findAll([session({ events: [{ ...shot('a', 90_000), images: 0 }] })]).filter(
      (f) => f.kind === 'binary-read',
    );
    expect(found).toEqual([]);
  });
});

/**
 * Tool calls that shared one Request.
 *
 * A Request issuing several calls repeats its whole cost on each of them and
 * flags them shared, so adding them up multiplies the figure by however many
 * ran together. This is the shape that made screenshots read double.
 */
describe('pictures that shared a request', () => {
  const shared = (id: string, request: string, cost: number, path?: string): Event => ({
    id,
    kind: path === undefined ? 'mcp' : 'read',
    at: '2026-09-12T10:00:00Z',
    title: path ?? 'take_screenshot',
    depth: 0,
    cost,
    sharedCost: true,
    request: request as NonNullable<Event['request']>,
    ...(path === undefined ? { images: 1 } : { path, tool: 'Read' }),
  });

  it('counts one request once, however many screenshots it took', () => {
    const [found] = findAll([
      session({ events: [shared('a', 'r1', 30_000), shared('b', 'r1', 30_000)] }),
    ]).filter((f) => f.kind === 'binary-read');

    // Both carry the Request's full cost; the Request cost 30k, not 60k.
    expect(found?.recoverable).toBe(30_000);
    expect(found?.text).toContain('2 screenshots');
  });

  it('does not count a request twice for holding both a read and a screenshot', () => {
    const [found] = findAll([
      session({
        events: [shared('a', 'r1', 40_000, '/demo/shot.png'), shared('b', 'r1', 40_000)],
      }),
    ]).filter((f) => f.kind === 'binary-read');

    expect(found?.recoverable).toBe(40_000);
    expect(found?.text).toContain('1 image or PDF read and 1 screenshot');
  });

  it('still adds separate requests together', () => {
    const [found] = findAll([
      session({ events: [shared('a', 'r1', 30_000), shared('b', 'r2', 30_000)] }),
    ]).filter((f) => f.kind === 'binary-read');

    expect(found?.recoverable).toBe(60_000);
  });
});
