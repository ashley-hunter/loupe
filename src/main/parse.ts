import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { basename } from 'node:path';
import {
  EMPTY_USAGE,
  IDLE_GAP_MS,
  type Event,
  type EventKind,
  type Request,
  type RequestId,
  type SessionDetail,
  type SessionId,
  type SessionStatus,
  type SessionSummary,
  type Usage,
} from '../shared/model.js';
import { loadSubagents } from './subagents.js';

/** A raw Transcript record. Only the fields we actually read are named. */
interface Record_ {
  type?: string;
  uuid?: string;
  timestamp?: string;
  cwd?: string;
  isMeta?: boolean | null;
  isSidechain?: boolean;
  requestId?: string;
  toolUseResult?: unknown;
  message?: {
    id?: string;
    model?: string;
    role?: string;
    content?: unknown;
    usage?: RawUsage;
  };
}

interface RawUsage {
  cache_creation?: { ephemeral_1h_input_tokens?: number };
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  output_tokens_details?: { thinking_tokens?: number };
}

const toUsage = (u: RawUsage): Usage => ({
  input: u.input_tokens ?? 0,
  cacheRead: u.cache_read_input_tokens ?? 0,
  cacheWrite: u.cache_creation_input_tokens ?? 0,
  output: u.output_tokens ?? 0,
  thinking: u.output_tokens_details?.thinking_tokens ?? 0,
});

const addUsage = (a: Usage, b: Usage): Usage => ({
  input: a.input + b.input,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheWrite: a.cacheWrite + b.cacheWrite,
  output: a.output + b.output,
  thinking: a.thinking + b.thinking,
});

/** Tool name -> the Event kind the Timeline colours it as. */
const TOOL_KIND: Record<string, EventKind> = {
  Read: 'read',
  NotebookRead: 'read',
  Edit: 'edit',
  Write: 'edit',
  NotebookEdit: 'edit',
  Bash: 'bash',
  BashOutput: 'bash',
  Grep: 'grep',
  Glob: 'grep',
  WebFetch: 'web',
  WebSearch: 'web',
  Task: 'agent',
  Agent: 'agent',
};

function toolKind(name: string): EventKind {
  if (name.startsWith('mcp__')) return 'mcp';
  return TOOL_KIND[name] ?? 'tool';
}

const text = (v: unknown): string => (typeof v === 'string' ? v : '');

const NON_TOOL: ReadonlySet<string> = new Set(['user', 'asst', 'think']);
const isToolEvent = (e: Event): boolean => !NON_TOOL.has(e.kind);

function firstLine(s: string, max = 140): string {
  const line = s.replace(/\s+/g, ' ').trim();
  return line.length > max ? line.slice(0, max - 1) + '…' : line;
}

/**
 * Openings that are machinery rather than a person describing a task, and so
 * make a poor Session name even though they are genuine first prompts.
 */
