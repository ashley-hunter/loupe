import { useEffect, useState } from 'react';
import { Database, TriangleAlert } from 'lucide-react';
import type { Alert, Event, SessionDetail } from '../shared/model.js';
import { toTurns, type Turn } from '../shared/turns.js';
import { ICON } from './App.js';
import { Markdown } from './ui/Markdown.js';
import { KIND } from './kinds.js';
import { clock, percent, tokens } from './format.js';
import { VirtualRows } from './ui/VirtualRows.js';

const CAUSE: Record<string, string> = {
  'model-change': 'the model changed part-way through',
  expiry: 'the gap since the last request outlived the cache',
  reanchor: 'the prefix moved as the context grew',
  compaction: 'the context was compacted into a summary',
  undetermined: 'no cause could be determined',
};

/** Events that are the conversation itself rather than the work behind it. */
const isSpoken = (e: Event): boolean => e.kind === 'asst';

/**
 * The session as a thread.
 *
 * The Timeline answers "what happened, in order"; this answers "what did we
 * say, and what did it cost". Each message carries its own figures underneath,
 * and anything that happened to the context between messages — a rebuild, a
 * compaction, an alert — is drawn in the gap where it happened rather than
 * filed on another screen.
 */
export function Conversation({ session }: { session: SessionDetail }) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const turns = toTurns(session);
  const peak = Math.max(1, ...turns.map((t) => t.cost));

  useEffect(() => {
    void window.loupe.alertHistory().then((all) => {
      setAlerts(all.filter((a) => a.sessionId === session.id));
    });
  }, [session.id]);

  if (turns.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--faint)' }}>
        This transcript has no exchanges.
      </div>
    );
  }

  return (
    <VirtualRows
      items={turns}
      // A guess only; every turn is measured once built, because a turn is as
      // tall as what was said in it.
      rowHeight={260}
      measure
      render={(t, i) => (
        <TurnThread turn={t} peak={peak} alerts={alertsWithin(alerts, t, turns[i + 1] ?? null)} />
      )}
    />
  );
}

/** Alerts raised between this turn and the next, so they land where they happened. */
function alertsWithin(alerts: Alert[], turn: Turn, next: Turn | null): Alert[] {
  const from = Date.parse(turn.at);
  const to = next ? Date.parse(next.at) : Infinity;
  return alerts.filter((a) => {
    const at = Date.parse(a.at);
    return at >= from && at < to;
  });
}

function TurnThread({ turn, peak, alerts }: { turn: Turn; peak: number; alerts: Alert[] }) {
  const heavy = turn.cost > peak * 0.5;
  const spoken = turn.items.filter(isSpoken);
  const work = turn.items.filter((e) => !isSpoken(e));

  return (
    <div className="thread">
      {turn.rebuilds.map((r, i) => (
        // A compaction stays quiet: the context shrank, which is the cache
        // working rather than money lost. A rebuild is the opposite - this is
        // the turn that paid to write the whole prefix out again, and it is the
        // largest avoidable cost in the corpus, so it is drawn like one.
        <div
          key={i}
          className="context-note"
          data-cost={r.cause === 'compaction' ? undefined : 'true'}
        >
          <Database {...ICON} aria-hidden />
          {r.cause === 'compaction' ? (
            <span>Context compacted · {tokens(r.rewritten)} rewritten</span>
          ) : (
            <>
              <span className="mono cost-figure">{tokens(r.rewritten)}</span>
              <span>
                rewritten here - this prompt paid to rebuild the cache because {CAUSE[r.cause]}
              </span>
            </>
          )}
        </div>
      ))}

      {turn.prompt && (
        <div className="bubble-row" data-side="you">
          <div className="bubble" data-side="you">
            <div className="bubble-text selectable">
              <Markdown text={turn.prompt.body ?? turn.prompt.title} />
            </div>
          </div>
          <div className="bubble-meta" data-side="you">
            <span className="mono">{clock(turn.prompt.at)}</span>
          </div>
        </div>
      )}

      {spoken.map((e) => (
        <div key={e.id} className="bubble-row" data-side="claude">
          <div className="bubble" data-side="claude">
            <div className="bubble-text selectable">
              <Markdown text={e.body ?? e.title} />
            </div>
          </div>
          <div className="bubble-meta" data-side="claude">
            <span className="mono">{clock(e.at)}</span>
          </div>
        </div>
      ))}

      {/* The figures for the exchange, under the message they belong to. */}
      <div className="bubble-meta" data-side="claude">
        <span className="mono metric" data-heavy={heavy}>
          {tokens(turn.cost)} added
        </span>
        <span className="mono metric">cache {percent(turn.cacheHit)}</span>
        {turn.models.map((m) => (
          <span key={m} className="mono metric">
            {m.replace(/^claude-/, '').replace(/-\d{8}$/, '')}
          </span>
        ))}
        {work.length > 0 && <Steps work={work} />}
      </div>

      {alerts.map((a) => (
        <div key={a.id} className="context-note" data-alert="true">
          <TriangleAlert {...ICON} aria-hidden />
          <span>
            {a.title} · {a.detail}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Tool calls and thinking, folded away: the detail you want second. */
function Steps({ work }: { work: Event[] }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        className="ghost-button"
        onClick={() => {
          setOpen((v) => !v);
        }}
      >
        {open ? 'Hide' : 'Show'} {work.length} {work.length === 1 ? 'step' : 'steps'}
      </button>
      {open && (
        <div className="steps">
          {work.map((e) => (
            <div key={e.id} className="turn-step">
              <span className="mono" style={{ color: KIND[e.kind][1], width: 54, flex: 'none' }}>
                {KIND[e.kind][0]}
              </span>
              <span className="ellipsis" style={{ flex: 1 }}>
                {e.title}
              </span>
              {e.failed && <span style={{ color: 'var(--err)', flex: 'none' }}>failed</span>}
              <span className="num" style={{ minWidth: 56, flex: 'none' }}>
                {tokens(e.cost)}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
