import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Search as SearchIcon, TriangleAlert, X } from 'lucide-react';
import {
  cacheHitRate,
  newTokens,
  totalNewTokens,
  type Alert,
  type SessionSummary,
  type UsageSample,
} from '../shared/model.js';
import { ICON } from './App.js';
import { clock, duration, tokens, when } from './format.js';
import { CostBar } from './ui/CostBar.js';
import { Empty } from './ui/Empty.js';
import { TopBar } from './ui/TopBar.js';
import { useRowNav, rowProps } from './useRowNav.js';
import { VirtualRows } from './ui/VirtualRows.js';

/**
 * Every conversation, most recent activity first.
 *
 * One screen where there were three. Sessions listed them, Live followed the
 * one that was running, and Search looked inside them - three answers to "which
 * conversation" that each knew nothing about the other two. A running
 * conversation is just the one at the top with a green dot.
 *
 * Every row carries the cost split rather than a single total, so the wasteful
 * conversations are visible without opening any of them.
 */
export function Conversations({
  sessions,
  onOpen,
  filter,
  onFilter,
  alerts,
  onOpenAlert,
  onDismissAlerts,
}: {
  sessions: SessionSummary[];
  onOpen: (s: SessionSummary) => void;
  /** Set from Analytics, so a chart can narrow this list to what it drew. */
  filter: string;
  onFilter: (next: string) => void;
  /** Raised while you were looking elsewhere. */
  alerts: Alert[];
  onOpenAlert: (alert: Alert) => void;
  onDismissAlerts: () => void;
}) {
  const [usage, setUsage] = useState<UsageSample | null>(null);
  const [listRef, onListKeys] = useRowNav();
  // Typing stays responsive on a corpus this size by letting the list lag a frame.
  const query = useDeferredValue(filter);

  useEffect(() => {
    void window.loupe.usage().then(setUsage);
  }, []);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    // A date filters by day, anything else by text. Analytics sends a day when
    // you click one of its bars, which is what makes a chart a door rather
    // than a picture of one.
    const day = ISO_DAY.test(q);
    const matched = q
      ? sessions.filter((s) =>
          day
            ? s.startedAt.startsWith(q) || s.endedAt.startsWith(q)
            : s.name.toLowerCase().includes(q) ||
              s.project.toLowerCase().includes(q) ||
              s.repo.toLowerCase().includes(q),
        )
      : sessions;

    // Recent activity, not when it started: a conversation opened on Monday and
    // still going is the most current thing here, not the oldest.
    return [...matched].sort((a, b) => {
      const live = running(b) - running(a);
      return live !== 0 ? live : a.endedAt < b.endedAt ? 1 : -1;
    });
  }, [sessions, query]);

  const live = rows.filter((s) => s.status === 'active').length;
  // One scale for the whole list, so bar length compares across every row.
  const peak = Math.max(1, ...rows.map((s) => totalNewTokens(s)));

  return (
    <div className="screen">
      <TopBar title="Conversations" count={rows.length}>
        <label className="finder">
          <SearchIcon {...ICON} aria-hidden />
          <input
            id="conversation-filter"
            value={filter}
            placeholder="Filter by name, project or repository"
            onChange={(e) => {
              onFilter(e.target.value);
            }}
          />
        </label>
      </TopBar>

      {alerts.length > 0 && (
        <Raised alerts={alerts} onOpen={onOpenAlert} onDismiss={onDismissAlerts} />
      )}

      <Period sessions={sessions} usage={usage} live={live} />

      <div className="list" ref={listRef} onKeyDown={onListKeys}>
        {rows.length === 0 ? (
          <Empty align="left">
            Nothing matches {filter ? `"${filter}"` : 'yet'}. Conversations appear here as Claude
            Code writes them.
          </Empty>
        ) : (
          <VirtualRows
            items={rows}
            rowHeight={62}
            render={(s) => (
              <Row
                key={s.id}
                session={s}
                peak={peak}
                onOpen={() => {
                  onOpen(s);
                }}
              />
            )}
          />
        )}
      </div>
    </div>
  );
}

const running = (s: SessionSummary): number => (s.status === 'active' ? 1 : 0);

/* ---- What happened while you were elsewhere ----------------------------- */

/**
 * Alerts, on the screen you open first.
 *
 * Each one also sits in the conversation it came from, which is where the
 * evidence is. This exists because an alert is the one thing in the app that
 * arrives while you are looking at something else, and a count on a nav item
 * you cannot click through to is not a notification.
 */
function Raised({
  alerts,
  onOpen,
  onDismiss,
}: {
  alerts: Alert[];
  onOpen: (a: Alert) => void;
  onDismiss: () => void;
}) {
  return (
    <div className="raised">
      <div className="raised-head">
        <TriangleAlert {...ICON} aria-hidden />
        <span className="eyebrow">
          {alerts.length} {alerts.length === 1 ? 'alert' : 'alerts'}
        </span>
        <button className="raised-clear" onClick={onDismiss} aria-label="Dismiss all alerts">
          <X {...ICON} aria-hidden />
        </button>
      </div>
      {alerts.slice(0, 3).map((a) => (
        <button
          key={a.id}
          className="raised-row"
          onClick={() => {
            onOpen(a);
          }}
        >
          <span className="mono raised-when">{clock(a.at)}</span>
          <span className="raised-what ellipsis">
            <b>{a.title}</b> {a.detail}
          </span>
          <span className="mono raised-where ellipsis">{a.sessionName}</span>
        </button>
      ))}
      {alerts.length > 3 && (
        <div className="raised-more">
          and {alerts.length - 3} more, each in its own conversation
        </div>
      )}
    </div>
  );
}

