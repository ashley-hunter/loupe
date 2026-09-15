import type { Event, EventKind, SessionDetail } from '../shared/model.js';

/**
 * Search across every Session's Events.
 *
 * A plain case-insensitive substring scan over the in-memory index. The whole
 * corpus is a few hundred thousand Events, which a single pass handles in
 * milliseconds once the parse is memoised — there is nothing here an index
 * would make meaningfully faster, and an index would be one more thing to keep
 * in step with the Transcripts.
 */

export interface SearchHit {
  id: string;
  /** The Event kind, or `session` when the Session's own name matched. */
  kind: EventKind | 'session';
  /** The Event this hit is, so opening it can land on that moment. */
  eventId?: string;
  /** The file, when the hit is one. */
  path?: string;
  title: string;
  /** What the Event added to the context. Null when it could not be Measured. */
  cost: number | null;
  at: string;
  sessionId: string;
  sessionPath: string;
  sessionName: string;
  project: string;
}

export interface SearchResult {
  hits: SearchHit[];
  /** How many matched in total, which may exceed what was returned. */
  total: number;
  /** Match count per kind, for the filter row — always over the unfiltered set. */
  counts: Record<string, number>;
}

/** Returned per query; more than this and the list stops being readable anyway. */
const LIMIT = 300;

const matches = (haystack: string | undefined, needle: string): boolean =>
  haystack?.toLowerCase().includes(needle) === true;

export function search(
  sessions: SessionDetail[],
  query: string,
  kind: EventKind | 'session' | 'all' = 'all',
): SearchResult {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return { hits: [], total: 0, counts: {} };

  const all: SearchHit[] = [];

  for (const s of sessions) {
    // The Session itself, when its name or project matches.
    if (matches(s.name, needle) || matches(s.project, needle)) {
      all.push({
        id: `${s.id}:session`,
        kind: 'session',
        title: s.name,
        cost: null,
        at: s.startedAt,
        sessionId: s.id,
        sessionPath: s.path,
        sessionName: s.name,
        project: s.project,
      });
    }

    for (const e of s.events) {
      // Titles and paths only: the shared index drops bodies, because holding
      // every Session's tool output at once costs over a gigabyte.
      if (!matches(e.title, needle) && !matches(e.path, needle)) continue;
      all.push({
        id: `${s.id}:${e.id}`,
        kind: e.kind,
        eventId: e.id,
        ...(e.path === undefined ? {} : { path: e.path }),
        title: e.title,
        cost: e.cost,
        at: e.at,
        sessionId: s.id,
        sessionPath: s.path,
        sessionName: s.name,
        project: s.project,
      });
    }
  }

  const counts: Record<string, number> = { all: all.length };
  for (const hit of all) counts[hit.kind] = (counts[hit.kind] ?? 0) + 1;

  const filtered = kind === 'all' ? all : all.filter((h) => h.kind === kind);

  // Most recent first: when the same file turns up across months of Sessions,
  // what you did with it lately is nearly always what you are looking for.
  filtered.sort((a, b) => (a.at < b.at ? 1 : -1));

  return { hits: filtered.slice(0, LIMIT), total: filtered.length, counts };
}

/** Events whose title is worth showing at all — tool calls and prose, not empty thinking. */
export const isSearchable = (e: Event): boolean => e.title.trim().length > 0;
