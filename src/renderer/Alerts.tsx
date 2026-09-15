import { Bell, Database, Layers, Users } from 'lucide-react';
import { Fragment, useState } from 'react';
import type { Alert, AlertKind } from '../shared/model.js';
import { groupBy } from '../shared/group.js';
import { GroupHeader } from './ui/GroupHeader.js';
import { ICON } from './App.js';
import { clock, tokens, when } from './format.js';
import { useAsync } from './useAsync.js';
import { Empty } from './ui/Empty.js';
import { Failed } from './ui/Failed.js';
import { TopBar } from './ui/TopBar.js';

const KINDS: Record<AlertKind, { label: string; icon: typeof Database }> = {
  'oversized-result': { label: 'Oversized result', icon: Layers },
  'prefix-rebuilt': { label: 'Cache rebuilt', icon: Database },
  'subagent-spend': { label: 'Subagent spend', icon: Users },
};

/**
 * Everything that has been raised, newest first.
 *
 * An Alert is the one thing in this app that arrives while you are looking
 * somewhere else, so it needs somewhere to live afterwards. Each one carries
 * the Session it came from and the measured facts behind it, because "cache
 * rebuilt three times" is not a diagnosis on its own.
 */
export function Alerts({
  onOpen,
  grouped,
  embedded = false,
}: {
  onOpen: (alert: Alert) => void;
  grouped: boolean;
  /** Rendered inside Live, which already has a bar of its own. */
  embedded?: boolean;
}) {
  const state = useAsync<Alert[]>(() => window.loupe.alertHistory());
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  const toggle = (key: string): void => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {!embedded && <TopBar title="Alerts" />}
      <div className="scroll-pane">
        <div className="pane-content">
          {state.status === 'loading' && <Empty>Reading the alert history…</Empty>}
          {state.status === 'failed' && (
            <Failed what="read the alert history" error={state.error} />
          )}
          {state.status === 'ready' && state.data.length === 0 && (
            <Empty align="left">
              Nothing has been flagged. An alert is raised when a single result dwarfs everything
              else in a session, or when the cached prefix is rebuilt repeatedly in a few minutes.
            </Empty>
          )}
          {state.status === 'ready' &&
            !grouped &&
            state.data.map((a) => <Card key={a.id} alert={a} onOpen={onOpen} />)}

          {state.status === 'ready' &&
            grouped &&
            groupBy(state.data, (a) => a.repo).map((g) => (
              <Fragment key={g.key}>
                <div style={{ marginBottom: 8 }}>
                  <GroupHeader
                    name={g.key}
                    meta={`${String(g.items.length)}  ·  ${tokens(
                      g.items.reduce((n, a) => n + a.tokens, 0),
                    )}`}
                    collapsed={collapsed.has(g.key)}
                    onToggle={() => {
                      toggle(g.key);
                    }}
                  />
                </div>
                {!collapsed.has(g.key) &&
                  g.items.map((a) => <Card key={a.id} alert={a} onOpen={onOpen} />)}
              </Fragment>
            ))}
        </div>
      </div>
    </div>
  );
}

function Card({ alert, onOpen }: { alert: Alert; onOpen: (alert: Alert) => void }) {
  const kind = KINDS[alert.kind];
  const Icon = kind.icon;

  return (
    <section
      style={{
        border: '1px solid var(--line)',
        borderRadius: 8,
        background: 'var(--panel)',
        marginBottom: 12,
      }}
    >
      <div style={{ padding: '11px 14px 10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <Icon {...ICON} color="var(--accent)" />
          <span className="eyebrow" style={{ color: 'var(--accent)' }}>
            {kind.label}
          </span>
          <span className="mono" style={{ color: 'var(--faint)', fontSize: 11 }}>
            {when(alert.at)} · {clock(alert.at)}
          </span>
          <span className="num" style={{ marginLeft: 'auto' }}>
            {tokens(alert.tokens)}
          </span>
        </div>

        {/* The two things the banner never said: which session, and which project. */}
        <div style={{ margin: '8px 0 2px', fontSize: 13.5, lineHeight: 1.4 }}>{alert.title}</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
          <span className="ellipsis" style={{ fontSize: 12.5, color: 'var(--dim)' }}>
            {alert.sessionName}
          </span>
          <span className="mono" style={{ color: 'var(--faint)', fontSize: 11, flex: 'none' }}>
            {alert.project}
          </span>
        </div>
        <div style={{ color: 'var(--dim)', fontSize: 12, lineHeight: 1.5 }}>{alert.detail}</div>
      </div>

      {alert.evidence.length > 0 && (
        <div style={{ borderTop: '1px solid var(--line)' }}>
          <div className="eyebrow" style={{ padding: '8px 14px 2px' }}>
            What it is standing on
          </div>
          {alert.evidence.map((e, i) => (
            <div
              key={`${e.at}-${String(i)}`}
              className="group-row"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '5px 14px',
                fontSize: 12,
              }}
            >
              <span className="mono" style={{ color: 'var(--faint)', fontSize: 11, flex: 'none' }}>
                {clock(e.at)}
              </span>
              <span className="ellipsis" style={{ flex: 1 }}>
                {e.label}
              </span>
              <span className="num" style={{ flex: 'none', minWidth: 56 }}>
                {tokens(e.tokens)}
              </span>
            </div>
          ))}
        </div>
      )}

      <div style={{ borderTop: '1px solid var(--line)', padding: '8px 14px' }}>
        <button
          className="ghost-button"
          onClick={() => {
            onOpen(alert);
          }}
        >
          {alert.tab === 'cache' ? 'Open the cache breakdown' : 'Open the event'}
        </button>
      </div>
    </section>
  );
}

export const AlertsIcon = Bell;
