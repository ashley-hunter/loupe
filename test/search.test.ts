import { describe, expect, it } from 'vitest';
import { search } from '../src/main/search.js';
import { EMPTY_USAGE, type Event, type SessionDetail } from '../src/shared/model.js';

const ev = (p: Partial<Event> & Pick<Event, 'id' | 'kind' | 'title'>): Event => ({
  at: '2026-09-12T10:00:00Z',
  depth: 0,
  cost: null,
  ...p,
});

const session = (p: Partial<SessionDetail> = {}): SessionDetail => ({
  id: 's1' as SessionDetail['id'],
  path: '/s1.jsonl',
  project: 'demo',
  cwd: '/demo',
  name: 'Refactor auth middleware',
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
  status: 'completed',
  allowance: null,
  events: [],
  requests: [],
  subagentDetail: [],
  invalidations: [],
  ...p,
});

describe('search', () => {
  const s = session({
    events: [
      ev({
        id: 'a',
        kind: 'read',
        title: '/demo/src/auth.ts',
        path: '/demo/src/auth.ts',
        cost: 6200,
      }),
      ev({ id: 'b', kind: 'bash', title: 'pnpm test auth', cost: 900, at: '2026-09-12T10:05:00Z' }),
      ev({
        id: 'c',
        kind: 'read',
        title: '/demo/src/cart.ts',
        path: '/demo/src/cart.ts',
        cost: 100,
      }),
    ],
  });

  it('finds events and the session itself', () => {
    const { hits } = search([s], 'auth');
    // The session name matches too, so all three auth things are here.
    expect(hits.map((h) => h.kind).sort()).toEqual(['bash', 'read', 'session']);
  });

  it('ignores case', () => {
    expect(search([s], 'AUTH').total).toBe(search([s], 'auth').total);
  });

  it('needs at least two characters', () => {
    expect(search([s], 'a')).toEqual({ hits: [], total: 0, counts: {} });
    expect(search([s], '  ')).toEqual({ hits: [], total: 0, counts: {} });
  });

  it('filters by kind but counts across all of them', () => {
    const r = search([s], 'auth', 'bash');
    expect(r.hits).toHaveLength(1);
    expect(r.hits[0]?.title).toBe('pnpm test auth');
    // Counts describe the whole match set, so the filter row stays stable.
    expect(r.counts['all']).toBe(3);
    expect(r.counts['read']).toBe(1);
  });

  it('returns the most recent first', () => {
    const { hits } = search([s], 'auth');
    expect(hits[0]?.at).toBe('2026-09-12T10:05:00Z');
  });

  it('matches a path even when the title does not show it', () => {
    const hidden = session({
      name: 'Unrelated',
      events: [ev({ id: 'x', kind: 'read', title: 'cart.ts', path: '/demo/deep/cart.ts' })],
    });
    expect(search([hidden], 'deep').total).toBe(1);
  });

  it('sends file hits to the Files tab and everything else to the Timeline', () => {
    expect(search([s], 'auth', 'read').hits[0]?.tab).toBe('files');
    expect(search([s], 'auth', 'bash').hits[0]?.tab).toBe('timeline');
  });
});

describe('command display', () => {
  it('drops a leading directory change, which is noise when scanning', async () => {
    const { command } = await import('../src/renderer/format.js');
    expect(command('cd /Users/x/project npm test')).toBe('npm test');
    expect(command('cd /Users/x/project && npm test')).toBe('npm test');
    expect(command("cd '/Users/x/my project' && ls")).toBe('ls');
  });

  it('leaves a command that is only a cd alone', () => {
    // Stripping it would leave nothing, which tells the reader less, not more.
    return import('../src/renderer/format.js').then(({ command }) => {
      expect(command('cd /Users/x/project')).toBe('cd /Users/x/project');
      expect(command('npm run build')).toBe('npm run build');
    });
  });
});

describe('paths from any platform', () => {
  it('shortens a Windows path as readily as a POSIX one', async () => {
    const { shortPath } = await import('../src/renderer/format.js');
    // A transcript records whatever separator the machine used, and the app may
    // be reading it on a different one.
    expect(shortPath('C:\\Users\\a\\proj\\src\\deep\\file.ts', '', 2)).toBe('…/deep/file.ts');
    expect(shortPath('/Users/a/proj/src/deep/file.ts', '', 2)).toBe('…/deep/file.ts');
  });

  it('strips the project prefix with either separator', async () => {
    const { shortPath } = await import('../src/renderer/format.js');
    expect(shortPath('C:\\Users\\a\\proj\\src\\file.ts', 'C:\\Users\\a\\proj')).toBe(
      'src\\file.ts',
    );
    expect(shortPath('/Users/a/proj/src/file.ts', '/Users/a/proj')).toBe('src/file.ts');
  });

  it('does not mistake a sibling directory for the project', async () => {
    const { shortPath } = await import('../src/renderer/format.js');
    // `/a/project-two` starts with `/a/project` but is not inside it, so the
    // prefix must survive rather than being sliced off mid-name.
    expect(shortPath('/a/project-two/file.ts', '/a/project')).toBe('/a/project-two/file.ts');
    expect(shortPath('/a/project/file.ts', '/a/project')).toBe('file.ts');
  });
});
