import { cacheHitRate, newTokens, type Event, type Invalidation, type Request } from './model.js';
import type { SessionDetail, Subagent } from './model.js';

/**
 * Where a Turn's cost went. Sums to `cost`, so the parts can be drawn as one
 * bar without the total drifting from the figure beside it.
 *
 * The split that matters is `rewritten` against `added`, because both are cache
 * writes and they mean opposite things: one is the context growing because work
 * was done, the other is paying a second time for context already held. A
 * single "new tokens" figure hides that completely, which is why one existed
 * and the app could not answer its own question.
 */
export interface Ledger {
  /** Cache writes that re-paid for a prefix already held: a rebuild. */
  rewritten: number;
  /** Cache writes that were the context genuinely growing. */
  added: number;
  /** What came back, thinking included. */
  produced: number;
  /** Fresh input, neither read from cache nor written to it. Rarely more than a rounding error. */
  input: number;
}

/**
 * The one thing that best explains a Turn's cost.
 *
 * Four, because these are the only four the Transcripts can support. Null for a
 * Turn with nothing worth explaining.
 */
export type TurnCause = 'rewritten' | 'added' | 'produced' | 'delegated' | null;

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
  /** How `cost` divides. */
  ledger: Ledger;
  /**
   * What Subagents spawned in this Turn spent in their own context windows.
   *
   * Deliberately outside `cost` and outside the Ledger: a Subagent has its own
   * window, so its spend is real, separate, and must never be added into a
   * Session's own total. It is shown beside the Turn, never inside it.
   */
  delegated: number;
  /** Subagents this Turn spawned, for naming them where they happened. */
  agents: Subagent[];
  /** The largest part, and so the honest one-word answer to "why was this expensive". */
  why: TurnCause;
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
      ledger: { rewritten: 0, added: 0, produced: 0, input: 0 },
      delegated: 0,
      agents: [],
      why: null,
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
    turn.agents = agentsOf(turn, session.subagentDetail);
    turn.delegated = turn.agents.reduce((n, a) => n + newTokens(a.usage), 0);
    turn.ledger = split(requests, turn.rebuilds);
    turn.why = dominant(turn);
  }

  return turns;
}

/**
 * Divide a Turn's cost into the four things it can be.
 *
 * The rebuild figures come from the Invalidation detector rather than being
 * inferred again here, and are capped at the writes actually made: a rebuild is
 * recorded against one Request, and a Turn holding several must not report more
 * re-payment than it wrote.
 */
function split(requests: Request[], rebuilds: Invalidation[]): Ledger {
  const wrote = requests.reduce((n, r) => n + r.usage.cacheWrite, 0);
  const rewritten = Math.min(
    wrote,
    rebuilds.reduce((n, i) => n + i.rewritten, 0),
  );

  return {
    rewritten,
    added: wrote - rewritten,
    produced: requests.reduce((n, r) => n + r.usage.output, 0),
    input: requests.reduce((n, r) => n + r.usage.input, 0),
  };
}

/**
 * Subagents this Turn spawned.
 *
 * Tied through the `toolUseId` of the call that started them, which Claude Code
 * records in each Subagent's meta file. A Subagent whose spawning call has
 * scrolled out of the Transcript has none, and belongs to no Turn rather than
 * to a guessed one.
 */
function agentsOf(turn: Turn, agents: Subagent[]): Subagent[] {
  const calls = new Set(
    turn.items.map((e) => e.toolUseId).filter((id): id is string => id !== undefined),
  );
  return calls.size === 0
    ? []
    : agents.filter((a) => a.toolUseId !== null && calls.has(a.toolUseId));
}

/**
 * The largest part of what a Turn spent.
 *
 * Delegated work competes with the rest even though it sits outside `cost`:
 * when a Turn's agents outspent the Turn itself, "you delegated" is the honest
 * answer to what happened, whatever the Session's own figures say.
 */
function dominant(turn: Turn): TurnCause {
  const parts: Array<[TurnCause, number]> = [
    ['rewritten', turn.ledger.rewritten],
    ['added', turn.ledger.added],
    ['produced', turn.ledger.produced],
    ['delegated', turn.delegated],
  ];
  const [cause, size] = parts.reduce((best, p) => (p[1] > best[1] ? p : best));
  return size === 0 ? null : cause;
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
