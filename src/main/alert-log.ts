import { appendFile, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Alert } from '../shared/model.js';

/**
 * Alerts that have been raised, newest last.
 *
 * An Alert is worth keeping because it is the one thing here that arrives while
 * you are looking somewhere else. Without a record it exists for as long as a
 * notification is on screen, which is no use for something you want to go back
 * and diagnose.
 *
 * Moves with `LOUPE_ROOT`, so a demo run neither reads nor appends to the real
 * history.
 */
const LOG_PATH = process.env['LOUPE_ROOT']
  ? join(process.env['LOUPE_ROOT'], '.loupe-alerts.jsonl')
  : join(homedir(), '.claude', '.loupe-alerts.jsonl');

/**
 * How many to hand back. The file is append-only and one line is small, so it
 * is read whole and trimmed here rather than rewritten; a year of alerts is
 * still a smaller read than a single Transcript.
 */
const KEEP = 500;

export const recordAlerts = (alerts: Alert[]): Promise<void> =>
  alerts.length === 0
    ? Promise.resolve()
    : appendFile(LOG_PATH, alerts.map((a) => JSON.stringify(a)).join('\n') + '\n').catch(
        () => undefined,
      );

/** Every Alert still on record, newest first. */
export async function readAlerts(): Promise<Alert[]> {
  const raw = await readFile(LOG_PATH, 'utf8').catch(() => '');
  const out: Alert[] = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    try {
      out.push(JSON.parse(line) as Alert);
    } catch {
      /* skip a torn line */
    }
  }
  // Deduped because a Session re-parsed across two app runs can raise an Alert
  // the previous run already recorded; `seen` only lives as long as the process.
  const byId = new Map(out.map((a) => [a.id, a]));
  return [...byId.values()].reverse().slice(0, KEEP);
}
