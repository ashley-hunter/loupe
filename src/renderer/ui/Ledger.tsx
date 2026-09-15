import type { Turn, TurnCause } from '../../shared/turns.js';
import { tokens } from '../format.js';

/**
 * The four things a turn's cost can be, and what each one means.
 *
 * The set is closed on purpose. These are the only four answers a Transcript
 * can support, so an expensive turn always has exactly one of them as its
 * largest part and there is never a fifth explanation to invent.
 */
export const WHY: Record<
  Exclude<TurnCause, null>,
  { label: string; hue: string; short: string; advice: string }
> = {
  rewritten: {
    label: 'Re-paid',
    hue: 'var(--err)',
    short: 'paid again for context it already had',
    advice:
      'The prefix was rebuilt, so everything already in the context was written out a second ' +
      'time. Shorter sessions, fewer model switches part-way through, and coming back inside ' +
      'the cache lifetime are what avoid it.',
  },
  added: {
    label: 'You added',
    hue: 'var(--warn)',
    short: 'grew the context',
    advice:
      'The context grew and every later request carries the larger prefix. Quietening a noisy ' +
      'command, reading a range rather than a whole file, and not returning to the same file ' +
      'repeatedly all keep it down.',
  },
  produced: {
    label: 'Produced',
    hue: 'var(--accent)',
    short: 'went on thinking and answering',
    advice: 'This is the work itself. Usually nothing to do about it.',
  },
  delegated: {
    label: 'Delegated',
    hue: 'var(--blue)',
    short: 'went to agents with context windows of their own',
    advice:
      'Each agent has a context window of its own, so this sits outside the session total ' +
      'entirely. Fewer agents, narrower briefs, or a lighter model for lookup work.',
  },
};

/**
 * What a turn spent, split four ways.
 *
 * The bar and the rows read off one set of figures that sum to the turn's own
 * total, so nothing here can drift from the number beside it. Delegated spend
 * is drawn apart from the rest because it genuinely is apart: a subagent has
 * its own window, and folding it into a session total would double-count it.
 */
export function Ledger({ turn, onCollapse }: { turn: Turn; onCollapse: () => void }) {
  const { rewritten, added, produced, input } = turn.ledger;
  const own = rewritten + added + produced + input;
  const rows: Array<[Exclude<TurnCause, null>, number]> = [
    ['rewritten', rewritten],
    ['added', added],
    ['produced', produced],
    ['delegated', turn.delegated],
  ];

  const widest = Math.max(1, own, turn.delegated);
  const shown = rows.filter(([, n]) => n > 0);

  return (
    <div className="ledger" data-why={turn.why ?? 'none'}>
      <div className="ledger-head">
        <span className="mono ledger-total">{tokens(own)}</span>
        <span className="ledger-sub">
          {turn.delegated > 0 && <>plus {tokens(turn.delegated)} delegated · </>}
          {turn.cacheHit !== null && <>{Math.round(turn.cacheHit * 100)}% served from cache</>}
        </span>
        <button className="ledger-collapse" onClick={onCollapse}>
          Collapse
        </button>
      </div>

      {shown.length > 0 && (
        <div className="ledger-rows">
          {shown.map(([cause, n]) => (
            <div key={cause} className="ledger-row">
              <span className="ledger-label">{WHY[cause].label}</span>
              <span className="ledger-track">
                <span
                  className="ledger-fill"
                  style={{ width: `${String((n / widest) * 100)}%`, background: WHY[cause].hue }}
                />
              </span>
              <span className="mono ledger-value">{tokens(n)}</span>
            </div>
          ))}
        </div>
      )}

      {turn.why !== null && (
        <p className="ledger-why">
          <b>Mostly</b> {WHY[turn.why].short}. {WHY[turn.why].advice}
        </p>
      )}
    </div>
  );
}
