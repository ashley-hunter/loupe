import { newTokens, type SessionDetail } from '../shared/model.js';
import type { StartupCost } from '../shared/tools.js';

/**
 * What it costs to start a Session, per project.
 *
 * Before you type anything, the first Request already carries the system
 * prompt, every tool definition, every configured MCP server's schema, the
 * skill listing and CLAUDE.md. A Transcript never itemises any of that, so
 * nothing here is attributed to a particular server - that split would be
 * invented. The total is not: it is the context the first Request ran with.
 *
 * This is the one cost in the app that is fixed per Session rather than earned
 * during one, which makes it the only one a configuration change fixes
 * permanently rather than a habit change fixing occasionally.
 */

/** Sessions below this are noise: a Transcript with no Request says nothing. */
const MIN_SESSIONS = 2;

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

/**
 * The context the first Request ran with, however it was billed.
 *
 * Reads are included deliberately. When two Sessions start close together the
 * second one's preamble is served from cache and costs a tenth, but it is the
 * same tokens occupying the same window - and the window, not the bill, is what
 * this figure is about.
 */
const preamble = (s: SessionDetail): number | null => {
  const first = s.requests[0];
  return first ? first.usage.cacheRead + first.usage.cacheWrite + first.usage.input : null;
};

export function startupCosts(sessions: SessionDetail[]): StartupCost[] {
  const byProject = new Map<string, { repo: string; sizes: number[]; written: number }>();

  for (const s of sessions) {
    const size = preamble(s);
    const first = s.requests[0];
    if (size === null || !first) continue;

    const entry = byProject.get(s.project) ?? { repo: s.repo, sizes: [], written: 0 };
    entry.sizes.push(size);
    // What starting this Session actually added to the bill, as opposed to what
    // it occupied: a cached start writes nothing and is counted as nothing.
    entry.written += newTokens({ ...first.usage, cacheRead: 0, output: 0, thinking: 0 });
    byProject.set(s.project, entry);
  }

  return [...byProject.entries()]
    .filter(([, e]) => e.sizes.length >= MIN_SESSIONS)
    .map(([project, e]) => ({
      project,
      repo: e.repo,
      median: median(e.sizes),
      worst: Math.max(...e.sizes),
      sessions: e.sizes.length,
      total: e.written,
    }))
    .sort((a, b) => b.total - a.total);
}
