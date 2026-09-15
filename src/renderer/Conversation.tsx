import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Database, Scissors, TriangleAlert, Users } from 'lucide-react';
import type { Alert, Event, Invalidation, SessionDetail } from '../shared/model.js';
import { toTurns, type Turn } from '../shared/turns.js';
import { ICON } from './App.js';
import { Markdown } from './ui/Markdown.js';
import { KIND } from './kinds.js';
import { clock, duration, model as modelName, tokens } from './format.js';
import { Ledger } from './ui/Ledger.js';
import { VirtualRows } from './ui/VirtualRows.js';

/**
 * Why the prefix had to be written again, and what to do about it.
 *
 * `why` is the reason, not the mechanism: "the prefix moved as the context
 * grew" describes what happened and leaves you none the wiser. `remedy` is
 * shown once per cause per conversation - the reason is news every time it
 * happens, the remedy is only news the first time.
 */
const CAUSE: Record<string, { why: string; remedy: string }> = {
  reanchor: {
    why: 'the context outgrew what the cache can extend, so it rebuilds from a smaller base',
    remedy: 'A ceiling rather than a mistake: only a shorter conversation avoids it.',
  },
  expiry: {
    why: 'nothing was sent for long enough that the cached prefix expired',
    remedy: 'Unavoidable across a real break. Coming back sooner is the only thing that keeps it.',
  },
  'model-change': {
    why: 'the prefix is held per model, and the model changed part-way through',
    remedy:
      'Choosing the model before the context is large costs nothing; switching later costs all of it.',
  },
  compaction: {
    why: 'the context was summarised to fit',
    remedy: 'The cache working, not waste.',
  },
  undetermined: {
    why: 'the prefix was discarded for no reason the transcript records',
    remedy: 'Reported as-is rather than guessed at.',
  },
};

/** Events that are the conversation itself rather than the work behind it. */
const isSpoken = (e: Event): boolean => e.kind === 'asst';

/**
 * How far above the session's own typical turn a turn has to be before it
 * opens on its own.
 *
 * Measured against the median rather than the peak: one enormous turn should
 * not make every other turn in the session look quiet by comparison.
 */
const LOUD = 3;

/**
 * The session as a thread, with every turn accounting for itself.
 *
 * The old Timeline answered "what happened, in order" - the right shape for
 * finding one event among fourteen thousand and the wrong shape for reading.
 * This answers "what did we say, what did it cost, and why". The why is the
 * part that did not exist before: a single figure per turn cannot tell you
 * whether it went on work or on paying a second time for context.
 *
 * Quiet turns collapse to a line. Showing a thousand turns at equal weight is
 * the reason this screen felt overwhelming, so cost decides prominence.
 */
export function Conversation({
  session,
  focusEventId,
}: {
  session: SessionDetail;
  /**
   * An Event to land on, from an Alert or the palette.
   *
   * Turns are what this screen draws, so an Event id is resolved to the turn
   * holding it rather than looked for directly - there is no element with an
   * Event's id here, which is why arriving from an Alert used to scroll
   * nowhere at all.
   */
  focusEventId?: string;
}) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [all, setAll] = useState(false);

  const turns = useMemo(() => toTurns(session), [session]);

  const focus = useMemo(() => {
    if (focusEventId === undefined) return null;
    const holding = turns.find(
      (t) => t.prompt?.id === focusEventId || t.items.some((e) => e.id === focusEventId),
    );
    return holding?.id ?? null;
  }, [turns, focusEventId]);

  useEffect(() => {
    if (focus === null) return;
    document.getElementById(focus)?.scrollIntoView({ block: 'center' });
  }, [focus]);
  const typical = useMemo(() => median(turns.map((t) => t.cost + t.delegated)), [turns]);
  const peak = Math.max(1, ...turns.map((t) => t.cost + t.delegated));

  useEffect(() => {
    void window.loupe.alertHistory().then((held) => {
      setAlerts(held.filter((a) => a.sessionId === session.id));
    });
  }, [session.id]);

  /**
   * The first rebuild of each cause, which is the one that carries the remedy.
   * Repeating what to do on every one of six identical rebuilds is how a
   * reader learns to skip the line entirely.
   */
  const explain = useMemo(() => {
    // Keyed by the rebuild itself, not by its cause: keying by cause matches
    // every occurrence, which is how the remedy ended up under all six of them.
    const first = new Set<string>();
    const seen = new Set<string>();
    for (const t of turns) {
      for (const r of t.rebuilds) {
        if (seen.has(r.cause)) continue;
        seen.add(r.cause);
        first.add(r.at);
      }
    }
    return first;
  }, [turns]);

  const toggle = (id: string): void => {
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  };

  if (turns.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--faint)' }}>
        This transcript has no exchanges.
      </div>
    );
  }

  const loud = (t: Turn): boolean =>
    all || open.has(t.id) || t.id === focus || t.cost + t.delegated > Math.max(typical * LOUD, 1);

  return (
    <div className="convo">
      <Spine turns={turns} peak={peak} loud={loud} />

      <div className="convo-scroll">
        <div className="convo-tools">
          <button
            className="ghost-button"
            onClick={() => {
              setAll((v) => !v);
            }}
          >
            {all ? 'Collapse the quiet turns' : 'Expand every turn'}
          </button>
          <span className="mono convo-count">
            {turns.length} {turns.length === 1 ? 'turn' : 'turns'} · typical {tokens(typical)}
          </span>
        </div>

        <VirtualRows
          items={turns}
          // A guess only; every turn is measured once built, because a turn is
          // as tall as what was said in it.
          rowHeight={140}
          measure
          render={(t, i) => (
            <TurnThread
              turn={t}
              previous={turns[i - 1] ?? null}
              loud={loud(t)}
              focused={t.id === focus}
              explain={explain}
              onToggle={() => {
                toggle(t.id);
              }}
              alerts={alertsWithin(alerts, t, turns[i + 1] ?? null)}
            />
          )}
        />
      </div>
    </div>
  );
}

