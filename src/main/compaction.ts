import type { Request, SessionDetail } from '../shared/model.js';
import type { Threshold } from '../shared/tools.js';

/**
 * Where compaction actually happens, measured rather than assumed.
 *
 * Claude Code compacts at a threshold that depends on the model, the context
 * window and whatever `--autocompact` was set to, and none of that is written
 * into a Transcript. But the *event* is: `invalidations.ts` already identifies
 * the Requests where the context shrank, and the Request before one of those
 * was, by definition, as large as this machine ever let a context get.
 *
 * So the figure comes from your own history. Without a compaction on record
 * there is no threshold to report and none is invented - the same rule
 * Allowance follows for Sessions that predate the poller.
 */

/** Fewer compactions than this and the median is an anecdote, not a threshold. */
const MIN_SAMPLES = 3;

const prefixOf = (r: Request): number => r.usage.cacheRead + r.usage.cacheWrite + r.usage.input;

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

/**
 * The context sizes immediately before a compaction, across every Session.
 *
 * Read from the Request *before* the one that shrank: the shrinking Request
 * already carries the compacted context, so it reports the outcome rather than
 * the limit that triggered it.
 */
export function measureThreshold(sessions: SessionDetail[]): Threshold {
  const sizes: number[] = [];

  for (const session of sessions) {
    const compactions = new Set(
      session.invalidations.filter((i) => i.cause === 'compaction').map((i) => i.at),
    );
    if (compactions.size === 0) continue;

    for (let i = 1; i < session.requests.length; i++) {
      if (!compactions.has(session.requests[i]!.at)) continue;
      const before = prefixOf(session.requests[i - 1]!);
      if (before > 0) sizes.push(before);
    }
  }

  return sizes.length < MIN_SAMPLES
    ? { tokens: null, samples: sizes.length }
    : { tokens: median(sizes), samples: sizes.length };
}