const NOT_A_TITLE = [/^<[a-z-]+>/i, /^@"/, /^\/[a-z-]+/i, /^https?:\/\//i, /^[/~][\w./-]+$/];

const readsLikeATitle = (s: string): boolean =>
  s.length > 12 && !NOT_A_TITLE.some((re) => re.test(s));

/**
 * True for records that are Claude Code plumbing rather than something the
 * person typed — slash-command expansions, caveats, and tool results.
 */
function isRealPrompt(r: Record_): boolean {
  if (r.type !== 'user' || r.isMeta || r.isSidechain) return false;
  const c = r.message?.content;
  if (Array.isArray(c)) return false; // tool_result blocks
  const s = text(c);
  return s.length > 0 && !s.startsWith('<command-') && !s.startsWith('<local-command');
}

/**
 * Group a Request's records into one Request.
 *
 * A Request writes one record per content block and repeats its usage on each.
 * Usage is taken from the last record that carries it, which is always the
 * complete one — verified monotonic across every multi-record Request on disk.
 */
interface Grouped {
  id: RequestId;
  at: string;
  model: string;
  usage: Usage | null;
  oneHourWrite: number;
  toolCalls: number;
  events: Event[];
}

export interface ParsedTranscript {
  summary: SessionSummary;
  events: Event[];
  requests: Request[];
}

interface ResultBlock {
  type?: string;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

/** Record which calls failed, and stash their output when bodies are wanted. */
function readToolResults(
  r: Record_,
  into: { failed: Set<string>; bodies: Map<string, string>; keepBodies: boolean },
): void {
  const content = r.message?.content;
  if (!Array.isArray(content)) return;

  for (const block of content as ResultBlock[]) {
    if (block.type !== 'tool_result' || !block.tool_use_id) continue;
    if (block.is_error === true) into.failed.add(block.tool_use_id);
    if (!into.keepBodies) continue;
    const raw = typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
    into.bodies.set(block.tool_use_id, raw.slice(0, 4000));
  }
}

const contentBlocks = (r: Record_): Array<Record<string, unknown>> =>
  Array.isArray(r.message?.content) ? (r.message.content as Array<Record<string, unknown>>) : [];

const countToolCalls = (r: Record_): number =>
  contentBlocks(r).filter((b) => b['type'] === 'tool_use').length;

/**
 * Turn one assistant record's content blocks into Events.
 *
 * Costs are left null here — what an Event added to the context is only
 * knowable from the Request that follows it, which the caller resolves.
 */
/**
 * A thinking or text block as an Event.
 *
 * Both keep their full text when bodies are wanted: a conversation read as a
 * thread needs what was actually said, and 140 characters is a list row. Claude
 * Code strips the prose from all but about 2% of thinking blocks, so for those
 * the token count remains the only real information.
 */
function spokenEvent(
  block: { b: Record<string, unknown>; type: 'thinking' | 'text'; uuid: string },
  base: { at: string; depth: number; request: RequestId; cost: number | null },
  keepBodies: boolean,
): Event | null {
  const { b, type, uuid } = block;
  const thinking = type === 'thinking';
  const body = text(b[thinking ? 'thinking' : 'text']);
  if (!thinking && !body.trim()) return null;

  return {
    ...base,
    id: `${uuid}-${thinking ? 't' : 'x'}`,
    kind: thinking ? 'think' : 'asst',
    title: firstLine(body) || 'Thinking',
    ...(keepBodies && body ? { body } : {}),
  };
}

function eventsFromBlocks(r: Record_, request: RequestId, keepBodies: boolean): Event[] {
  const depth = r.isSidechain ? 1 : 0;
  const base = { at: r.timestamp ?? '', depth, request, cost: null as number | null };
  const out: Event[] = [];

  for (const b of contentBlocks(r)) {
    const type = b['type'];

    if (type === 'thinking' || type === 'text') {
      const spoken = spokenEvent({ b, type, uuid: r.uuid ?? '' }, base, keepBodies);
      if (spoken) out.push(spoken);
      continue;
    }

    if (type !== 'tool_use') continue;

    const toolName = text(b['name']);
    const input = (b['input'] ?? {}) as Record<string, unknown>;
    const filePath = text(input['file_path']) || text(input['notebook_path']);
    const useId = text(b['id']);
    out.push({
      ...base,
      id: useId || `${r.uuid}-u`,
      kind: toolKind(toolName),
      title: describeTool(toolName, input),
      subtitle: toolName,
      tool: toolName,
      ...(filePath ? { path: filePath } : {}),
      ...(useId ? { toolUseId: useId } : {}),
    });
  }

  return out;
}

/*
 * A streaming state machine over one Transcript: a dozen accumulators advanced
 * by record type, then a costing pass that needs all of them. The parts that
 * extract cleanly already have (readToolResults, eventsFromBlocks); splitting
 * further would mean threading every accumulator through helper parameters,
 * which reads worse than the loop does.
 */
// eslint-disable-next-line complexity, max-lines-per-function
export async function parseTranscript(
  path: string,
  opts: {
    mtimeMs: number;
    withEvents: boolean;
    subagents?: number;
    /**
     * Keep tool output and message text on each Event. Only the Inspector needs
     * it, and only for one Session at a time — holding it for every Session at
     * once costs well over a gigabyte of resident memory.
     */
    withBodies?: boolean;
  },
): Promise<ParsedTranscript | null> {
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });

  const groups = new Map<string, Grouped>();
  const order: string[] = [];
  const events: Event[] = [];
  const models = new Map<string, number>();
  const resultOf = new Map<string, string>(); // tool_use id -> result preview
  const failedTools = new Set<string>(); // tool_use ids whose result was an error

  let cwd = '';
  let prompts = 0;
  let activeMs = 0;
  let previousAt = 0;
  let firstAt = '';
  let lastAt = '';
  let name = '';

  for await (const line of rl) {
    if (!line) continue;
    let r: Record_;
    try {
      r = JSON.parse(line) as Record_;
    } catch {
      continue;
    }

    if (r.cwd && !cwd) cwd = r.cwd;
    if (r.timestamp) {
      if (!firstAt || r.timestamp < firstAt) firstAt = r.timestamp;
      if (r.timestamp > lastAt) lastAt = r.timestamp;
      const at = Date.parse(r.timestamp);
      if (previousAt > 0) {
        const gap = at - previousAt;
        if (gap > 0 && gap <= IDLE_GAP_MS) activeMs += gap;
      }
      if (at > previousAt) previousAt = at;
    }

    if (isRealPrompt(r)) {
      prompts++;
      const body = text(r.message?.content);
      const candidate = firstLine(body, 90);
      if (!name || (!readsLikeATitle(name) && readsLikeATitle(candidate))) name = candidate;
      if (opts.withEvents) {
        events.push({
          id: r.uuid ?? `u${events.length}`,
          kind: 'user',
          at: r.timestamp ?? '',
          title: firstLine(body),
          ...(opts.withBodies ? { body } : {}),
          depth: r.isSidechain ? 1 : 0,
          cost: null,
        });
      }
      continue;
    }

    // Tool results arrive as user records, carrying the outcome of the call.
    if (r.type === 'user' && r.toolUseResult !== undefined && opts.withEvents) {
      readToolResults(r, {
        failed: failedTools,
        bodies: resultOf,
        keepBodies: opts.withBodies === true,
      });
      continue;
    }

    if (r.type !== 'assistant') continue;

    const id = r.requestId ?? r.message?.id;
    if (!id) continue;
    if (!groups.has(id)) {
      order.push(id);
      groups.set(id, {
        id: id as RequestId,
        at: r.timestamp ?? '',
        model: r.message?.model ?? '',
        usage: null,
        oneHourWrite: 0,
        toolCalls: 0,
        events: [],
      });
    }
    const g = groups.get(id)!;
    if (r.message?.model) models.set(r.message.model, (models.get(r.message.model) ?? 0) + 1);
    // Last usage record wins: a Request repeats its usage on every content block,
    // and only the final record carries the complete figures.
    if (r.message?.usage) {
      g.usage = toUsage(r.message.usage);
      g.oneHourWrite = r.message.usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
    }

    if (opts.withEvents) {
      g.events.push(...eventsFromBlocks(r, id as RequestId, opts.withBodies === true));
    }
    g.toolCalls += countToolCalls(r);
  }

  if (order.length === 0 && prompts === 0) return null;

  // Cost each Event from the growth of the cached prefix into the next Request.
  const requests: Request[] = [];
  for (let i = 0; i < order.length; i++) {
    const g = groups.get(order[i]!)!;
    const usage = g.usage ?? EMPTY_USAGE;
    requests.push({
      id: g.id,
      at: g.at,
      model: g.model,
      usage,
      toolCalls: g.toolCalls,
      oneHourWrite: g.oneHourWrite,
    });

    if (opts.withEvents) {
      const next = i + 1 < order.length ? (groups.get(order[i + 1]!)?.usage ?? null) : null;
      const cost = costOfTurn(usage, next);
      // A Request with several tool calls grew the prefix once; that growth
      // covers all of them and cannot honestly be split.
      const shared = g.toolCalls > 1;
      for (const e of g.events) {
        finishEvent(e, { cost, shared, thinking: usage.thinking, failedTools, resultOf });
      }
      events.push(...g.events);
    }
  }

  if (opts.withEvents) events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

  const usage = requests.reduce((acc, r) => addUsage(acc, r.usage), EMPTY_USAGE);
  const id = basename(path, '.jsonl') as SessionId;
  const startedAt = firstAt || new Date(mtimeFallback(opts.mtimeMs)).toISOString();
  const endedAt = lastAt || startedAt;

  const summary: SessionSummary = {
    id,
    path,
    project: cwd ? basename(cwd) : 'unknown',
    // Overwritten by the index once the disk has been asked whether this cwd is
    // a worktree. Parsing is a pure read of the Transcript and stays that way.
    repo: cwd ? basename(cwd) : 'unknown',
    cwd,
    name: name || 'Untitled session',
    startedAt,
    endedAt,
    spanMs: Math.max(0, Date.parse(endedAt) - Date.parse(startedAt)),
    activeMs,
    models: [...models.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m),
    prompts,
    toolCalls: requests.reduce((n, r) => n + r.toolCalls, 0),
    requestCount: requests.length,
    usage,
    subagents: opts.subagents ?? 0,
    // Filled in by the index, which is where Subagent Transcripts are read.
    subagentUsage: EMPTY_USAGE,
    status: statusOf(opts.mtimeMs),
    // Blank for every Session recorded before the poller existed.
    allowance: null,
  };

  return { summary, events, requests };
}

