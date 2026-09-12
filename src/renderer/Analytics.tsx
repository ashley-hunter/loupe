import { useMemo } from 'react';
import { cacheHitRate, newTokens, type SessionSummary, type UsageSample } from '../shared/model.js';
import { byDay, byModel } from '../shared/rollup.js';
import { Axis } from './charts/Axis.js';
import { BarChart } from './charts/BarChart.js';
import { LineChart } from './charts/LineChart.js';
import { Panel } from './charts/Panel.js';
import { RankedBars } from './charts/RankedBars.js';
import { Stat } from './ui/Stat.js';
import { TopBar } from './ui/TopBar.js';
import { BLANK, duration, model as modelName, percent, tokens } from './format.js';

/**
 * Shades keyed to the model family, in a fixed order.
 *
 * Keyed to what the row *is*, never to where it ranks — otherwise re-sorting or
 * filtering repaints the survivors and the colours stop meaning anything.
 */
const MODEL_TONE: Record<string, string> = {
  opus: 'var(--accent)',
  fable: 'var(--blue)',
  sonnet: 'var(--dim)',
  haiku: 'var(--faint)',
};

const toneFor = (id: string): string => {
  const family = /^claude-([a-z]+)/.exec(id)?.[1] ?? '';
  return MODEL_TONE[family] ?? 'var(--faint)';
};

export function Analytics({
  sessions,
  usage,
  onOpen,
}: {
  sessions: SessionSummary[];
  usage: UsageSample | null;
  onOpen: (s: SessionSummary) => void;
}) {
  const days = useMemo(() => byDay(sessions, 14), [sessions]);
  const models = useMemo(() => byModel(sessions), [sessions]);

  const total = sessions.reduce((n, s) => n + newTokens(s.usage), 0);
  const active = sessions.reduce((n, s) => n + s.activeMs, 0);
  const measured = sessions.filter((s) => s.allowance !== null);

  const overall = sessions.reduce(
    (u, s) => ({
      ...u,
      cacheRead: u.cacheRead + s.usage.cacheRead,
      cacheWrite: u.cacheWrite + s.usage.cacheWrite,
      input: u.input + s.usage.input,
    }),
    { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, thinking: 0 },
  );

  const peakDay = days.reduce((a, b) => (b.newTokens > a.newTokens ? b : a), days[0]!);
  const topSessions = [...sessions]
    .sort((a, b) => newTokens(b.usage) - newTokens(a.usage))
    .slice(0, 6);
  const biggest = newTokens(topSessions[0]?.usage ?? overall) || 1;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <TopBar title="Analytics" note="all time" />

      <div className="scroll-pane">
        <div className="pane-content">
          <div style={{ display: 'flex', gap: 30, flexWrap: 'wrap', marginBottom: 18 }}>
            <Stat size="lg" label="New tokens" value={tokens(total)} note="excludes cache reads" />
            <Stat size="lg" label="Sessions" value={String(sessions.length)} />
            <Stat
              size="lg"
              label="Active"
              value={duration(active)}
              note="gaps over 5 min excluded"
            />
            <Stat size="lg" label="Cache hit" value={percent(cacheHitRate(overall))} />
            <Stat
              label="5-hour allowance"
              value={
                usage ? `${usage.limits.find((l) => l.kind === 'session')?.percent ?? 0}%` : BLANK
              }
              note="now"
            />
          </div>

          <Panel title="New tokens" note="14 days">
            <BarChart
              label="New tokens per day over the last fourteen days"
              data={days.map((d) => ({
                key: d.day,
                value: d.sessions === 0 ? null : d.newTokens,
                tip:
                  d.sessions === 0
                    ? `${d.day} · nothing recorded`
                    : `${d.day} · ${tokens(d.newTokens)} across ${d.sessions} session${d.sessions === 1 ? '' : 's'}`,
              }))}
            />
            <Axis from={days[0]?.day ?? ''} to={days.at(-1)?.day ?? ''} />
            <div style={{ color: 'var(--faint)', fontSize: 11, marginTop: 7 }}>
              Busiest day {peakDay.day} at {tokens(peakDay.newTokens)}. Days with no sessions are
              drawn as gaps, not zeroes.
            </div>
          </Panel>

          <Panel title="Cache hit" note="14 days">
            <LineChart
              label="Cache hit rate per day over the last fourteen days"
              data={days.map((d) => ({
                key: d.day,
                value: d.cacheHit === null ? null : Math.round(d.cacheHit * 100),
                tip:
                  d.cacheHit === null
                    ? `${d.day} · nothing recorded`
                    : `${d.day} · ${percent(d.cacheHit)}`,
              }))}
            />
            <Axis from={days[0]?.day ?? ''} to={days.at(-1)?.day ?? ''} />
            <div style={{ color: 'var(--faint)', fontSize: 11, marginTop: 7 }}>
              The scale covers only the range actually reached, so small movements are visible. A
              break in the line is a day with no sessions.
            </div>
          </Panel>

          <Panel
            title="Allowance"
            note={`${measured.length} of ${sessions.length} sessions measured`}
          >
            {measured.length === 0 ? (
              <p style={{ margin: 0, color: 'var(--dim)', lineHeight: 1.55, maxWidth: 560 }}>
                Nothing yet. Allowance is read from Anthropic's usage endpoint and only exists for
                sessions that ran while this app was installed — it is never reconstructed for older
                ones. This fills in as you work.
              </p>
            ) : (
              <RankedBars
                rows={measured.slice(0, 8).map((s) => ({
                  key: s.id,
                  label: s.name,
                  meta: s.project,
                  value: `${s.allowance}%`,
                  fraction: (s.allowance ?? 0) / 100,
                }))}
                onSelect={(id) => {
                  const s = sessions.find((x) => x.id === id);
                  if (s) onOpen(s);
                }}
              />
            )}
          </Panel>

          <Panel title="Models" note="share of new tokens">
            <RankedBars
              rows={models.map((m) => ({
                key: m.model,
                label: modelName(m.model),
                meta: `${m.sessions} session${m.sessions === 1 ? '' : 's'}`,
                value: tokens(m.newTokens),
                fraction: m.share,
                tone: toneFor(m.model),
              }))}
            />
          </Panel>

          <Panel title="Heaviest sessions" note="by new tokens">
            <RankedBars
              rows={topSessions.map((s) => ({
                key: s.id,
                label: s.name,
                meta: s.project,
                value: tokens(newTokens(s.usage)),
                fraction: newTokens(s.usage) / biggest,
              }))}
              onSelect={(id) => {
                const s = sessions.find((x) => x.id === id);
                if (s) onOpen(s);
              }}
            />
          </Panel>
        </div>
      </div>
    </div>
  );
}
