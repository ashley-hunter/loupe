import {
  Activity,
  Bell,
  ChartColumn,
  Database,
  Folder,
  Lightbulb,
  List,
  Search as SearchIcon,
  SlidersVertical,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { IndexResult } from '../main/catalogue.js';
import type {
  Alert,
  Finding,
  SessionDetail,
  SessionSummary,
  UsageSample,
} from '../shared/model.js';
import { Cache } from './Cache.js';
import { Detail } from './Detail.js';
import { Analytics } from './Analytics.js';
import { Insights } from './Insights.js';
import { Live } from './Live.js';
import { Palette } from './Palette.js';
import { Search } from './Search.js';
import { Projects } from './Projects.js';
import { Settings } from './Settings.js';
import { Alerts as AlertsScreen } from './Alerts.js';
import { Sessions } from './Sessions.js';
import { duration } from './format.js';
import type { Prefs } from '../shared/prefs.js';
import iconUrl from './icon.png';
import { loadPrefs } from './prefs.js';
import { Empty } from './ui/Empty.js';
import { Meter } from './ui/Meter.js';
import { Tooltip } from './ui/Tooltip.js';
import { useWidth } from './useWidth.js';

type Screen =
  | { at: 'sessions' }
  | { at: 'cache' }
  | { at: 'insights' }
  | { at: 'analytics' }
  | { at: 'live' }
  | { at: 'alerts' }
  | { at: 'search' }
  | { at: 'projects' }
  | { at: 'settings' }
  | { at: 'detail'; session: SessionDetail; tab: string; eventId?: string };

/** Sidebar entries. `ready` marks the ones that have their data yet. */
interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  ready: boolean;
}

/**
 * Order and icons follow the design, which draws Lucide at 15px with a 1.7
 * stroke — its `folder` path matches lucide-react's byte for byte.
 */
const NAV: NavItem[] = [
  { id: 'sessions', label: 'Sessions', icon: List, ready: true },
  { id: 'search', label: 'Search', icon: SearchIcon, ready: true },
  { id: 'live', label: 'Live', icon: Activity, ready: true },
  { id: 'alerts', label: 'Alerts', icon: Bell, ready: true },
  { id: 'analytics', label: 'Analytics', icon: ChartColumn, ready: true },
  { id: 'insights', label: 'Insights', icon: Lightbulb, ready: true },
  { id: 'projects', label: 'Projects', icon: Folder, ready: true },
  { id: 'cache', label: 'Cache', icon: Database, ready: true },
  { id: 'settings', label: 'Settings', icon: SlidersVertical, ready: true },
];

/**
 * The number beside a nav item: unread alerts on Live, otherwise a count of
 * what that screen holds. Undefined means no badge at all.
 */
function badgeFor(
  id: string,
  sessions: SessionSummary[] | undefined,
  alerts: number,
): number | undefined {
  if (id === 'live') {
    if (alerts > 0) return alerts;
    const running = sessions?.filter((s) => s.status === 'active').length ?? 0;
    return running > 0 ? running : undefined;
  }
  if (id === 'sessions') return sessions?.length;
  return undefined;
}

/** Which screen each nav id opens. A lookup rather than a ternary chain. */
const SCREEN_FOR: Record<string, Screen> = {
  sessions: { at: 'sessions' },
  search: { at: 'search' },
  live: { at: 'live' },
  alerts: { at: 'alerts' },
  analytics: { at: 'analytics' },
  insights: { at: 'insights' },
  projects: { at: 'projects' },
  cache: { at: 'cache' },
  settings: { at: 'settings' },
};

/**
 * How recent an Alert has to be to still be worth a banner. Matches the window
 * the detectors themselves use, so the banner and the notification agree.
 */
const RECENT_ALERT_MS = 15 * 60_000;

/** Newest first, without repeating an Alert already held. */
const merge = (fresh: Alert[], current: Alert[]): Alert[] => {
  const byId = new Map(current.map((a) => [a.id, a]));
  for (const a of fresh) byId.set(a.id, a);
  return [...byId.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 20);
};