/**
 * Fill in everything about an Event that is only knowable once its Request and
 * the one after it have both been read.
 */
function finishEvent(
  e: Event,
  from: {
    cost: number | null;
    shared: boolean;
    thinking: number;
    failedTools: ReadonlySet<string>;
    resultOf: ReadonlyMap<string, string>;
  },
): void {
  // The measured growth is what the tool returned. Thinking and prose are
  // already counted as this Request's output, so attributing the same figure to
  // them would show it three times.
  if (isToolEvent(e)) {
    e.cost = from.cost;
    if (from.shared && from.cost !== null) e.sharedCost = true;
  }

  if (e.kind === 'think' && e.title === 'Thinking' && from.thinking > 0) {
    e.subtitle = `${from.thinking} thinking tokens · content not retained`;
  }

  if (from.failedTools.has(e.id)) e.failed = true;

  const body = from.resultOf.get(e.id);
  if (body !== undefined) e.body = body;
}

/**
 * What the turn that followed `usage` added to the context.
 *
 * The next Request's fresh input (cache writes plus uncached input) is the
 * previous turn's assistant output plus whatever its tool returned. Subtracting
 * the output leaves the tool result.
 *
 * Returns null when it cannot be Measured: no next Request, a rebuilt prefix
 * (the growth is then the whole context, not this turn), or a negative result.
 */
