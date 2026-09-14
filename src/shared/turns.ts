import { cacheHitRate, newTokens, type Event, type Invalidation, type Request } from './model.js';
import type { SessionDetail } from './model.js';

/**
 * One exchange: what was asked, what came back, and what it cost.
 *
 * The Timeline is a log — every Event, one row each, in order. That is the
 * right shape for finding a single event among thousands and the wrong shape
 * for reading. A Turn is the unit a person actually thinks in, and it is where
 * a cost belongs: "this question cost 180k" is answerable, where "this tool
 * result cost 6k" mostly is not.
 */
export interface Turn {
  id: string;
  at: string;
  /** What the person typed. Null for work that continued without a new prompt. */
  prompt: Event | null;
  /**
   * Everything after the prompt, in the order it happened: replies, thinking
   * and tool calls interleaved. Read as a thread, the order is the meaning —
   * splitting prose from work would put the answer before the work that
   * produced it.
   */
  items: Event[];
  /** New tokens across this Turn's Requests: what it added to the context. */
  cost: number;
  cacheHit: number | null;
  models: string[];
  /** Rebuilds that happened at the start of this Turn, with their cause. */
  rebuilds: Invalidation[];
}

const isPrompt = (e: Event): boolean => e.kind === 'user' && e.depth === 0;

/**
 * Split a Session into Turns.
 *
 * A Turn opens at a prompt and runs until the next one. Work before the first
 * prompt — a resumed Session picking up mid-task — goes into a leading Turn
 * with no prompt rather than being dropped or attached to the wrong question.
 */
export function toTurns(session: SessionDetail): Turn[] {
  const byId = new Map<string, Request>(session.requests.map((r) => [r.id, r]));
  const turns: Turn[] = [];
  let current: Turn | null = null;

  const open = (at: string, prompt: Event | null, id: string): Turn => {
    const turn: Turn = {
      id,
      at,
      prompt,
      items: [],
      cost: 0,
      cacheHit: null,
      models: [],
      rebuilds: [],
    };
    turns.push(turn);
    return turn;
  };

  const requestsOf = new Map<Turn, Set<string>>();

  for (const e of session.events) {
    if (isPrompt(e) || current === null) {
      current = open(e.at, isPrompt(e) ? e : null, `turn-${String(turns.length)}`);
      requestsOf.set(current, new Set());
      if (isPrompt(e)) continue;
    }
    if (e.request) requestsOf.get(current)?.add(e.request);
    current.items.push(e);
  }

  for (const turn of turns) {
    const ids = requestsOf.get(turn) ?? new Set<string>();
    const requests = [...ids]
      .map((id) => byId.get(id))
      .filter((r): r is Request => r !== undefined);

    turn.cost = requests.reduce((n, r) => n + newTokens(r.usage), 0);
    turn.models = [...new Set(requests.map((r) => r.model))];
    turn.cacheHit = averageHit(requests);
    turn.rebuilds = rebuildsAt(session.invalidations, turn, turns);
  }

  return turns;
}

/** The Turn's cache hit rate, over its Requests taken together. */
function averageHit(requests: Request[]): number | null {
  if (requests.length === 0) return null;
  const total = requests.reduce(
    (acc, r) => ({
      input: acc.input + r.usage.input,
      cacheRead: acc.cacheRead + r.usage.cacheRead,
      cacheWrite: acc.cacheWrite + r.usage.cacheWrite,
      output: 0,
      thinking: 0,
    }),
    { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, thinking: 0 },
  );
  return cacheHitRate(total);
}

/**
 * Rebuilds belonging to a Turn: those between the previous Turn's start and
 * this one's. Attached to the Turn they precede, because that is the Turn that
 * paid for them.
 */
function rebuildsAt(all: Invalidation[], turn: Turn, turns: Turn[]): Invalidation[] {
  const index = turns.indexOf(turn);
  const from = index === 0 ? -Infinity : Date.parse(turns[index - 1]!.at);
  const to = Date.parse(turn.at);
  return all.filter((i) => {
    const at = Date.parse(i.at);
    return at > from && at <= to;
  });
}
