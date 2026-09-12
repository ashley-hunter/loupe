import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import type { Recommendation, SessionDetail } from '../shared/model.js';

/**
 * Recommendations: things worth telling you that carry no measurable saving.
 *
 * A Finding always states tokens it would give back. These cannot — an MCP
 * server's tool schema never appears in a Transcript, and choosing a cheaper
 * model changes what a session costs in money, not in tokens. Rather than
 * invent a number to make them rank alongside Findings, they are kept apart and
 * state no figure at all (ADR-0001).
 */

/** Claude Code keeps per-project MCP configuration here. */
const CONFIG_PATH = join(homedir(), '.claude.json');

interface ClaudeConfig {
  mcpServers?: Record<string, unknown>;
  projects?: Record<string, { mcpServers?: Record<string, unknown> }>;
}

/** Every MCP server configured, global or per project, with where it came from. */
async function configuredServers(): Promise<Map<string, string>> {
  const raw = await readFile(CONFIG_PATH, 'utf8').catch(() => null);
  if (raw === null) return new Map();

  let config: ClaudeConfig;
  try {
    config = JSON.parse(raw) as ClaudeConfig;
  } catch {
    return new Map();
  }

  const found = new Map<string, string>();
  for (const name of Object.keys(config.mcpServers ?? {})) found.set(name, 'globally');
  for (const [path, project] of Object.entries(config.projects ?? {})) {
    for (const name of Object.keys(project.mcpServers ?? {})) {
      found.set(name, `in ${basename(path) || path}`);
    }
  }
  return found;
}

/** Server names that were actually invoked, from `mcp__<server>__<tool>` calls. */
function invokedServers(sessions: SessionDetail[]): Set<string> {
  const used = new Set<string>();
  for (const s of sessions) {
    for (const e of s.events) {
      if (e.tool?.startsWith('mcp__') !== true) continue;
      const name = e.tool.split('__')[1];
      if (name) used.add(name);
    }
  }
  return used;
}

/**
 * Servers configured but never called.
 *
 * Each one adds its tool schema to every context in its project. How much is
 * unknowable from Transcripts, so no figure is given — only the fact.
 */
async function unusedMcpServers(sessions: SessionDetail[]): Promise<Recommendation[]> {
  const configured = await configuredServers();
  if (configured.size === 0) return [];

  const used = invokedServers(sessions);
  // Tool names normalise differently from config keys, so compare loosely.
  const isUsed = (name: string): boolean =>
    [...used].some((u) => u === name || u.includes(name) || name.includes(u));

  const unused = [...configured.entries()].filter(([name]) => !isUsed(name));
  if (unused.length === 0) return [];

  return [
    {
      id: 'mcp:unused',
      kind: 'unused-mcp',
      title: `${unused.length} MCP ${unused.length === 1 ? 'server is' : 'servers are'} configured but never used`,
      text:
        'Each configured server adds its tool definitions to every context in its project, ' +
        'whether or not the tools get called. These have not been invoked in any transcript.',
      detail: unused.map(([name, where]) => `${name} (${where})`).join(', '),
      // The schema never appears in a Transcript, so its cost cannot be Measured.
      costable: false,
    },
  ];
}

/** Subagents running on a heavier model than their work appears to need. */
function subagentRouting(sessions: SessionDetail[]): Recommendation[] {
  const heavy = sessions.flatMap((s) =>
    s.subagentDetail
      .filter((a) => /opus/i.test(a.model) && a.toolCalls <= 10)
      .map((a) => ({ session: s.name, agent: a.type, calls: a.toolCalls })),
  );

  if (heavy.length < 2) return [];

  return [
    {
      id: 'model:subagents',
      kind: 'model-routing',
      title: `${heavy.length} subagents ran on Opus for short tasks`,
      text:
        'A subagent that makes only a handful of tool calls is usually doing lookup rather ' +
        'than reasoning, which a lighter model handles at a fraction of the price. This changes ' +
        'what a session costs in money, not in tokens, so no token figure is given.',
      detail: heavy
        .slice(0, 4)
        .map((h) => `${h.agent} · ${h.calls} tool calls`)
        .join(', '),
      costable: false,
    },
  ];
}

export const buildRecommendations = async (
  sessions: SessionDetail[],
): Promise<Recommendation[]> => [
  ...(await unusedMcpServers(sessions)),
  ...subagentRouting(sessions),
];