/* ---- The spine ---------------------------------------------------------- */

/**
 * A map of where the money went, down the edge of the conversation.
 *
 * Each turn is a band whose height is its share of the session and whose colour
 * is what it mostly spent on. Scanning it finds the three turns that mattered
 * in a session of four hundred, which no amount of scrolling does.
 */
function Spine({ turns, peak, loud }: { turns: Turn[]; peak: number; loud: (t: Turn) => boolean }) {
  return (
    <nav className="spine" aria-label="Cost through the conversation">
      {turns.map((t) => (
        <a
          key={t.id}
          href={`#${t.id}`}
          className="spine-band"
          data-why={t.why ?? 'none'}
          data-loud={loud(t) ? 'true' : undefined}
          style={{ flexGrow: Math.max((t.cost + t.delegated) / peak, 0.004) }}
          title={`${tokens(t.cost + t.delegated)} · ${t.prompt?.title.slice(0, 60) ?? 'continued'}`}
        >
          <span className="sr-only">{t.prompt?.title ?? 'Continued'}</span>
        </a>
      ))}
    </nav>
  );
}

/* ---- One turn ----------------------------------------------------------- */

/** Alerts raised between this turn and the next, so they land where they happened. */
function alertsWithin(alerts: Alert[], turn: Turn, next: Turn | null): Alert[] {
  const from = Date.parse(turn.at);
  const to = next ? Date.parse(next.at) : Infinity;
  return alerts.filter((a) => {
    const at = Date.parse(a.at);
    return at >= from && at < to;
  });
}

