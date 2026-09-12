import { byFile, byTool, type Rollup } from './aggregate.js';
import {
  cacheHitRate,
  newTokens,
  type SessionDetail,
  type SessionSummary,
  type Usage,
} from './model.js';

const add = (a: Usage, b: Usage): Usage => ({
  input: a.input + b.input,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheWrite: a.cacheWrite + b.cacheWrite,
  output: a.output + b.output,
  thinking: a.thinking + b.thinking,
});

const EMPTY: Usage = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, thinking: 0 };

/** One project's work, across every Session in it. */
export interface ProjectRollup {
  name: string;
  cwd: string;
  sessions: number;
  usage: Usage;
  activeMs: number;
  prompts: number;
  toolCalls: number;
  subagents: number;
  invalidations: number;
  lastAt: string;
  /** Most expensive files and tools in this project. */
  files: Rollup[];
  tools: Rollup[];
}

export function byProject(details: SessionDetail[]): ProjectRollup[] {
  const groups = new Map<string, SessionDetail[]>();
  for (const d of details) {
    const g = groups.get(d.project);
    if (g) g.push(d);
    else groups.set(d.project, [d]);
  }

  return [...groups.entries()]
    .map(([name, group]) => {
      const events = group.flatMap((d) => d.events);
      return {
        name,
        cwd: group[0]?.cwd ?? '',
        sessions: group.length,
        usage: group.reduce((u, d) => add(u, d.usage), EMPTY),
        activeMs: group.reduce((n, d) => n + d.activeMs, 0),
        prompts: group.reduce((n, d) => n + d.prompts, 0),
        toolCalls: group.reduce((n, d) => n + d.toolCalls, 0),
        subagents: group.reduce((n, d) => n + d.subagentDetail.length, 0),
        invalidations: group.reduce((n, d) => n + d.invalidations.length, 0),
        lastAt: group.reduce((t, d) => (d.endedAt > t ? d.endedAt : t), ''),
        files: byFile(events).slice(0, 5),
        tools: byTool(events).slice(0, 5),
      };
    })
    .sort((a, b) => newTokens(b.usage) - newTokens(a.usage));
}

/** A day's work, for the trend charts. */
export interface DayRollup {
  /** ISO date, `YYYY-MM-DD`. */
  day: string;
  newTokens: number;
  /** Null when nothing was sent that day, so the chart shows a gap not a zero. */
  cacheHit: number | null;
  sessions: number;
}

/**
 * The last `days` days, including days with no work.
 *
 * Empty days are present so the axis is continuous — a gap in the data has to
 * read as a gap, not as the days either side being adjacent.
 */
export function byDay(sessions: SessionSummary[], days = 14, today = new Date()): DayRollup[] {
  const buckets = new Map<string, SessionSummary[]>();
  for (const s of sessions) {
    const day = s.startedAt.slice(0, 10);
    const b = buckets.get(day);
    if (b) b.push(s);
    else buckets.set(day, [s]);
  }

  const out: DayRollup[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const day = d.toISOString().slice(0, 10);
    const group = buckets.get(day) ?? [];
    const usage = group.reduce((u, s) => add(u, s.usage), EMPTY);
    out.push({
      day,
      newTokens: newTokens(usage),
      cacheHit: group.length === 0 ? null : cacheHitRate(usage),
      sessions: group.length,
    });
  }
  return out;
}

/** Share of work per model, ranked. */
export interface ModelRollup {
  model: string;
  sessions: number;
  newTokens: number;
  share: number;
}

export function byModel(sessions: SessionSummary[]): ModelRollup[] {
  const counts = new Map<string, { sessions: number; tokens: number }>();
  for (const s of sessions) {
    // A Session is attributed to the model it used most.
    const model = s.models[0];
    if (!model) continue;
    const c = counts.get(model) ?? { sessions: 0, tokens: 0 };
    counts.set(model, { sessions: c.sessions + 1, tokens: c.tokens + newTokens(s.usage) });
  }

  const total = [...counts.values()].reduce((n, c) => n + c.tokens, 0);
  return [...counts.entries()]
    .map(([model, c]) => ({
      model,
      sessions: c.sessions,
      newTokens: c.tokens,
      share: total === 0 ? 0 : c.tokens / total,
    }))
    .sort((a, b) => b.newTokens - a.newTokens);
}
