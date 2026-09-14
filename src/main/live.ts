import { watch, type FSWatcher } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
import type { SessionDetail } from '../shared/model.js';
import { TRANSCRIPT_ROOT, findTranscripts, loadSession } from './catalogue.js';

/** A Session counts as running while its Transcript is still being written to. */
export const LIVE_WINDOW_MS = 5 * 60 * 1000;

/**
 * Wait this long after a write before re-reading. Claude Code appends several
 * records in quick succession, so reacting to each one would re-parse the same
 * Transcript a dozen times for one turn.
 */
const SETTLE_MS = 600;

/** The Transcript written to most recently, if anything has been recently. */
export async function findLiveTranscript(root = TRANSCRIPT_ROOT): Promise<string | null> {
  const found = await findTranscripts(root);
  const newest = found.reduce<{ path: string; mtimeMs: number } | null>(
    (best, f) => (best === null || f.mtimeMs > best.mtimeMs ? f : best),
    null,
  );
  if (!newest) return null;
  return Date.now() - newest.mtimeMs < LIVE_WINDOW_MS ? newest.path : null;
}

/**
 * Follow whichever Session is currently running.
 *
 * On every settled write the whole Transcript is re-parsed rather than the new
 * bytes being decoded in isolation. Costing an Event needs the Request *after*
 * it, so incremental parsing would have to carry partial state across reads for
 * a number that is only knowable once more has arrived.
 *
 * ponytail: full re-parse per turn, O(session length). A 200-Request Session
 * costs ~300ms. If a live Session ever grows big enough for that to stutter,
 * switch to reading from the last byte offset and keep the trailing Request in
 * memory to close out the previous Event's cost.
 */
export function watchLive(
  onUpdate: (detail: SessionDetail | null) => void,
  root = TRANSCRIPT_ROOT,
): () => void {
  let watcher: FSWatcher | null = null;
  let settle: NodeJS.Timeout | null = null;
  let current: string | null = null;
  let stopped = false;
  let reading = false;

  const refresh = async (): Promise<void> => {
    if (stopped || reading) return;
    reading = true;
    try {
      const path = await findLiveTranscript(root);
      current = path;
      if (!path) {
        onUpdate(null);
        return;
      }
      const detail = await loadSession(path).catch(() => null);
      // Same as in the poller: `stopped` can flip while the parse is in flight,
      // which the analyser does not model.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!stopped) onUpdate(detail);
    } finally {
      reading = false;
    }
  };

  const schedule = (): void => {
    if (settle) clearTimeout(settle);
    settle = setTimeout(() => void refresh(), SETTLE_MS);
  };

  try {
    watcher = watch(root, { recursive: true }, (_event, filename) => {
      // Only Transcripts matter; Claude Code writes plenty of other files.
      // Dotfiles are excluded too: this app's own caches sit next to the
      // Transcripts under LOUPE_ROOT, and the alert log is itself a .jsonl, so
      // without this, recording an Alert would trigger the re-parse that
      // records the next one.
      if (filename && (!filename.endsWith('.jsonl') || basename(filename).startsWith('.'))) return;
      schedule();
    });
  } catch {
    // Without a watcher the screen still works, it just will not update itself.
  }

  void refresh();

  // A Session can stop being live without anything being written, so the
  // "nothing is running" state needs a nudge of its own.
  const idleCheck = setInterval(() => {
    if (current !== null) void refresh();
  }, LIVE_WINDOW_MS / 2);

  return () => {
    stopped = true;
    watcher?.close();
    if (settle) clearTimeout(settle);
    clearInterval(idleCheck);
  };
}

/** True when this Transcript has been written to within the live window. */
export const isLive = async (path: string): Promise<boolean> => {
  const info = await stat(path).catch(() => null);
  return info !== null && Date.now() - info.mtimeMs < LIVE_WINDOW_MS;
};
