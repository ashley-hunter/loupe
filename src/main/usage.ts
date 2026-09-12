import { execFile } from 'node:child_process';
import { appendFile, readFile, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { LimitKind, UsageSample } from '../shared/model.js';

const run = promisify(execFile);

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';

/**
 * The Allowance series moves with `LOUPE_ROOT` (see catalogue.ts), so a demo run
 * reads fabricated readings and, more importantly, never appends a real one to
 * the file it is pretending with.
 */
const SAMPLES_PATH = process.env['LOUPE_ROOT']
  ? join(process.env['LOUPE_ROOT'], '.loupe-usage.jsonl')
  : join(homedir(), '.claude', '.loupe-usage.jsonl');

/**
 * Where the samples lived when the app was called Ledger.
 *
 * Allowance history cannot be reconstructed — it only exists because the poller
 * was running at the time — so a rename must carry it across rather
 * than orphan it. The index cache next door is not migrated, because that
 * rebuilds itself in a few seconds.
 */
const FORMER_SAMPLES_PATH = join(homedir(), '.claude', '.ledger-usage.jsonl');

/**
 * Where Claude Code keeps its own OAuth token.
 *
 * Two places, depending on the platform: a file under `~/.claude` on Linux and
 * Windows, the login Keychain on macOS. The file is tried first because it is
 * simply absent on macOS, so the order needs no platform check of its own.
 *
 * It is re-read on every poll rather than cached, so when Claude Code refreshes
 * the token we pick the new one up for free and never have to hold a refresh
 * token or implement the refresh flow ourselves.
 */
const KEYCHAIN_SERVICE = 'Claude Code-credentials';
const CREDENTIALS_PATH = join(homedir(), '.claude', '.credentials.json');

/** Pull the token out of the stored blob, whichever source it came from. */
export function readToken(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as { claudeAiOauth?: { accessToken?: string } };
    const token = parsed.claudeAiOauth?.accessToken;
    return token !== undefined && token !== '' ? token : null;
  } catch {
    return null;
  }
}

async function accessToken(): Promise<string | null> {
  const fromFile = await readFile(CREDENTIALS_PATH, 'utf8')
    .then(readToken)
    .catch(() => null);
  if (fromFile !== null) return fromFile;

  if (process.platform !== 'darwin') return null;
  try {
    const { stdout } = await run('security', [
      'find-generic-password',
      '-s',
      KEYCHAIN_SERVICE,
      '-w',
    ]);
    return readToken(stdout.trim());
  } catch {
    return null;
  }
}

/** One entry of the endpoint's `limits` array. */
interface RawLimit {
  kind?: string;
  group?: string;
  percent?: number;
  severity?: string;
  resets_at?: string | null;
  is_active?: boolean;
  scope?: { model?: { display_name?: string | null } | null } | null;
}

const KNOWN: ReadonlySet<string> = new Set<LimitKind>(['session', 'weekly_all', 'weekly_scoped']);

/**
 * The outcome of one poll. `rate-limited` is kept distinct from `failed` because
 * it is the one failure the caller must slow down for rather than simply retry.
 */
export type UsageResult =
  | { status: 'ok'; sample: UsageSample }
  | { status: 'rate-limited'; retryAfterMs: number | null }
  | { status: 'failed' };

/**
 * Read the current Allowance.
 *
 * This is a metadata read: it reports consumption without running inference, so
 * it costs no tokens and no Allowance of its own. Any failure yields
 * no sample at all — an expired token, a changed response, no network — because
 * a blank Allowance is correct and a guessed one is not.
 */