/** The design's icon size and weight, used everywhere an icon appears. */
export const ICON = { size: 15, strokeWidth: 1.7 } as const;

export function App() {
  const [index, setIndex] = useState<IndexResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>({ at: 'sessions' });
  const [usage, setUsage] = useState<UsageSample | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [palette, setPalette] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>(
    () => (localStorage.getItem('loupe.theme') as 'light' | 'dark' | 'system' | null) ?? 'system',
  );
  const [prefs, setPrefs] = useState(loadPrefs);
  const width = useWidth();
  const rail = width < 820; // the design collapses the sidebar to icons here

  // Cmd/Ctrl-K opens the palette, Cmd/Ctrl-F opens Search, as any native app would.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key === 'k') {
        e.preventDefault();
        setPalette((v) => !v);
      } else if (key === 'f') {
        e.preventDefault();
        setScreen({ at: 'search' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  useEffect(() => {
    const dark =
      theme === 'system'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
        : theme === 'dark';
    document.documentElement.dataset['theme'] = dark ? 'dark' : 'light';
    try {
      localStorage.setItem('loupe.theme', theme);
    } catch {
      /* fine */
    }
  }, [theme]);

  useEffect(() => {
    void window.loupe.usage().then(setUsage);
    return window.loupe.onUsageSample(setUsage);
  }, []);

  // Alerts arrive whenever the Live watcher is running, whatever screen is open.
  //
  // The history is read on mount as well as subscribed to, because the watcher
  // starts in the main process before this window has finished loading: an
  // Alert raised in that gap would otherwise be broadcast to nobody and only
  // ever be seen on the Alerts screen.
  useEffect(() => {
    void window.loupe.alertHistory().then((all) => {
      const recent = all.filter((a) => Date.now() - Date.parse(a.at) < RECENT_ALERT_MS);
      setAlerts((current) => merge(recent, current));
    });
    return window.loupe.onAlerts((fresh) => {
      setAlerts((current) => merge(fresh, current));
    });
  }, []);

  // Preferences are stored in the renderer, so the poller has to be told.
  useEffect(() => {
    void window.loupe.setPollInterval(prefs.pollMinutes);
  }, [prefs.pollMinutes]);

  useEffect(() => {
    window.loupe
      .index()
      .then(setIndex)
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
      });
  }, []);

  const open = useCallback((s: SessionSummary, tab: Finding['tab'] = 'timeline') => {
    void window.loupe.session(s.path).then((detail) => {
      if (detail) setScreen({ at: 'detail', session: detail, tab });
    });
  }, []);

  /** Land on the evidence for an Alert: its Session, its tab, its Event. */
  const openAlert = useCallback((alert: Alert) => {
    void window.loupe.session(alert.sessionPath).then((detail) => {
      if (!detail) return;
      setScreen({
        at: 'detail',
        session: detail,
        tab: alert.tab,
        ...(alert.eventId !== undefined ? { eventId: alert.eventId } : {}),
      });
    });
  }, []);

  const back = useCallback(() => {
    setScreen({ at: 'sessions' });
  }, []);

  // Clicking the native notification lands on that Alert's evidence.
  useEffect(() => window.loupe.onOpenAlert(openAlert), [openAlert]);

  const go = useCallback((id: string) => {
    setScreen(SCREEN_FOR[id] ?? { at: 'sessions' });
  }, []);

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `${rail ? '60px' : 'var(--sw)'} minmax(0, 1fr)`,
        height: '100%',
      }}
    >
      <nav
        className="drag-region"
        style={{
          background: 'var(--side)',
          borderRight: '1px solid var(--line)',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
        }}
      >
        <div
          className="traffic-light-inset"
          style={{
            height: 'var(--barH)',
            flex: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            paddingRight: 12,
            borderBottom: '1px solid var(--line)',
            justifyContent: rail ? 'center' : 'flex-start',
          }}
        >
          <img
            src={iconUrl}
            alt=""
            width={17}
            height={17}
            style={{ flex: 'none', display: 'block' }}
          />
          {!rail && <span style={{ fontWeight: 650, letterSpacing: '-.01em' }}>Loupe</span>}
        </div>

        <div style={{ padding: '10px 6px', display: 'flex', flexDirection: 'column', gap: 1 }}>
          {NAV.map((n) => {
            const active = screen.at === 'detail' ? n.id === 'sessions' : n.id === screen.at;
            const count = badgeFor(n.id, index?.sessions, alerts.length);
            const Icon = n.icon;
            return (
              <button
                key={n.id}
                disabled={!n.ready}
                onClick={
                  n.ready
                    ? () => {
                        go(n.id);
                      }
                    : undefined
                }
                title={n.ready ? n.label : `${n.label} — arrives in a later version`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 9,
                  justifyContent: rail ? 'center' : 'flex-start',
                  minHeight: 'var(--navH)',
                  padding: '6px 8px',
                  borderRadius: 6,
                  border: 'none',
                  width: '100%',
                  textAlign: 'left',
                  background: active ? 'var(--accentSoft)' : 'transparent',
                  color: !n.ready ? 'var(--faint)' : active ? 'var(--accent)' : 'var(--fg)',
                  fontWeight: active ? 600 : 400,
                }}
              >
                <Icon {...ICON} style={{ flex: 'none' }} aria-hidden />
                {!rail && <span style={{ whiteSpace: 'nowrap' }}>{n.label}</span>}
                {!rail && count !== undefined && (
                  <span
                    className="mono"
                    style={{
                      marginLeft: 'auto',
                      fontSize: 10,
                      color: n.id === 'live' && alerts.length > 0 ? 'var(--err)' : 'var(--faint)',
                    }}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div style={{ marginTop: 'auto' }}>
          {!rail && (
            <div className="eyebrow" style={{ padding: '14px 16px 6px' }}>
              Allowance
            </div>
          )}
          <Allowance usage={usage} rail={rail} />

          <div
            style={{
              padding: '8px 12px',
              borderTop: '1px solid var(--line)',
              color: 'var(--faint)',
              fontSize: 10.5,
              display: rail ? 'none' : 'block',
            }}
          >
            {index && (
              <Tooltip text={`${index.parsed} parsed, ${index.reused} from cache`}>
                <div className="mono">
                  {index.sessions.length} sessions · {index.ms}ms
                </div>
              </Tooltip>
            )}
          </div>
        </div>
      </nav>

      <Palette
        open={palette}
        onClose={() => {
          setPalette(false);
        }}
        screens={NAV.filter((n) => n.ready).map((n) => ({
          id: n.id,
          label: n.label,
          go: () => {
            go(n.id);
          },
        }))}
        sessions={index?.sessions ?? []}
        onOpenSession={open}
      />

      <main style={{ minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
        <CurrentScreen
          screen={screen}
          index={index}
          error={error}
          usage={usage}
          alerts={alerts}
          prefs={prefs}
          theme={theme}
          onTheme={setTheme}
          onPrefs={setPrefs}
          onOpen={open}
          onBack={back}
          onDetail={(session) => {
            setScreen({ at: 'detail', session, tab: 'timeline' });
          }}
          onOpenAlert={openAlert}
          onDismissAlerts={() => {
            setAlerts([]);
          }}
        />
      </main>
    </div>
  );
}

/**
 * The current Allowance.
 *
 * When the endpoint cannot be reached the most recent recorded reading is shown
 * with its age, which is still Measured. Only a complete absence of readings
 * shows nothing at all; no figure here is ever inferred.
 */
function Allowance({ usage, rail }: { usage: UsageSample | null; rail: boolean }) {
  if (rail) return null;
  if (!usage) {
    return (
      <div style={{ padding: '0 12px 10px', color: 'var(--faint)', fontSize: 11 }}>Unavailable</div>
    );
  }

  const session = usage.limits.find((l) => l.kind === 'session');
  const weekly = usage.limits.find((l) => l.kind === 'weekly_all');
  /* eslint-disable-next-line react-hooks/purity --
     The age of a reading is only meaningful relative to now, and this re-renders
     whenever a new sample arrives, so reading the clock here is the point. */
  const ageMs = Date.now() - Date.parse(usage.at);
  const stale = ageMs > 10 * 60_000;

  return (
    <div style={{ padding: '0 12px 10px' }}>
      {session && (
        <Meter
          label="5-hour"
          value={session.percent}
          note={
            session.resetsAt
              ? `resets ${new Date(session.resetsAt).toLocaleTimeString()}`
              : undefined
          }
        />
      )}
      {weekly && (
        <Meter
          label="Weekly"
          value={weekly.percent}
          note={
            weekly.resetsAt ? `resets ${new Date(weekly.resetsAt).toLocaleDateString()}` : undefined
          }
        />
      )}
      {stale && (
        <div
          style={{ color: 'var(--faint)', fontSize: 10 }}
          title="The usage endpoint could not be reached, so this is the last reading taken."
        >
          as of {duration(ageMs)} ago
        </div>
      )}
    </div>
  );
}

interface ScreenProps {
  screen: Screen;
  index: IndexResult | null;
  error: string | null;
  usage: UsageSample | null;
  alerts: Alert[];
  prefs: Prefs;
  theme: 'light' | 'dark' | 'system';
  onTheme: (t: 'light' | 'dark' | 'system') => void;
  onPrefs: (p: Prefs) => void;
  onOpen: (s: SessionSummary, tab?: Finding['tab']) => void;
  onBack: () => void;
  onDetail: (detail: SessionDetail) => void;
  onOpenAlert: (alert: Alert) => void;
  onDismissAlerts: () => void;
}

/**
 * Whichever screen is current.
 *
 * Split out of App so the shell keeps to layout and state, and this keeps to
 * one decision. Live and Settings render regardless of the index, because
 * neither needs it — Live follows the running Session, Settings needs nothing.
 */
function CurrentScreen(p: ScreenProps) {
  const { screen, index, error } = p;

  if (screen.at === 'live') {
    return (
      <Live
        alerts={p.alerts}
        onDismissAlerts={p.onDismissAlerts}
        usage={p.usage}
        onOpen={p.onDetail}
        onOpenAlert={p.onOpenAlert}
        collapseAbove={p.prefs.collapseAbove}
      />
    );
  }
  if (screen.at === 'alerts') {
    return <AlertsScreen onOpen={p.onOpenAlert} />;
  }
  if (screen.at === 'settings') {
    return <Settings theme={p.theme} onTheme={p.onTheme} prefs={p.prefs} onPrefs={p.onPrefs} />;
  }

  if (error !== null) return <Empty fill>Could not read transcripts: {error}</Empty>;

  if (screen.at === 'detail') {
    return (
      <Detail
        session={screen.session}
        onBack={p.onBack}
        initialTab={screen.tab}
        {...(screen.eventId !== undefined ? { initialEventId: screen.eventId } : {})}
        collapseAbove={p.prefs.collapseAbove}
      />
    );
  }
  if (screen.at === 'cache') return <Cache />;

  if (!index) return <Empty fill>Reading transcripts…</Empty>;

  const sessions = index.sessions;
  switch (screen.at) {
    case 'sessions':
      return <Sessions sessions={sessions} onOpen={p.onOpen} />;
    case 'search':
      return <Search sessions={sessions} onOpen={p.onOpen} />;
    case 'analytics':
      return <Analytics sessions={sessions} usage={p.usage} onOpen={p.onOpen} />;
    case 'projects':
      return <Projects sessions={sessions} onOpen={p.onOpen} />;
    case 'insights':
      return <Insights sessions={sessions} onOpen={p.onOpen} />;
  }
}
