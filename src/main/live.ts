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

/**
 * Every Transcript written to recently, most recent first.
 *
 * Plural because several Sessions genuinely do run at once - a long build in
 * one terminal, a question in another - and each has a cached prefix with its
 * own deadline. Following only the newest meant the other ones expired
 * unwatched, and an action could only ever be aimed at whichever happened to
 * have been typed in last.
 */
export async function findLiveTranscripts(root = TRANSCRIPT_ROOT): Promise<string[]> {
  const found = await findTranscripts(root);
  const now = Date.now();
  return found
    .filter((f) => now - f.mtimeMs < LIVE_WINDOW_MS)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .map((f) => f.path);
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
  onUpdate: (details: SessionDetail[]) => void,
  root = TRANSCRIPT_ROOT,
): () => void {
  let watcher: FSWatcher | null = null;
  let settle: NodeJS.Timeout | null = null;
  let running = 0;
  let stopped = false;
  let reading = false;

  const refresh = async (): Promise<void> => {
    if (stopped || reading) return;
    reading = true;
    try {
      const paths = await findLiveTranscripts(root);
      running = paths.length;
      const details = await Promise.all(paths.map((p) => loadSession(p).catch(() => null)));
      // Same as in the poller: `stopped` can flip while the parse is in flight,
      // which the analyser does not model.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!stopped) onUpdate(details.filter((d): d is SessionDetail => d !== null));
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
    if (running > 0) void refresh();
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