export async function readUsage(now = new Date()): Promise<UsageResult> {
  // A demo run must not reach the real endpoint: the reading it came back with
  // would be the real account's, shown against fabricated Sessions.
  if (process.env['LOUPE_ROOT']) return { status: 'failed' };

  const token = await accessToken();
  if (!token) return { status: 'failed' };

  let body: { limits?: RawLimit[] };
  try {
    const response = await fetch(USAGE_URL, {
      headers: {
        authorization: `Bearer ${token}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'user-agent': 'loupe',
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (response.status === 429) {
      const header = Number(response.headers.get('retry-after'));
      return {
        status: 'rate-limited',
        retryAfterMs: Number.isFinite(header) && header > 0 ? header * 1000 : null,
      };
    }
    if (!response.ok) return { status: 'failed' };
    body = (await response.json()) as { limits?: RawLimit[] };
  } catch {
    return { status: 'failed' };
  }

  const sample = parseUsage(body, now);
  return sample ? { status: 'ok', sample } : { status: 'failed' };
}

/** Convenience wrapper for callers that only want the reading. */
export const fetchUsage = async (now = new Date()): Promise<UsageSample | null> => {
  const result = await readUsage(now);
  return result.status === 'ok' ? result.sample : null;
};

/** Split out from the fetch so it can be tested against a recorded response. */
export function parseUsage(body: { limits?: RawLimit[] }, now: Date): UsageSample | null {
  if (!Array.isArray(body.limits)) return null;

  const limits = body.limits
    .filter(
      (l): l is RawLimit & { kind: string; percent: number } =>
        typeof l.kind === 'string' && KNOWN.has(l.kind) && typeof l.percent === 'number',
    )
    .map((l) => ({
      kind: l.kind as LimitKind,
      percent: l.percent,
      resetsAt: l.resets_at ?? null,
      severity: l.severity ?? 'normal',
      // Only weekly_scoped carries a model; the others are account-wide.
      model: l.scope?.model?.display_name ?? null,
    }));

  return limits.length > 0 ? { at: now.toISOString(), limits } : null;
}

/** Move the old series into place, once, if this is the first run after the rename. */
async function carryOverFormerSamples(): Promise<void> {
  if (process.env['LOUPE_ROOT']) return;
  const alreadyHere = await readFile(SAMPLES_PATH, 'utf8').then(
    () => true,
    () => false,
  );
  if (alreadyHere) return;
  await rename(FORMER_SAMPLES_PATH, SAMPLES_PATH).catch(() => undefined);
}

/** Append a sample to the on-disk series. The series is the app's only Allowance history. */
export const recordSample = (s: UsageSample): Promise<void> =>
  appendFile(SAMPLES_PATH, JSON.stringify(s) + '\n').catch(() => undefined);

export async function readSamples(): Promise<UsageSample[]> {
  await carryOverFormerSamples();
  const raw = await readFile(SAMPLES_PATH, 'utf8').catch(() => '');
  const out: UsageSample[] = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    try {
      out.push(JSON.parse(line) as UsageSample);
    } catch {
      /* skip a torn line */
    }
  }
  return out;
}

/**
 * How often to ask.
 *
 * The endpoint costs no tokens but it does rate-limit: polling every 60s while
 * relaunching the app repeatedly earned a 429. Five minutes is well inside the
 * ten-minute window `riseBetween` will match a sample to, so the extra spacing
 * costs no resolution.
 */
export const POLL_INTERVAL_MS = 5 * 60_000;
const MAX_BACKOFF_MS = 30 * 60_000;

export interface Poller {
  stop(): void;
  /** Change the gap between polls. Never goes below the rate-limit floor. */
  setInterval(ms: number): void;
}

export function startPolling(onSample: (s: UsageSample) => void): Poller {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  let backoffMs = 0;
  let intervalMs = POLL_INTERVAL_MS;

  const schedule = (delay: number): void => {
    if (stopped) return;
    timer = setTimeout(() => void tick(), delay);
  };

  const tick = async (): Promise<void> => {
    if (stopped) return;
    const result = await readUsage();
    // The control-flow analyser cannot see that `stop()` may run during the
    // await, so it reads this as dead. Removing it would let a stopped poller
    // deliver one last sample.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (stopped) return;

    if (result.status === 'ok') {
      backoffMs = 0;
      await recordSample(result.sample);
      onSample(result.sample);
    } else if (result.status === 'rate-limited') {
      // Back off rather than keep asking; the window moves slowly enough that
      // missing a few readings costs very little.
      backoffMs = Math.min(
        MAX_BACKOFF_MS,
        result.retryAfterMs ?? Math.max(POLL_INTERVAL_MS, backoffMs * 2),
      );
    }
    schedule(backoffMs || intervalMs);
  };

  void (async () => {
    // A fresh launch should not re-poll if a recent reading is already on disk;
    // otherwise restarting the app a few times in a row trips the rate limit.
    const samples = await readSamples();
    const newest = samples.at(-1);
    const age = newest ? Date.now() - Date.parse(newest.at) : Infinity;
    if (newest && age < intervalMs) {
      onSample(newest);
      schedule(intervalMs - age);
      return;
    }
    void tick();
  })();

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
    setInterval(ms) {
      // Five minutes is the floor: below it the endpoint returns 429.
      intervalMs = Math.max(POLL_INTERVAL_MS, ms);
    },
  };
}
