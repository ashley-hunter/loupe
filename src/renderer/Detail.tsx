import { useEffect, useMemo, useState } from 'react';
import { PanelRight } from 'lucide-react';
import { cacheHitRate, newTokens, type SessionDetail } from '../shared/model.js';
import { byFile, byTool } from '../shared/aggregate.js';
import { ICON } from './App.js';
import { BackButton } from './ui/BackButton.js';
import { Conversation } from './Conversation.js';
import { CostBar } from './ui/CostBar.js';
import { BLANK, duration, model, percent, shortPath, tokens } from './format.js';

/**
 * One conversation.
 *
 * Five tabs became one view and a panel. Timeline, Cache, Files, Tools and
 * Subagents each answered a question about the same conversation from a
 * different corner of the screen, so reading one meant losing your place in the
 * others. The thread is the conversation; the panel is what it spent on.
 */
export function Detail({
  session,
  onBack,
  initialEventId,
  collapseAbove = 2000,
}: {
  session: SessionDetail;
  onBack: () => void;
  /** Which Event to land on, set when arriving from an Alert. */
  initialEventId?: string;
  /** Tool output larger than this stays collapsed. 0 never collapses. */
  collapseAbove?: number;
}) {
  const [panel, setPanel] = useState(false);
  const [update, setUpdate] = useState<SessionDetail | null>(null);

  /**
   * A running conversation keeps arriving.
   *
   * Live used to be a screen, and folding it in nearly lost the thing it was
   * for: without this a conversation that is still being written opens as a
   * snapshot and silently goes stale while you read it. The main process
   * watches every running transcript already, so this only has to listen for
   * the one being read.
   */
  useEffect(() => {
    setUpdate(null);
    if (session.status !== 'active') return;
    return window.loupe.onLive((detail) => {
      if (detail !== null && detail.id === session.id) setUpdate(detail);
    });
  }, [session.id, session.status]);

  const shown = update ?? session;

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement | null)?.tagName ?? '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'Escape') onBack();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [onBack]);

  const delegated = newTokens(shown.subagentUsage);

  return (
    <div className="screen">
      <div className="topbar drag-region">
        <BackButton onClick={onBack} label="Conversations" />
        {shown.status === 'active' && <span className="status-dot" data-status="active" />}
        <span className="detail-name ellipsis">{shown.name}</span>
        <span className="mono detail-where">{shown.project}</span>
        <button
          className="ghost-button"
          style={{ marginLeft: 'auto' }}
          aria-pressed={panel}
          onClick={() => {
            setPanel((v) => !v);
          }}
        >
          <PanelRight {...ICON} aria-hidden />
          What it spent on
        </button>
      </div>

      <div className="detail-head">
        <CostBar usage={shown.usage} delegated={delegated} className="detail-bar" />
        {/* A bar nobody can read is a divider. The key is what turns the header
            strip into the same four-part story the turns below it tell. */}
        <div className="detail-key">
          <Key hue="var(--warn)" label="written to cache" n={shown.usage.cacheWrite} />
          <Key hue="var(--accent)" label="produced" n={shown.usage.output} />
          {delegated > 0 && <Key hue="var(--blue)" label="delegated" n={delegated} />}
        </div>
        <div className="detail-facts">
          <Fact label="New tokens" value={tokens(newTokens(shown.usage))} />
          <Fact label="Delegated" value={delegated === 0 ? BLANK : tokens(delegated)} />
          <Fact label="Served from cache" value={percent(cacheHitRate(shown.usage))} />
          <Fact label="Active" value={duration(shown.activeMs)} />
          <Fact label="Prompts" value={String(shown.prompts)} />
          <Fact label="Model" value={shown.models[0] ? model(shown.models[0]) : BLANK} />
        </div>
      </div>

      <div className="detail-body">
        <Conversation
          session={shown}
          {...(initialEventId === undefined ? {} : { focusEventId: initialEventId })}
        />
        {panel && <SpentOn session={shown} collapseAbove={collapseAbove} />}
      </div>
    </div>
  );
}

const Key = ({ hue, label, n }: { hue: string; label: string; n: number }) => (
  <span className="detail-keyitem">
    <i style={{ background: hue }} aria-hidden />
    {label} <span className="mono">{tokens(n)}</span>
  </span>
);

const Fact = ({ label, value }: { label: string; value: string }) => (
  <div className="detail-fact">
    <span className="eyebrow">{label}</span>
    <span className="mono">{value}</span>
  </div>
);

/**
 * What this conversation spent it on: the rollups that used to be three tabs.
 *
 * Beside the thread rather than instead of it, because the question this
 * answers ("which file, which tool") only ever comes up while reading the
 * conversation that raised it.
 */
function SpentOn({ session, collapseAbove }: { session: SessionDetail; collapseAbove: number }) {
  const files = useMemo(() => byFile(session.events).slice(0, 12), [session.events]);
  const tools = useMemo(() => byTool(session.events).slice(0, 12), [session.events]);
  const agents = [...session.subagentDetail].sort(
    (a, b) => newTokens(b.usage) - newTokens(a.usage),
  );

  return (
    <aside className="spent" aria-label="What this conversation spent it on">
      <Group label="Files" rows={files.map((f) => [shortPath(f.key, session.cwd), f.cost])} />
      <Group label="Tools" rows={tools.map((t) => [t.key, t.cost])} />
      {agents.length > 0 && (
        <Group
          label="Subagents"
          rows={agents.slice(0, 12).map((a) => [a.type, newTokens(a.usage)])}
          note="own context windows, outside this total"
        />
      )}
      <p className="spent-foot">
        Tool output above {tokens(collapseAbove)} stays folded in the thread. Cache reads are
        excluded throughout: every request re-reads the whole prefix.
      </p>
    </aside>
  );
}

function Group({
  label,
  rows,
  note,
}: {
  label: string;
  rows: Array<[string, number]>;
  note?: string;
}) {
  if (rows.length === 0) return null;
  const peak = Math.max(1, ...rows.map(([, n]) => n));

  return (
    <section className="spent-group">
      <div className="eyebrow">{label}</div>
      {note !== undefined && <div className="spent-note">{note}</div>}
      {rows.map(([name, n]) => (
        <div key={name} className="spent-row" title={name}>
          <span className="ellipsis">{name}</span>
          <span className="spent-track" aria-hidden>
            <span style={{ width: `${String((n / peak) * 100)}%` }} />
          </span>
          <span className="mono spent-value">{tokens(n)}</span>
        </div>
      ))}
    </section>
  );
}
