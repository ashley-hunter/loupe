import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import type {
  Finding,
  Invalidation,
  Recommendation,
  SessionDetail,
  SessionSummary,
} from '../shared/model.js';
import { buildRecommendations } from './recommendations.js';
import { byProject, type ProjectRollup } from '../shared/rollup.js';
import { findAll } from './detectors.js';
import { search, type SearchResult } from './search.js';
import { attribute } from './allowance.js';
import { findInvalidations, summarise, type CacheSummary } from './invalidations.js';
import { parseDetail, parseTranscript } from './parse.js';
import { readSamples } from './usage.js';

/**
 * Read Transcripts from somewhere other than `~/.claude/projects`.
 *
 * Set by `scripts/demo-data.mjs` so screenshots can be taken against fabricated
 * Sessions rather than real ones. The index cache moves with it, so a demo run
 * never evicts the real cache and a real run never sees the fake Sessions.
 */
const ROOT_OVERRIDE = process.env['LOUPE_ROOT'];

export const TRANSCRIPT_ROOT = ROOT_OVERRIDE ?? join(homedir(), '.claude', 'projects');
const CACHE_PATH = ROOT_OVERRIDE
  ? join(ROOT_OVERRIDE, '.loupe-index.json')
  : join(homedir(), '.claude', '.loupe-index.json');

/**
 * A Transcript on disk. `subagentPaths` are the Subagent Transcripts written
 * alongside it under `<sessionId>/subagents/`.
 */
interface Found {
  path: string;
  mtimeMs: number;
  size: number;
  subagentPaths: string[];
}

/** Locate every Session Transcript, and the Subagent Transcripts belonging to each. */
export async function findTranscripts(root = TRANSCRIPT_ROOT): Promise<Found[]> {
  const found: Found[] = [];

  const projects = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const project of projects) {
    if (!project.isDirectory()) continue;
    const dir = join(root, project.name);
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
      const path = join(dir, entry.name);
      const info = await stat(path).catch(() => null);
      if (!info) continue;

      const sessionId = basename(entry.name, '.jsonl');
      const subagentDir = join(dir, sessionId, 'subagents');
      const subagents = await readdir(subagentDir).catch(() => []);

      found.push({
        path,
        mtimeMs: info.mtimeMs,
        size: info.size,
        subagentPaths: subagents
          .filter((f) => f.endsWith('.jsonl'))
          .map((f) => join(subagentDir, f)),
      });
    }
  }
  return found;
}

/**
 * Cached SessionSummaries, keyed by Transcript path.
 *
 * A full cold parse of every Transcript takes seconds, not minutes,
 * so the cache exists to make relaunches instant rather than to make the parse
 * possible. An entry is reused only when its Transcript's mtime and size both
 * match, which is enough because Transcripts are append-only.
 */
interface CacheEntry {
  mtimeMs: number;
  size: number;
  summary: SessionSummary;
}
type Cache = Record<string, CacheEntry>;

const readCache = async (): Promise<Cache> =>
  readFile(CACHE_PATH, 'utf8')
    .then((s) => JSON.parse(s) as Cache)
    .catch(() => ({}));

const writeCache = (c: Cache): Promise<void> =>
  writeFile(CACHE_PATH, JSON.stringify(c)).catch(() => undefined);

export interface IndexResult {
  sessions: SessionSummary[];
  parsed: number;
  reused: number;
  ms: number;
}

/** Build the Sessions list, reusing cached summaries for Transcripts that have not changed. */
export async function buildIndex(root = TRANSCRIPT_ROOT): Promise<IndexResult> {
  const started = Date.now();
  const cache = await readCache();
  const next: Cache = {};
  const sessions: SessionSummary[] = [];
  let parsed = 0;
  let reused = 0;

  const found = await findTranscripts(root);

  await Promise.all(
    found.map(async (f) => {
      const hit = cache[f.path];
      if (hit?.mtimeMs === f.mtimeMs && hit.size === f.size) {
        next[f.path] = hit;
        sessions.push(hit.summary);
        reused++;
        return;
      }
      const result = await parseTranscript(f.path, {
        mtimeMs: f.mtimeMs,
        withEvents: false,
        subagents: f.subagentPaths.length,
      }).catch(() => null);
      if (!result) return;
      parsed++;
      next[f.path] = { mtimeMs: f.mtimeMs, size: f.size, summary: result.summary };
      sessions.push(result.summary);
    }),
  );

  sessions.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  await writeCache(next);

  // Allowance is applied after caching, never inside it: the summary cache is
  // keyed on the Transcript, but Allowance comes from the sample series, which
  // keeps growing after a Transcript stops changing.
  const samples = await readSamples();
  return { sessions: attribute(sessions, samples), parsed, reused, ms: Date.now() - started };
}

