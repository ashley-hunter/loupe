import { readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { Subagent } from '../shared/model.js';
import { parseTranscript } from './parse.js';

/**
 * Subagent Transcripts live beside their parent as
 * `<session>/subagents/agent-<id>.jsonl`, each with an `agent-<id>.meta.json`
 * naming the agent and carrying the `toolUseId` of the Task call that spawned
 * it. The meta is the only place the agent's type and description are recorded,
 * so a Subagent without one is reported with what the Transcript alone gives.
 */
interface Meta {
  agentType?: string;
  description?: string;
  toolUseId?: string;
  spawnDepth?: number;
  model?: string;
}

export async function loadSubagents(sessionPath: string): Promise<Subagent[]> {
  const sessionId = basename(sessionPath, '.jsonl');
  const dir = join(sessionPath, '..', sessionId, 'subagents');

  const entries = await readdir(dir).catch(() => []);
  const transcripts = entries.filter((f) => f.endsWith('.jsonl'));

  const loaded = await Promise.all(
    transcripts.map(async (file): Promise<Subagent | null> => {
      const id = basename(file, '.jsonl');

      // A Subagent without a meta file still reports what the Transcript gives.
      const meta: Meta = await readFile(join(dir, `${id}.meta.json`), 'utf8')
        .then((raw) => JSON.parse(raw) as Meta)
        .catch(() => ({}));

      const parsed = await parseTranscript(join(dir, file), {
        mtimeMs: 0,
        withEvents: false,
      }).catch(() => null);
      if (!parsed) return null;

      const { summary } = parsed;
      return {
        id,
        type: meta.agentType ?? 'unknown',
        description: meta.description ?? summary.name,
        toolUseId: meta.toolUseId ?? null,
        spawnDepth: meta.spawnDepth ?? 1,
        model: meta.model ?? summary.models[0] ?? '',
        usage: summary.usage,
        requestCount: summary.requestCount,
        toolCalls: summary.toolCalls,
        durationMs: summary.activeMs,
      };
    }),
  );

  return loaded
    .filter((s): s is Subagent => s !== null)
    .sort((a, b) => b.usage.output - a.usage.output);
}