export function costOfTurn(usage: Usage, next: Usage | null): number | null {
  if (!next) return null;
  const prevTotal = usage.cacheRead + usage.cacheWrite + usage.input;
  const preserved = next.cacheRead >= prevTotal * 0.9;
  if (!preserved) return null;
  const cost = next.cacheWrite + next.input - usage.output;
  return cost < 0 ? null : cost;
}

/** Which input field best describes a call, per tool. */
const DESCRIBED_BY: Record<string, string[]> = {
  Read: ['file_path'],
  Write: ['file_path'],
  Edit: ['file_path'],
  NotebookRead: ['notebook_path'],
  NotebookEdit: ['notebook_path'],
  Bash: ['command'],
  Grep: ['pattern'],
  Glob: ['pattern'],
  WebFetch: ['url'],
  WebSearch: ['query'],
  Task: ['description'],
};

/** Fields to fall back on for tools with no entry above, including MCP ones. */
const DESCRIBED_BY_DEFAULT = ['description', 'command', 'query', 'url', 'file_path'];

function describeTool(name: string, input: Record<string, unknown>): string {
  const fields = DESCRIBED_BY[name] ?? DESCRIBED_BY_DEFAULT;
  for (const field of fields) {
    const value = text(input[field]);
    if (value) {
      // Grep is the one case where a second field genuinely adds meaning.
      const where = name === 'Grep' && input['path'] ? ` in ${text(input['path'])}` : '';
      return firstLine(value + where, 100);
    }
  }
  return name;
}

const ACTIVE_WINDOW_MS = 5 * 60 * 1000;
const statusOf = (mtimeMs: number): SessionStatus =>
  Date.now() - mtimeMs < ACTIVE_WINDOW_MS ? 'active' : 'completed';

const mtimeFallback = (mtimeMs: number): number => mtimeMs;

export async function parseDetail(
  path: string,
  opts: { mtimeMs: number; subagents?: number; withBodies?: boolean },
): Promise<SessionDetail | null> {
  const p = await parseTranscript(path, { ...opts, withEvents: true });
  if (!p) return null;
  const subagentDetail = await loadSubagents(path);
  // Invalidations are filled in by loadSession, which owns the detector.
  return {
    ...p.summary,
    events: p.events,
    requests: p.requests,
    subagentDetail,
    invalidations: [],
  };
}