/** A whole day, as Analytics writes it. */
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/* ---- The period strip --------------------------------------------------- */

/** How far back the strip reckons. Long enough to show a pattern, short enough to be current. */
const WINDOW_DAYS = 7;

/**
 * The week in four figures.
 *
 * Not a chart - Analytics draws those. This says what the last seven days cost
 * and what is running right now, so the answer to "how am I doing" is on the
 * screen you already open first.
 */
function Period({
  sessions,
  usage,
  live,
}: {
  sessions: SessionSummary[];
  usage: UsageSample | null;
  live: number;
}) {
  // Anchored to the newest conversation rather than to the wall clock. Reading
  // the clock during render is impure, and it is also the wrong anchor: open
  // the app after a week away and a clock-anchored window reports zero, which
  // is true and useless. This always describes the last seven days you worked.
  const latest = sessions.reduce((n, s) => Math.max(n, Date.parse(s.endedAt)), 0);
  const window = WINDOW_DAYS * 86_400_000;
  const now = summarise(sessions, latest - window, latest);
  const before = summarise(sessions, latest - window * 2, latest - window);
  const weekly = usage?.limits.find((l) => l.kind === 'weekly_all');

  return (
    <div className="period">
      <Figure
        // Anchored to nothing is 1 January 1970, which is a date but not an answer.
        label={
          latest === 0
            ? 'Last 7 days'
            : `7 days to ${new Date(latest).toLocaleDateString(undefined, {
                day: 'numeric',
                month: 'short',
              })}`
        }
        value={tokens(now.spent)}
        note={`${String(now.count)} conversation${now.count === 1 ? '' : 's'}`}
        trend={change(now.spent, before.spent, 'less than', 'more than')}
      />
      <Figure
        label="Delegated"
        value={tokens(now.delegated)}
        note={
          now.spent === 0
            ? 'nothing delegated'
            : `${String(Math.round((now.delegated / now.spent) * 100))}% of it, in windows of its own`
        }
      />
      <Figure
        label="Served from cache"
        value={`${String(Math.round(now.hit * 100))}%`}
        note="the rest was written again"
        trend={change(now.hit, before.hit, 'worse than', 'better than')}
      />
      <Figure
        label="Weekly allowance"
        value={weekly ? `${String(weekly.percent)}%` : '—'}
        note={live > 0 ? `${String(live)} running now` : 'nothing running'}
        live={live > 0}
      />
    </div>
  );
}

/** One window's figures, so this week can be read against the one before it. */
function summarise(
  sessions: SessionSummary[],
  from: number,
  to: number,
): { spent: number; delegated: number; count: number; hit: number } {
  const within = sessions.filter((s) => {
    const at = Date.parse(s.endedAt);
    return at >= from && at < to;
  });
  const usage = within.reduce(
    (acc, s) => ({
      input: acc.input + s.usage.input,
      cacheRead: acc.cacheRead + s.usage.cacheRead,
      cacheWrite: acc.cacheWrite + s.usage.cacheWrite,
      output: 0,
      thinking: 0,
    }),
    { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, thinking: 0 },
  );
  return {
    spent: within.reduce((n, s) => n + totalNewTokens(s), 0),
    delegated: within.reduce((n, s) => n + newTokens(s.subagentUsage), 0),
    count: within.length,
    hit: cacheHitRate(usage) ?? 0,
  };
}

/**
 * This window against the one before it.
 *
 * A figure on its own says what happened and leaves you to guess whether to
 * care. Null when there is no previous window to compare against, or when the
 * difference is small enough that reporting it would be noise.
 */
function change(now: number, before: number, down: string, up: string): string | null {
  if (before === 0 || now === 0) return null;
  const by = Math.round(((now - before) / before) * 100);
  if (Math.abs(by) < 5) return 'about the same as the week before';
  return `${String(Math.abs(by))}% ${by < 0 ? down : up} the week before`;
}

function Figure({
  label,
  value,
  note,
  trend = null,
  live = false,
}: {
  label: string;
  value: string;
  note: string;
  /** How it compares to the week before, where that is worth knowing. */
  trend?: string | null;
  live?: boolean;
}) {
  return (
    <div className="figure">
      <span className="eyebrow">{label}</span>
      <span className="mono figure-value">{value}</span>
      <span className="figure-note">
        {live && <i className="status-dot" data-status="active" />}
        {note}
      </span>
      {trend !== null && <span className="figure-trend">{trend}</span>}
    </div>
  );
}

/* ---- One conversation --------------------------------------------------- */

function Row({
  session: s,
  peak,
  onOpen,
}: {
  session: SessionSummary;
  peak: number;
  onOpen: () => void;
}) {
  const delegated = newTokens(s.subagentUsage);

  return (
    <div className="crow" {...rowProps(onOpen)}>
      <span className="status-dot" data-status={s.status} title={s.status} />

      <div className="crow-main">
        <span className="crow-name ellipsis">{s.name}</span>
        <span className="mono crow-where">
          {s.project}
          {s.repo !== s.project && <span className="crow-repo"> · {s.repo}</span>}
        </span>
      </div>

      <span className="crow-track">
        <CostBar
          usage={s.usage}
          delegated={delegated}
          scale={totalNewTokens(s) / peak}
          className="crow-bar"
        />
      </span>

      <span className="mono crow-cost">{tokens(totalNewTokens(s))}</span>
      <span className="mono crow-time">{duration(s.activeMs)}</span>
      <span className="mono crow-when">{when(s.endedAt)}</span>
    </div>
  );
}