/**
 * Every Session with its Events, memoised by mtime.
 *
 * The Cache report, the Findings, the Projects rollup and Search all need the
 * same full parse. Doing it once and reusing it turns four passes over the
 * corpus into one; an entry is dropped as soon as its Transcript changes.
 *
 * Measured on this machine's 1.6 GB of Transcripts: 63 MB actually retained
 * (49 MB of it Events, 7 MB Requests), cold 3.7s, warm 30ms.
 *
 * ponytail: resident size reads far higher — around 500 MB — but that is heap
 * V8 has freed and not returned to the OS after a peak of ~305 MB during
 * parsing, not data this holds. Bounding parse concurrency was tried and made
 * it slightly worse, so it was reverted. Shrinking the retained 63 MB would not
 * touch the number you see in Activity Monitor; only reducing parse-time
 * garbage would.
 */
const detailCache = new Map<string, { mtimeMs: number; detail: SessionDetail }>();

export async function loadAllDetails(root = TRANSCRIPT_ROOT): Promise<SessionDetail[]> {
  const found = await findTranscripts(root);

  const details = await Promise.all(
    found.map(async (f) => {
      const hit = detailCache.get(f.path);
      if (hit?.mtimeMs === f.mtimeMs) return hit.detail;

      // Bodies are deliberately dropped here: this cache holds every Session at
      // once, and the Inspector reads them per-Session through loadSession.
      const detail = await loadSession(f.path, {}).catch(() => null);
      if (detail) detailCache.set(f.path, { mtimeMs: f.mtimeMs, detail });
      return detail;
    }),
  );

  // Forget Transcripts that have gone away, so the map cannot grow unbounded.
  const live = new Set(found.map((f) => f.path));
  for (const path of detailCache.keys()) if (!live.has(path)) detailCache.delete(path);

  return details.filter((d): d is SessionDetail => d !== null);
}

/**
 * Every Invalidation across every Session, split into what is worth acting on,
 * idle Expiry, re-anchoring and Compaction.
 */
export async function buildCacheReport(
  root = TRANSCRIPT_ROOT,
): Promise<CacheSummary & { all: Invalidation[] }> {
  const all = (await loadAllDetails(root)).flatMap((d) => d.invalidations);
  all.sort((a, b) => (a.at < b.at ? 1 : -1));
  return { ...summarise(all), all };
}

/**
 * Every Finding across every Session.
 *
 * Parses each Transcript in full, so it is slower than the index — but the whole
 * corpus is a few seconds, and Findings have to see Events, not just
 * summaries.
 */
export const buildFindings = async (root = TRANSCRIPT_ROOT): Promise<Finding[]> =>
  findAll(await loadAllDetails(root));

/** Advice that carries no measurable token saving. */
export const buildAdvice = async (root = TRANSCRIPT_ROOT): Promise<Recommendation[]> =>
  buildRecommendations(await loadAllDetails(root));

/** Search every Session's Events. Uses the memoised parse, so repeats are instant. */
export const runSearch = async (
  query: string,
  kind: Parameters<typeof search>[2],
  root = TRANSCRIPT_ROOT,
): Promise<SearchResult> => search(await loadAllDetails(root), query, kind);

/** Per-project rollups, including each project's costliest files and tools. */
export const buildProjects = async (root = TRANSCRIPT_ROOT): Promise<ProjectRollup[]> =>
  byProject(await loadAllDetails(root));

/** Load one Session with its Events. Never cached — Events are large and cheap to rebuild. */
export async function loadSession(
  path: string,
  opts: { withBodies?: boolean } = { withBodies: true },
): Promise<SessionDetail | null> {
  const info = await stat(path).catch(() => null);
  if (!info) return null;

  const sessionId = basename(path, '.jsonl');
  const subagentDir = join(path, '..', sessionId, 'subagents');
  const subagents = await readdir(subagentDir).catch(() => []);

  const detail = await parseDetail(path, {
    mtimeMs: info.mtimeMs,
    subagents: subagents.filter((f) => f.endsWith('.jsonl')).length,
    ...(opts.withBodies === true ? { withBodies: true } : {}),
  });
  if (!detail) return null;

  return { ...detail, invalidations: findInvalidations(detail, detail.requests) };
}
