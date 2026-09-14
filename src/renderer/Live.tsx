import { useEffect, useRef, useState } from 'react';
import {
  cacheHitRate,
  newTokens,
  type Alert,
  type SessionDetail,
  type UsageSample,
} from '../shared/model.js';
import { Empty } from './ui/Empty.js';
import { EventRow } from './ui/EventRow.js';
import { Inspector } from './ui/Inspector.js';
import { Stat } from './ui/Stat.js';
import { StatStrip } from './ui/StatStrip.js';
import { clock, duration, percent, tokens } from './format.js';

/** How many of the most recent Events to show. Older ones are in the Timeline. */
const TAIL = 60;

export function Live({
  usage,
  alerts,
  onDismissAlerts,
  onOpen,
  collapseAbove,
}: {
  usage: UsageSample | null;
  alerts: Alert[];
  onDismissAlerts: () => void;
  onOpen: (detail: SessionDetail) => void;
  collapseAbove: number;
}) {
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [waiting, setWaiting] = useState(true);
  const [pinned, setPinned] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const feed = useRef<HTMLDivElement>(null);
  const previousCount = useRef(0);

  useEffect(() => {
    const stop = window.loupe.onLive((detail) => {
      setSession(detail);
      setWaiting(false);
    });
    void window.loupe.startLive();
    return () => {
      stop();
      void window.loupe.stopLive();
    };
  }, []);

  // Follow the tail unless the reader has scrolled away from it.
  useEffect(() => {
    const count = session?.events.length ?? 0;
    if (pinned && count !== previousCount.current && feed.current) {
      feed.current.scrollTop = feed.current.scrollHeight;
    }
    previousCount.current = count;
  }, [session, pinned]);

  if (waiting) {
    return (
      <Shell>
        <Empty>Looking for a running session…</Empty>
      </Shell>
    );
  }

  if (!session) {
    return (
      <Shell>
        <Empty align="left">
          Nothing is running. A session shows here while its transcript is still being written to —
          start Claude Code anywhere and it will appear.
        </Empty>
      </Shell>
    );
  }

  const events = session.events.slice(-TAIL);
  const limit = usage?.limits.find((l) => l.kind === 'session');
  // Looked up in the whole Session rather than the visible tail, so the panel
  // keeps its Event once new ones push it out of the feed.
  const event = session.events.find((e) => e.id === selected) ?? null;

  return (
    <Shell
      title={session.name}
      project={session.project}
      onOpen={() => {
        onOpen(session);
      }}
    >
      {alerts.length > 0 && <Alerts alerts={alerts} onDismiss={onDismissAlerts} />}

      <StatStrip>
        <Stat label="New tokens" value={tokens(newTokens(session.usage))} />
        <Stat label="Requests" value={String(session.requestCount)} />
        <Stat label="Tool calls" value={String(session.toolCalls)} />
        <Stat label="Cache hit" value={percent(cacheHitRate(session.usage))} />
        <Stat label="Active" value={duration(session.activeMs)} />
        <Stat label="Subagents" value={String(session.subagentDetail.length)} />
        <Stat
          label="5-hour allowance"
          value={limit ? `${limit.percent}%` : '—'}
          note={limit?.resetsAt ? `resets ${clock(limit.resetsAt)}` : undefined}
        />
      </StatStrip>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div
          ref={feed}
          onScroll={(e) => {
            const el = e.currentTarget;
            // Re-pin only when the reader returns to the bottom themselves.
            setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 24);
          }}
          style={{ overflow: 'auto', minHeight: 0, minWidth: 0, flex: 1 }}
        >
          {events.map((e) => (
            <EventRow
              key={e.id}
              event={e}
              active={e.id === selected}
              onSelect={() => {
                setSelected(e.id);
                // Stop following the tail: reading an Event while the feed
                // scrolls out from under you is the thing this panel is for.
                setPinned(false);
              }}
            />
          ))}
          {events.length === 0 && (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--faint)' }}>
              No events yet.
            </div>
          )}
        </div>
        {selected !== null && <Inspector event={event} collapseAbove={collapseAbove} />}
      </div>

      {!pinned && (
        <button
          onClick={() => {
            setPinned(true);
            if (feed.current) feed.current.scrollTop = feed.current.scrollHeight;
          }}
          style={{
            flex: 'none',
            border: 'none',
            borderTop: '1px solid var(--line)',
            background: 'var(--accentSoft)',
            color: 'var(--accent)',
            padding: '6px 0',
            fontSize: 11.5,
          }}
        >
          Jump to the latest
        </button>
      )}
    </Shell>
  );
}

/**
 * What just cost a lot. Shown here rather than as a system notification when
 * the app is already in front of you — the main process decides which.
 */
function Alerts({ alerts, onDismiss }: { alerts: Alert[]; onDismiss: () => void }) {
  return (
    <div
      className="alert-banner"
      style={{
        flex: 'none',
        borderBottom: '1px solid var(--errBd)',
        background: 'var(--errBg)',
        padding: '8px 12px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span className="eyebrow" style={{ color: 'var(--err)' }}>
          {alerts.length} {alerts.length === 1 ? 'alert' : 'alerts'}
        </span>
        <button
          onClick={onDismiss}
          style={{
            marginLeft: 'auto',
            border: 'none',
            background: 'none',
            color: 'var(--dim)',
            fontSize: 11,
          }}
        >
          Clear
        </button>
      </div>
      {alerts.slice(0, 3).map((a) => (
        <div key={a.id} style={{ fontSize: 12, lineHeight: 1.5 }}>
          <span className="mono" style={{ color: 'var(--faint)', fontSize: 10.5 }}>
            {clock(a.at)}
          </span>{' '}
          <span style={{ fontWeight: 600 }}>{a.title}</span>{' '}
          <span style={{ color: 'var(--dim)' }}>{a.detail}</span>
        </div>
      ))}
      {alerts.length > 3 && (
        <div style={{ color: 'var(--faint)', fontSize: 11, marginTop: 3 }}>
          and {alerts.length - 3} more
        </div>
      )}
    </div>
  );
}

function Shell({
  title,
  project,
  onOpen,
  children,
}: {
  title?: string;
  project?: string;
  onOpen?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div className="topbar drag-region">
        <span style={{ fontWeight: 600, letterSpacing: '-.01em' }}>Live</span>
        {title && (
          <>
            <span style={{ color: 'var(--live)', fontSize: 9 }}>●</span>
            <span className="ellipsis" style={{ fontSize: 12.5 }}>
              {title}
            </span>
            <span className="mono" style={{ color: 'var(--faint)', fontSize: 11, flex: 'none' }}>
              {project}
            </span>
            <button className="ghost-button" style={{ marginLeft: 'auto' }} onClick={onOpen}>
              Open the session
            </button>
          </>
        )}
      </div>
      {children}
    </div>
  );
}
