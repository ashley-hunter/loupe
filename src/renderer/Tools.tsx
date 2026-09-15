import { Clock, Play, Plus, Timer, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { UsageSample } from '../shared/model.js';
import {
  DAYS,
  type ActionKind,
  type AutoAction,
  type CacheClock,
  type RunRecord,
  type StartupCost,
  type ToolsConfig,
  turnsLeft,
  type Threshold,
  type WakeUp,
} from '../shared/tools.js';
import { ICON } from './App.js';
import { duration, model as modelName, percent, tokens } from './format.js';
import { Empty } from './ui/Empty.js';
import { Failed } from './ui/Failed.js';
import { TopBar } from './ui/TopBar.js';
import { useAsync } from './useAsync.js';

/**
 * Tools: the screen where Loupe stops only watching.
 *
 * Everything else in the app reads Transcripts and reports. This runs things -
 * a turn appended to keep a prefix alive, a compaction, a handoff file, a
 * Session started at eight so the five-hour Block begins where you want it.
 *
 * So the screen is built to be distrusted. Every rule states what it will do
 * and when, nothing is on until it is switched on, and the run log at the
 * bottom is the record of what actually happened - including the runs that were
 * declined and why.
 */
export function Tools() {
  const [clocks, setClocks] = useState<CacheClock[]>([]);
  const [config, setConfig] = useState<ToolsConfig | null>(null);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const threshold = useAsync<Threshold>(() => window.loupe.threshold());
  // Seeded at zero rather than from the clock: reading the time during render
  // is impure, and until the first tick the deadline the main process already
  // computed is the right answer anyway.
  const [now, setNow] = useState(0);

  useEffect(() => {
    void window.loupe.cacheClocks().then(setClocks);
    void window.loupe.toolsConfig().then(setConfig);
    void window.loupe.runs().then(setRuns);

    const offClock = window.loupe.onCacheClocks(setClocks);
    const offRun = window.loupe.onRun((record) => {
      setRuns((current) => [record, ...current].slice(0, 200));
    });
    // A deadline is only useful while it is counting. One second is the
    // coarsest tick that still reads as a countdown rather than a stale label.
    const tick = setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => {
      offClock();
      offRun();
      clearInterval(tick);
    };
  }, []);

  const save = useCallback((next: ToolsConfig) => {
    setConfig(next);
    void window.loupe.setToolsConfig(next);
  }, []);

  const runNow = useCallback((kind: ActionKind, sessionId: string) => {
    setBusy(true);
    void window.loupe.runAction(kind, sessionId).finally(() => {
      setBusy(false);
    });
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <TopBar
        title="Tools"
        count={clocks.length > 0 ? clocks.length : undefined}
        note={clocks.length === 0 ? 'nothing running' : undefined}
      />
      <div className="scroll-pane">
        <div className="pane-content" style={{ maxWidth: 820 }}>
          <p
            style={{ color: 'var(--faint)', fontSize: 11.5, margin: '0 0 16px', lineHeight: 1.55 }}
          >
            The rest of Loupe only reads. Everything on this screen writes: a keep-alive appends a
            turn to a session, a compaction replaces its context, a handoff writes a file, a wake-up
            starts a session. Each one is recorded below, whether it worked or not.
          </p>

          <Section label={clocks.length > 1 ? 'Cache deadlines' : 'Cache deadline'}>
            {clocks.length > 0 && (
              <p
                style={{
                  margin: 0,
                  padding: '10px 14px',
                  borderBottom: '1px solid var(--lineSoft)',
                  lineHeight: 1.55,
                  color: 'var(--dim)',
                  maxWidth: 640,
                }}
              >
                A keep-alive re-reads the prefix at a tenth of fresh input; letting it go and
                rebuilding rewrites it at a quarter above. So holding on pays until twelve and a
                half lifetimes have passed - the figure against each session below - and costs more
                than it saves after that.
              </p>
            )}
            {clocks.length === 0 ? (
              <Empty align="left">
                No session is running with a cached prefix worth watching. A countdown appears here
                for each one that builds one.
              </Empty>
            ) : (
              clocks.map((clock, i) => (
                <div
                  key={clock.sessionId}
                  style={i > 0 ? { borderTop: '1px solid var(--lineSoft)' } : undefined}
                >
                  <CacheCard
                    clock={clock}
                    now={now}
                    busy={busy}
                    onRun={runNow}
                    threshold={threshold.status === 'ready' ? threshold.data : null}
                  />
                </div>
              ))
            )}
          </Section>

          {config && (
            <>
              <Section label="Before it expires">
                <Actions config={config} onChange={save} />
              </Section>
              <Section label="Scheduled wake-ups">
                <WakeUps config={config} onChange={save} />
              </Section>
            </>
          )}

          <Section label="What starting a session costs">
            <Startup />
          </Section>

          <Section label="Run log">
            <Runs runs={runs} />
          </Section>
        </div>
      </div>
    </div>
  );
}

/* ---- The deadline ------------------------------------------------------- */

/**
 * The countdown, and the one number that makes it a decision rather than a
 * warning: how long the prefix is worth holding.
 */
function CacheCard({
  clock,
  now,
  busy,
  onRun,
  threshold,
}: {
  clock: CacheClock;
  now: number;
  busy: boolean;
  onRun: (kind: ActionKind, sessionId: string) => void;
  threshold: Threshold | null;
}) {
  const left = now === 0 ? clock.msLeft : Date.parse(clock.expiresAt) - now;
  const gone = left <= 0;
  const share = Math.max(0, Math.min(1, left / clock.ttlMs));
  const colour = gone
    ? 'var(--faint)'
    : share < 0.2
      ? 'var(--err)'
      : share < 0.5
        ? 'var(--warn)'
        : 'var(--accent)';

  return (
    <div style={{ padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, minWidth: 0 }} className="truncate">
          {clock.sessionName}
        </span>
        <span className="mono" style={{ fontSize: 11, color: 'var(--faint)', flex: 'none' }}>
          {clock.project} · {modelName(clock.model)}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 2 }}>
        <span className="mono" style={{ fontSize: 22, color: colour, letterSpacing: '-.02em' }}>
          {gone ? 'expired' : countdown(left)}
        </span>
        <span style={{ fontSize: 12.5, color: 'var(--dim)' }}>
          {tokens(clock.prefix)} cached · {clock.ttlMs >= 3_600_000 ? 'one-hour' : 'five-minute'}{' '}
          cache
        </span>
      </div>

      <div
        style={{ height: 3, background: 'var(--track)', borderRadius: 2, margin: '7px 0 8px' }}
        aria-hidden
      >
        <div
          style={{
            height: '100%',
            width: `${String(share * 100)}%`,
            background: colour,
            borderRadius: 2,
            transition: 'width 1s linear',
          }}
        />
      </div>

      <div className="mono" style={{ fontSize: 11, color: 'var(--faint)', marginBottom: 9 }}>
        {gone ? (
          <>next request rewrites {tokens(clock.prefix)}</>
        ) : (
          <>
            worth holding <span style={{ color: 'var(--dim)' }}>{duration(clock.breakEvenMs)}</span>
          </>
        )}{' '}
        · typical gap {duration(clock.typicalGapMs)} · idle{' '}
        {duration(now === 0 ? 0 : now - Date.parse(clock.lastAt))}
      </div>

      <Room clock={clock} threshold={threshold} />

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {(['keep-alive', 'compact', 'handoff'] as const).map((kind) => (
          <button
            key={kind}
            className="ghost-button"
            disabled={busy}
            onClick={() => {
              onRun(kind, clock.sessionId);
            }}
            title={ACTION_NOTE[kind]}
          >
            <Play {...ICON} aria-hidden />
            {ACTION_LABEL[kind]}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * A deadline counting down. Hours appear only when there are any: a
 * one-hour prefix reads as `1:04:11`, a five-minute one as `4:11`, and
 * `64:11` would read as neither.
 */
/**
 * How much room is left before this Session compacts.
 *
 * The threshold is not written anywhere, so it is taken from the Sessions that
 * have already compacted on this machine - the Request before each one was as
 * large as a context here has ever been allowed to get. Without a compaction on
 * record there is no figure, and none is invented.
 */
function Room({ clock, threshold }: { clock: CacheClock; threshold: Threshold | null }) {
  if (!threshold) return null;

  const left = turnsLeft(clock.prefix, clock.perTurn, threshold.tokens);
  if (left === null) {
    return (
      <div className="mono" style={{ fontSize: 11, color: 'var(--faint)', marginBottom: 9 }}>
        {threshold.tokens === null
          ? 'no compaction on record yet, so there is no measured limit to count down to'
          : 'the context is not growing, so there is nothing to count down'}
      </div>
    );
  }

  const share = Math.max(0, Math.min(1, clock.prefix / (threshold.tokens ?? 1)));
  const tight = left <= 5;

  return (
    <div
      className="mono"
      style={{ fontSize: 11, color: tight ? 'var(--warn)' : 'var(--faint)', marginBottom: 9 }}
    >
      <span style={{ color: tight ? 'var(--warn)' : 'var(--dim)', fontWeight: 600 }}>
        ~{left} {left === 1 ? 'turn' : 'turns'}
      </span>{' '}
      before compaction · {percent(share)} of {tokens(threshold.tokens)}, growing{' '}
      {tokens(clock.perTurn)} a turn
    </div>
  );
}

const countdown = (ms: number): string => {
  const total = Math.floor(ms / 1000);
  const mm = String(Math.floor(total / 60) % 60).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  const hours = Math.floor(total / 3600);
  return hours > 0 ? `${String(hours)}:${mm}:${ss}` : `${String(Math.floor(total / 60))}:${ss}`;
};

const ACTION_LABEL: Record<ActionKind, string> = {
  'keep-alive': 'Keep alive',
  compact: 'Compact',
  handoff: 'Write handoff',
};

const ACTION_NOTE: Record<ActionKind, string> = {
  'keep-alive': 'Appends one short turn, which re-reads the prefix and resets its lifetime',
  compact: 'Runs /compact, which replaces the context with a summary of it',
  handoff: 'Writes HANDOFF.md in the session working directory, then stops',
};

/* ---- Auto-actions ------------------------------------------------------- */

const newId = (): string => Math.random().toString(36).slice(2, 9);

/** Standing rules that fire against the running Session before its prefix goes. */
function Actions({
  config,
  onChange,
}: {
  config: ToolsConfig;
  onChange: (c: ToolsConfig) => void;
}) {
  const set = (actions: AutoAction[]): void => {
    onChange({ ...config, actions });
  };

  const add = (kind: ActionKind): void => {
    set([
      ...config.actions,
      {
        id: newId(),
        kind,
        enabled: false,
        leadSeconds: 60,
        // Below this a rebuild is not worth a turn of its own.
        minPrefix: 50_000,
        project: '',
      },
    ]);
  };

  return (
    <>
      {config.actions.length === 0 && (
        <div style={{ padding: '12px 14px', color: 'var(--faint)', lineHeight: 1.55 }}>
          Nothing runs on its own. Add a rule to have one of the actions above fire by itself when
          the countdown gets close.
        </div>
      )}

      {config.actions.map((action) => (
        <div key={action.id} className="group-row" style={{ padding: '10px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Switch
              on={action.enabled}
              onChange={(enabled) => {
                set(config.actions.map((a) => (a.id === action.id ? { ...a, enabled } : a)));
              }}
            />
            <span style={{ fontSize: 12.5, flex: 1 }}>{ACTION_LABEL[action.kind]}</span>
            <IconButton
              label="Remove this rule"
              onClick={() => {
                set(config.actions.filter((a) => a.id !== action.id));
              }}
            >
              <Trash2 {...ICON} aria-hidden />
            </IconButton>
          </div>

          <div
            style={{
              display: 'flex',
              gap: 8,
              flexWrap: 'wrap',
              alignItems: 'center',
              marginTop: 8,
              paddingLeft: 40,
            }}
          >
            <Field label="Fire">
              <Num
                value={action.leadSeconds}
                suffix="s before"
                onChange={(leadSeconds) => {
                  set(config.actions.map((a) => (a.id === action.id ? { ...a, leadSeconds } : a)));
                }}
              />
            </Field>
            <Field label="Only above">
              <Num
                value={action.minPrefix}
                suffix="tokens"
                step={10_000}
                onChange={(minPrefix) => {
                  set(config.actions.map((a) => (a.id === action.id ? { ...a, minPrefix } : a)));
                }}
              />
            </Field>
            <Field label="Project">
              <Text
                value={action.project}
                placeholder="any"
                onChange={(project) => {
                  set(config.actions.map((a) => (a.id === action.id ? { ...a, project } : a)));
                }}
              />
            </Field>
          </div>

          <p
            style={{
              margin: '8px 0 0 40px',
              fontSize: 11,
              color: 'var(--faint)',
              lineHeight: 1.5,
              maxWidth: 560,
            }}
          >
            {ACTION_NOTE[action.kind]}.
            {action.kind === 'keep-alive' &&
              ' Stops by itself once holding on has cost more than one rebuild would have, and stops immediately when you come back to the session.'}
          </p>
        </div>
      ))}

      <div
        style={{
          display: 'flex',
          gap: 6,
          padding: '10px 14px',
          borderTop: '1px solid var(--lineSoft)',
        }}
      >
        {(['keep-alive', 'compact', 'handoff'] as const).map((kind) => (
          <button
            key={kind}
            className="ghost-button"
            onClick={() => {
              add(kind);
            }}
          >
            <Plus {...ICON} aria-hidden />
            {ACTION_LABEL[kind]}
          </button>
        ))}
      </div>
    </>
  );
}

/* ---- Wake-ups ----------------------------------------------------------- */

/**
 * Sessions started at a chosen time.
 *
 * The Block starts at its first Request and runs five hours from there, so the
 * reset is shown beside the schedule: a wake-up that fires before the current
 * Block has reset spends the tail of it rather than starting a new one, which
 * is the one mistake this feature exists to avoid.
 */
function WakeUps({
  config,
  onChange,
}: {
  config: ToolsConfig;
  onChange: (c: ToolsConfig) => void;
}) {
  const usage = useAsync<UsageSample | null>(() => window.loupe.usage());
  const resetsAt =
    usage.status === 'ready'
      ? (usage.data?.limits.find((l) => l.kind === 'session')?.resetsAt ?? null)
      : null;

  const set = (wakeUps: WakeUp[]): void => {
    onChange({ ...config, wakeUps });
  };
  const update = (id: string, patch: Partial<WakeUp>): void => {
    set(config.wakeUps.map((w) => (w.id === id ? { ...w, ...patch } : w)));
  };

  return (
    <>
      {config.wakeUps.length === 0 && (
        <div style={{ padding: '12px 14px', color: 'var(--faint)', lineHeight: 1.55 }}>
          The five-hour block starts at its first request, so an early question puts the boundary
          where you did not choose it. A wake-up puts it where you did.
        </div>
      )}

      {config.wakeUps.map((wake) => (
        <div key={wake.id} className="group-row" style={{ padding: '10px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Switch
              on={wake.enabled}
              onChange={(enabled) => {
                update(wake.id, { enabled });
              }}
            />
            <input
              className="mono field"
              type="time"
              value={wake.at}
              style={{ width: 86 }}
              onChange={(e) => {
                update(wake.id, { at: e.target.value });
              }}
            />
            <div style={{ display: 'flex', gap: 2, flex: 1 }}>
              {DAYS.map((day, i) => (
                <button
                  key={day}
                  className="daybox"
                  aria-pressed={wake.days.includes(i)}
                  title={day}
                  onClick={() => {
                    update(wake.id, {
                      days: wake.days.includes(i)
                        ? wake.days.filter((d) => d !== i)
                        : [...wake.days, i].sort((a, b) => a - b),
                    });
                  }}
                >
                  {day.charAt(0)}
                </button>
              ))}
            </div>
            <IconButton
              label="Remove this wake-up"
              onClick={() => {
                set(config.wakeUps.filter((w) => w.id !== wake.id));
              }}
            >
              <Trash2 {...ICON} aria-hidden />
            </IconButton>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8, paddingLeft: 40 }}>
            <Field label="In">
              <Text
                value={wake.cwd}
                placeholder="/Users/you/Projects/thing"
                wide
                onChange={(cwd) => {
                  update(wake.id, { cwd });
                }}
              />
            </Field>
            <Field label="Prompt">
              <Text
                value={wake.prompt}
                placeholder="ok"
                onChange={(prompt) => {
                  update(wake.id, { prompt });
                }}
              />
            </Field>
          </div>

          {collision(wake, resetsAt) && (
            <p
              style={{
                margin: '8px 0 0 40px',
                fontSize: 11,
                color: 'var(--warn)',
                lineHeight: 1.5,
              }}
            >
              The current block does not reset until {timeOf(resetsAt)}. Firing at {wake.at} today
              would spend what is left of it rather than starting a new one.
            </p>
          )}
        </div>
      ))}

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 14px',
          borderTop: '1px solid var(--lineSoft)',
        }}
      >
        <button
          className="ghost-button"
          onClick={() => {
            set([
              ...config.wakeUps,
              {
                id: newId(),
                enabled: false,
                at: '08:00',
                days: [1, 2, 3, 4, 5],
                cwd: '',
                prompt: 'ok',
              },
            ]);
          }}
        >
          <Plus {...ICON} aria-hidden />
          Add a wake-up
        </button>
        <span className="mono" style={{ fontSize: 11, color: 'var(--faint)' }}>
          {resetsAt ? `block resets ${timeOf(resetsAt)}` : 'block reset unknown'}
        </span>
      </div>
    </>
  );
}

/** True when this wake-up would fire inside the Block that is already running. */
function collision(wake: WakeUp, resetsAt: string | null): boolean {
  if (!wake.enabled || resetsAt === null) return false;
  const reset = new Date(resetsAt);
  if (Number.isNaN(reset.getTime())) return false;

  const [h, m] = wake.at.split(':').map(Number);
  if (h === undefined || m === undefined) return false;
  const due = new Date();
  due.setHours(h, m, 0, 0);
  return due.getTime() > Date.now() && due.getTime() < reset.getTime();
}

const timeOf = (iso: string | null): string =>
  iso === null
    ? '-'
    : new Date(iso).toLocaleTimeString(undefined, {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
      });

/* ---- Startup cost ------------------------------------------------------- */

/** What each project pays before any work happens. */
function Startup() {
  const state = useAsync<StartupCost[]>(() => window.loupe.startup());

  if (state.status === 'loading') return <Empty align="left">Reading first requests…</Empty>;
  if (state.status === 'failed')
    return <Failed what="measure session startup" error={state.error} />;
  if (state.data.length === 0) {
    return <Empty align="left">No project has enough sessions to measure a typical start.</Empty>;
  }

  return (
    <>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--lineSoft)' }}>
        <p style={{ margin: 0, lineHeight: 1.55, color: 'var(--dim)', maxWidth: 620 }}>
          The first request of a session already carries the system prompt, every tool definition,
          each configured MCP server's schema, the skill listing and CLAUDE.md. A transcript never
          itemises those, so this is the total and never a split per server - the figure is real,
          the attribution would be invented. It is the one cost here that a configuration change
          fixes permanently.
        </p>
      </div>
      {state.data.slice(0, 12).map((s) => (
        <div
          key={s.project}
          className="group-row"
          style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 14px' }}
        >
          <span style={{ flex: 1, minWidth: 0, fontSize: 12.5 }} className="truncate">
            {s.project}
          </span>
          <span
            className="mono"
            style={{ fontSize: 11.5, color: 'var(--fg)', width: 72, textAlign: 'right' }}
          >
            {tokens(s.median)}
          </span>
          <span
            className="mono"
            style={{ fontSize: 11, color: 'var(--faint)', width: 150, textAlign: 'right' }}
          >
            {s.sessions} sessions · {tokens(s.total)} written
          </span>
        </div>
      ))}
    </>
  );
}

/* ---- Run log ------------------------------------------------------------ */

/** What actually ran, including what was declined. */
function Runs({ runs }: { runs: RunRecord[] }) {
  if (runs.length === 0) {
    return (
      <div style={{ padding: '12px 14px', color: 'var(--faint)', lineHeight: 1.55 }}>
        Nothing has been run. Anything Loupe does on your behalf is listed here, with what the
        command itself said.
      </div>
    );
  }

  return (
    <>
      {runs.slice(0, 40).map((run) => (
        <div key={run.id} className="group-row" style={{ padding: '8px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {run.kind === 'wake-up' ? (
              <Clock {...ICON} style={{ color: 'var(--faint)', flex: 'none' }} aria-hidden />
            ) : (
              <Timer {...ICON} style={{ color: 'var(--faint)', flex: 'none' }} aria-hidden />
            )}
            <span style={{ fontSize: 12.5, flex: 1, minWidth: 0 }} className="truncate">
              {run.kind === 'wake-up' ? 'Wake-up' : ACTION_LABEL[run.kind]} · {run.label}
            </span>
            <span
              className="mono"
              style={{ fontSize: 11, color: run.ok ? 'var(--faint)' : 'var(--warn)', flex: 'none' }}
            >
              {run.ok ? 'ran' : 'no'}
            </span>
            <span className="mono" style={{ fontSize: 11, color: 'var(--faint)', flex: 'none' }}>
              {timeOf(run.at)}
            </span>
          </div>
          <div
            className="mono"
            style={{ fontSize: 11, color: 'var(--faint)', marginTop: 2, lineHeight: 1.5 }}
          >
            {run.detail}
            {run.prefix !== undefined && ` · ${tokens(run.prefix)} held`}
          </div>
        </div>
      ))}
    </>
  );
}

/* ---- Small pieces ------------------------------------------------------- */

const Section = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <section style={{ marginBottom: 22 }}>
    <div className="eyebrow" style={{ marginBottom: 6 }}>
      {label}
    </div>
    <div style={{ border: '1px solid var(--line)', borderRadius: 8, background: 'var(--panel)' }}>
      {children}
    </div>
  </section>
);

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label
    style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--faint)' }}
  >
    {label}
    {children}
  </label>
);

const Text = ({
  value,
  placeholder,
  wide,
  onChange,
}: {
  value: string;
  placeholder: string;
  wide?: boolean;
  onChange: (v: string) => void;
}) => (
  <input
    className="field mono"
    value={value}
    placeholder={placeholder}
    style={{ width: wide === true ? 260 : 110 }}
    onChange={(e) => {
      onChange(e.target.value);
    }}
  />
);

const Num = ({
  value,
  suffix,
  step = 10,
  onChange,
}: {
  value: number;
  suffix: string;
  step?: number;
  onChange: (v: number) => void;
}) => (
  <>
    <input
      className="field mono"
      type="number"
      min={0}
      step={step}
      value={value}
      style={{ width: 78 }}
      onChange={(e) => {
        const next = globalThis.Number(e.target.value);
        if (!globalThis.Number.isNaN(next)) onChange(Math.max(0, next));
      }}
    />
    {suffix}
  </>
);

/**
 * On or off, with the state said in words as well as shown.
 *
 * These switch on things that write to your sessions unattended, so which way
 * round it is has to be readable at a glance and to a screen reader.
 */
const Switch = ({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) => (
  <button
    role="switch"
    aria-checked={on}
    aria-label={on ? 'On' : 'Off'}
    className="switch"
    onClick={() => {
      onChange(!on);
    }}
  >
    <span className="knob" />
  </button>
);

const IconButton = ({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <button
    className="ghost-button"
    aria-label={label}
    title={label}
    onClick={onClick}
    style={{ padding: '0 6px' }}
  >
    {children}
  </button>
);
