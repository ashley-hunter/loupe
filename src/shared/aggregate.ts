import type { Event } from './model.js';

/**
 * Roll Events up for the Files and Tools tabs.
 *
 * Costs marked `sharedCost` cover every tool call in their Request and cannot be
 * split between them, so they are counted once per Request rather than once per
 * Event, and never simply added up. Each total reports how many of its Events
 * had no measurable cost, so a small number is visibly a small number rather
 * than a missing one.
 */
export interface Rollup {
  key: string;
  events: number;
  /** Summed cost of the Events that had one, with shared Requests counted once. */
  cost: number;
  /** Events whose cost could not be Measured, and so are absent from `cost`. */
  unmeasured: number;
}

/**
 * What a set of Events cost, counting a shared Request once.
 *
 * Exported because summing `e.cost` by hand is wrong in a way that looks
 * right: several tool calls in one Request each carry that Request's whole
 * cost, so a plain reduce multiplies it by however many ran in parallel.
 */
export const sumCost = (events: Event[]): number => total(events).cost;

function total(events: Event[]): { cost: number; unmeasured: number } {
  let cost = 0;
  let unmeasured = 0;
  const countedRequests = new Set<string>();

  for (const e of events) {
    if (e.cost === null) {
      unmeasured++;
      continue;
    }
    if (e.sharedCost) {
      // One figure for the whole Request; adding it per Event would multiply it.
      const request = e.request ?? e.id;
      if (countedRequests.has(request)) continue;
      countedRequests.add(request);
    }
    cost += e.cost;
  }
  return { cost, unmeasured };
}

function group(events: Event[], keyOf: (e: Event) => string | undefined): Rollup[] {
  const buckets = new Map<string, Event[]>();
  for (const e of events) {
    const key = keyOf(e);
    if (!key) continue;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(e);
    else buckets.set(key, [e]);
  }

  return [...buckets.entries()]
    .map(([key, es]) => ({ key, events: es.length, ...total(es) }))
    .sort((a, b) => b.cost - a.cost || b.events - a.events);
}

/** Files the Session read or wrote, most expensive first. */
export interface FileRollup extends Rollup {
  reads: number;
  edits: number;
}

export function byFile(events: Event[]): FileRollup[] {
  return group(events, (e) => e.path).map((r) => {
    const forFile = events.filter((e) => e.path === r.key);
    return {
      ...r,
      reads: forFile.filter((e) => e.kind === 'read').length,
      edits: forFile.filter((e) => e.kind === 'edit').length,
    };
  });
}

/** Tools the Session called, most expensive first. */
export const byTool = (events: Event[]): Rollup[] => group(events, (e) => e.tool);