function TurnThread({
  turn,
  previous,
  loud,
  focused,
  explain,
  onToggle,
  alerts,
}: {
  turn: Turn;
  previous: Turn | null;
  loud: boolean;
  /** Arrived here from an Alert: marked, so the landing is visible. */
  focused: boolean;
  /** Timestamps of the first rebuild of each cause, which carry the remedy. */
  explain: ReadonlySet<string>;
  onToggle: () => void;
  alerts: Alert[];
}) {
  const idle = previous ? Date.parse(turn.at) - Date.parse(previous.at) : 0;
  const spoken = turn.items.filter(isSpoken);
  const work = turn.items.filter((e) => !isSpoken(e));

  return (
    <div className="thread" id={turn.id} data-focused={focused ? 'true' : undefined}>
      {turn.rebuilds.map((r, i) => (
        <Rebuilt key={i} rebuild={r} explain={explain.has(r.at)} />
      ))}

      {!loud ? (
        <button className="turn-quiet" onClick={onToggle}>
          <ChevronRight {...ICON} className="chev" aria-hidden />
          <span className="ellipsis">{turn.prompt?.title ?? 'Continued without a new prompt'}</span>
          <span className="mono quiet-cost">{tokens(turn.cost + turn.delegated)}</span>
          <i className="why-dot" data-why={turn.why ?? 'none'} aria-hidden />
        </button>
      ) : (
        <>
          {turn.prompt && (
            <div className="bubble-row" data-side="you">
              <div className="bubble" data-side="you">
                <div className="bubble-text selectable">
                  <Markdown text={turn.prompt.body ?? turn.prompt.title} />
                </div>
              </div>
              <div className="bubble-meta" data-side="you">
                <span className="mono">{clock(turn.prompt.at)}</span>
                {idle > 60_000 && (
                  <span className="mono" title="Time since the previous turn">
                    after {duration(idle)}
                  </span>
                )}
              </div>
            </div>
          )}

          {/*
            One stamp for the run, not one per bubble.
            A turn where Claude says five short things in four minutes used to
            draw five bubbles each with its own timestamp underneath, which is
            ten rows for five sentences. The messages stack; the time is stated
            once, as a span when they spanned one.
          */}
          {spoken.length > 0 && (
            <div className="bubble-row" data-side="claude">
              {spoken.map((e) => (
                <div key={e.id} className="bubble" data-side="claude" title={clock(e.at)}>
                  <div className="bubble-text selectable">
                    <Markdown text={e.body ?? e.title} />
                  </div>
                </div>
              ))}
              <div className="bubble-meta" data-side="claude">
                <span className="mono">{span(spoken)}</span>
              </div>
            </div>
          )}

          <Ledger turn={turn} onCollapse={onToggle} />
          {work.length > 0 && <Steps work={work} />}
        </>
      )}

      {turn.agents.length > 0 && <Delegated turn={turn} />}

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

/* ---- Things that happened to the context -------------------------------- */

/**
 * A rebuild, drawn where it was paid for.
 *
 * Compaction keeps the quiet treatment: the context shrank, which is the cache
 * working rather than money lost. Everything else is the single largest
 * avoidable cost the app measures, so it leads with the figure and is drawn
 * like one.
 */
function Rebuilt({ rebuild: r, explain }: { rebuild: Invalidation; explain: boolean }) {
  const compacted = r.cause === 'compaction';
  const cause = CAUSE[r.cause] ?? CAUSE['undetermined']!;

  // The specifics the record already carries and nothing was reading: how long
  // the gap actually was, and which way the model changed.
  const detail =
    r.cause === 'expiry' && r.idleMs > 0
      ? `after ${duration(r.idleMs)} with nothing sent`
      : r.cause === 'model-change' && r.detail !== undefined
        ? r.detail
            .split(' → ')
            .map((m) => modelName(m))
            .join(' to ')
        : null;

  return (
    <div className="context-note" data-cost={compacted ? undefined : 'true'}>
      <div className="marker-icon">
        {compacted ? <Scissors {...ICON} aria-hidden /> : <Database {...ICON} aria-hidden />}
      </div>
      <div className="marker-body">
        <div>
          <span className="mono cost-figure">{tokens(r.rewritten)}</span>{' '}
          <span>
            {compacted ? 'compacted away' : 'rewritten'} because {cause.why}
          </span>
          {detail !== null && <span className="marker-cause"> · {detail}</span>}
        </div>
        {explain && <div className="marker-remedy">{cause.remedy}</div>}
      </div>
    </div>
  );
}

/**
 * What this turn handed to agents with context windows of their own.
 *
 * Types are counted rather than listed: a turn that spawned three
 * general-purpose agents read as "general-purpose, general-purpose,
 * general-purpose", which is three times the words for none of the information.
 */
function Delegated({ turn }: { turn: Turn }) {
  const counts = new Map<string, number>();
  for (const a of turn.agents) counts.set(a.type, (counts.get(a.type) ?? 0) + 1);
  const named = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([type, n]) => (n === 1 ? type : `${String(n)} × ${type}`))
    .join(', ');

  return (
    <div className="context-note" data-delegated="true">
      <div className="marker-icon">
        <Users {...ICON} aria-hidden />
      </div>
      <div className="marker-body">
        <div>
          <span className="mono cost-figure">{tokens(turn.delegated)}</span>{' '}
          <span>
            spent by {named}, and none of it appears in this turn because each agent reads and
            writes a context window of its own
          </span>
        </div>
        <div className="marker-remedy">
          Worth it when an agent keeps something large out of this conversation, wasted when it
          reads the same files you already have.
        </div>
      </div>
    </div>
  );
}

/** Tool calls and thinking, folded away: the detail you want second. */
function Steps({ work }: { work: Event[] }) {
  const [open, setOpen] = useState(false);
  const failed = work.filter((e) => e.failed).length;

  return (
    <div className="steps">
      <button
        className="steps-toggle"
        onClick={() => {
          setOpen((v) => !v);
        }}
      >
        <ChevronRight
          {...ICON}
          className="chev"
          data-open={open ? 'true' : undefined}
          aria-hidden
        />
        {work.length} {work.length === 1 ? 'step' : 'steps'}
        {failed > 0 && <span className="steps-failed">{failed} failed</span>}
      </button>
      {open &&
        work.map((e) => (
          <div key={e.id} className="turn-step">
            <span className="mono step-kind" style={{ color: KIND[e.kind][1] }}>
              {KIND[e.kind][0]}
            </span>
            <span className="ellipsis" style={{ color: e.failed ? 'var(--err)' : undefined }}>
              {e.title}
            </span>
            {e.cost !== null && e.cost > 0 && (
              <span className="mono step-cost">{tokens(e.cost)}</span>
            )}
          </div>
        ))}
    </div>
  );
}

/** When a run of messages started and finished, or just when, if it was one moment. */
function span(events: Event[]): string {
  const first = clock(events[0]?.at ?? '');
  const last = clock(events.at(-1)?.at ?? '');
  return first === last ? first : `${first} to ${last}`;
}

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};
