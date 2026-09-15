import {
  ChartColumn,
  Lightbulb,
  MessagesSquare,
  Wrench,
  SlidersVertical,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { IndexResult } from '../main/catalogue.js';
import type { Alert, SessionDetail, SessionSummary, UsageSample } from '../shared/model.js';
import { Detail } from './Detail.js';
import { Analytics } from './Analytics.js';
import { Improve } from './Improve.js';
import { Conversations } from './Conversations.js';
import { Palette } from './Palette.js';
import { Settings } from './Settings.js';
import { Tools } from './Tools.js';
import { duration } from './format.js';
import type { Prefs } from '../shared/prefs.js';
import iconUrl from './icon.png';
import { loadPrefs, savePrefs } from './prefs.js';
import { Empty } from './ui/Empty.js';
import { Meter } from './ui/Meter.js';
import { Tooltip } from './ui/Tooltip.js';
import { TopBar } from './ui/TopBar.js';
import { useWidth } from './useWidth.js';

type Screen =
  | { at: 'conversations' }
  | { at: 'analytics' }
  | { at: 'improve' }
  | { at: 'tools' }
  | { at: 'settings' }
  | { at: 'detail'; session: SessionDetail; eventId?: string };

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
  { id: 'conversations', label: 'Conversations', icon: MessagesSquare, ready: true },
  { id: 'analytics', label: 'Analytics', icon: ChartColumn, ready: true },
  { id: 'improve', label: 'Improve', icon: Lightbulb, ready: true },
  { id: 'tools', label: 'Tools', icon: Wrench, ready: true },
  { id: 'settings', label: 'Settings', icon: SlidersVertical, ready: true },
];

/**
 * The number beside a nav item: unread alerts if there are any, otherwise what
 * is running, otherwise how many conversations there are. Undefined means no
 * badge at all.
 */
function badgeFor(
  id: string,
  sessions: SessionSummary[] | undefined,
  alerts: number,
): number | undefined {
  if (id !== 'conversations') return undefined;
  // What is running beats how many exist: a count that never changes is not
  // worth the ink, and a running conversation is the reason to look.
  if (alerts > 0) return alerts;
  const running = sessions?.filter((s) => s.status === 'active').length ?? 0;
  return running > 0 ? running : sessions?.length;
}

/** Which screen each nav id opens. A lookup rather than a ternary chain. */
const SCREEN_FOR: Record<string, Screen> = {
  conversations: { at: 'conversations' },
  analytics: { at: 'analytics' },
  improve: { at: 'improve' },
  tools: { at: 'tools' },
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

/** The bar title for each screen, so it can be drawn before the data arrives. */
const TITLE_FOR: Record<string, string> = Object.fromEntries(NAV.map((n) => [n.id, n.label]));

/** The design's icon size and weight, used everywhere an icon appears. */
export const ICON = { size: 15, strokeWidth: 1.7 } as const;

export function App() {
  const [index, setIndex] = useState<IndexResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>({ at: 'conversations' });
  /**
   * What the Conversations list is narrowed to.
   *
   * Held here rather than inside the list because Analytics sets it: clicking a
   * project on a chart narrows this and moves you there, which is what makes a
   * chart a door rather than a picture.
   */
  const [filter, setFilter] = useState('');
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
        setScreen({ at: 'conversations' });
        document.getElementById('conversation-filter')?.focus();
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

  const open = useCallback((s: SessionSummary, eventId?: string) => {
    void window.loupe.session(s.path).then((detail) => {
      if (!detail) return;
      setScreen({
        at: 'detail',
        session: detail,
        ...(eventId === undefined ? {} : { eventId }),
      });
    });
  }, []);

  /** Land on the evidence for an Alert: its conversation, at its moment. */
  const openAlert = useCallback((alert: Alert) => {
    void window.loupe.session(alert.sessionPath).then((detail) => {
      if (!detail) return;
      setScreen({
        at: 'detail',
        session: detail,
        ...(alert.eventId !== undefined ? { eventId: alert.eventId } : {}),
      });
    });
  }, []);

  /** A chart handing its selection to the list, and taking you with it. */
  const narrow = useCallback((query: string) => {
    setFilter(query);
    setScreen({ at: 'conversations' });
  }, []);

  // Preferences are changed from more than one place now, so saving belongs
  // here rather than at each call site.
  const changePrefs = useCallback((next: Prefs) => {
    savePrefs(next);
    setPrefs(next);
  }, []);

  const back = useCallback(() => {
    setScreen({ at: 'conversations' });
  }, []);

  // Clicking the native notification lands on that Alert's evidence.
  useEffect(() => window.loupe.onOpenAlert(openAlert), [openAlert]);

  // An expiry warning has no Event to land on - it is about something that has
  // not happened yet - so it opens the countdown itself.
  useEffect(
    () =>
      window.loupe.onOpenTools(() => {
        setScreen({ at: 'tools' });
      }),
    [],
  );

  const go = useCallback((id: string) => {
    setScreen(SCREEN_FOR[id] ?? { at: 'conversations' });
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
                      color:
                        n.id === 'conversations' && alerts.length > 0
                          ? 'var(--err)'
                          : 'var(--faint)',
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
          onPrefs={changePrefs}
          onOpen={open}
          onBack={back}
          onDetail={(session) => {
            setScreen({ at: 'detail', session });
          }}
          onOpenAlert={openAlert}
          filter={filter}
          onFilter={setFilter}
          onNarrow={narrow}
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
  onOpen: (s: SessionSummary, eventId?: string) => void;
  onBack: () => void;
  onDetail: (detail: SessionDetail) => void;
  onOpenAlert: (alert: Alert) => void;
  onDismissAlerts: () => void;
  /** What the Conversations list is narrowed to, and how to change it. */
  filter: string;
  onFilter: (next: string) => void;
  /** Narrow the list and go there, which is how a chart becomes a door. */
  onNarrow: (query: string) => void;
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

  if (screen.at === 'tools') {
    return <Tools />;
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
        {...(screen.eventId !== undefined ? { initialEventId: screen.eventId } : {})}
        collapseAbove={p.prefs.collapseAbove}
      />
    );
  }

  // The screen's own bar is drawn while the Transcripts are still being read.
  // Waiting for the parse to show it made the window look like it had not
  // finished launching, and took the title and the drag handle with it.
  if (!index) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
        <TopBar title={TITLE_FOR[screen.at] ?? 'Loupe'} />
        <Empty fill>Reading transcripts…</Empty>
      </div>
    );
  }

  const sessions = index.sessions;
  switch (screen.at) {
    case 'conversations':
      return (
        <Conversations
          sessions={sessions}
          onOpen={p.onOpen}
          filter={p.filter}
          onFilter={p.onFilter}
          alerts={p.alerts}
          onOpenAlert={p.onOpenAlert}
          onDismissAlerts={p.onDismissAlerts}
        />
      );
    case 'analytics':
      return <Analytics sessions={sessions} usage={p.usage} onFilter={p.onNarrow} />;
    case 'improve':
      return <Improve sessions={sessions} onOpen={p.onOpen} />;
  }
}
