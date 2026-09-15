import { useMemo } from 'react';
import { newTokens, type SessionSummary, type UsageSample } from '../shared/model.js';
import { byDay, byModel, type DayRollup } from '../shared/rollup.js';
import { Panel } from './charts/Panel.js';
import { RankedBars } from './charts/RankedBars.js';
import { Empty } from './ui/Empty.js';
import { TopBar } from './ui/TopBar.js';
import { BLANK, duration, model as modelName, tokens } from './format.js';

/**
 * Whether it is getting better.
 *
 * This screen exists for the questions a single conversation structurally
 * cannot answer, and it earns its place by one rule: every chart is a way into
 * Conversations, not a destination. Click a day and the list narrows to it.
 * The first chart here that cannot be clicked through is the sign this has
 * drifted back into decoration.
 */

const DAYS = 21;

/** Shades keyed to the model family, in a fixed order. */
const MODEL_TONE: Record<string, string> = {
  opus: 'var(--accent)',
  fable: 'var(--blue)',
  sonnet: 'var(--dim)',
  haiku: 'var(--faint)',
};

/** "1 conversation", "3 conversations". Cheap, and the alternative reads as a bug. */
const plural = (n: number, word: string): string => `${String(n)} ${word}${n === 1 ? '' : 's'}`;

const toneFor = (id: string): string => {
  const family = /^claude-([a-z]+)/.exec(id)?.[1] ?? '';
  return MODEL_TONE[family] ?? 'var(--faint)';
};

export function Analytics({
  sessions,
  usage,
  onFilter,
}: {
  sessions: SessionSummary[];
  usage: UsageSample | null;
  /** Narrow the Conversations list and go there. What makes a chart a door. */
  onFilter: (query: string) => void;
}) {
  const days = useMemo(() => byDay(sessions, DAYS), [sessions]);
  const models = useMemo(() => byModel(sessions), [sessions]);

  const typical = useMemo(() => {
    const costs = sessions.map((s) => newTokens(s.usage)).sort((a, b) => a - b);
    // Spread over an empty array is Infinity, which reached the page as
    // "sessions here run from InfinityM to -Infinity".
    const smallest = costs[0] ?? 0;
    const largest = costs.at(-1) ?? 0;
    const turns = sessions.map((s) => s.prompts).sort((a, b) => a - b);
    const active = sessions.map((s) => s.activeMs).sort((a, b) => a - b);
    return {
      cost: costs[Math.floor(costs.length / 2)] ?? 0,
      turns: turns[Math.floor(turns.length / 2)] ?? 0,
      active: active[Math.floor(active.length / 2)] ?? 0,
      smallest,
      largest,
    };
  }, [sessions]);

  const weekly = usage?.limits.find((l) => l.kind === 'weekly_all');
  const worked = days.filter((d) => d.sessions > 0);

  if (sessions.length === 0) {
    return (
      <div className="screen">
        <TopBar title="Analytics" />
        <Empty align="left">
          Nothing to chart yet. This screen answers the questions a single conversation cannot -
          whether it is getting better, whether you will run out, and what is normal for you - and
          all three need a few conversations first.
        </Empty>
      </div>
    );
  }

  return (
    <div className="screen">
      <TopBar title="Analytics" note={`${String(DAYS)} days`} />

      <div className="scroll-pane">
        <div className="pane-content" style={{ maxWidth: 1000 }}>
          <Panel title="Where it went" note="click a day to see the conversations in it">
            <p className="chart-lede">
              Cache writes are the bulk of everything spent. A day that is mostly warm colour is a
              day spent growing and rebuilding contexts rather than getting answers.
            </p>
            <Stacked days={days} onFilter={onFilter} />
          </Panel>

          <div className="panel-pair">
            <Panel title="Typical conversation" note="median, not mean">
              <p className="chart-lede">
                The yardstick every conversation in the list is read against. Medians, because
                sessions here run from{' '}
                {tokens(Math.min(...sessions.map((s) => newTokens(s.usage))))} to{' '}
                {tokens(Math.max(...sessions.map((s) => newTokens(s.usage))))} and a mean would
                describe the outlier.
              </p>
              <dl className="facts">
                <Fact label="New tokens" value={tokens(typical.cost)} />
                <Fact label="Prompts" value={String(typical.turns)} />
                <Fact label="Active" value={duration(typical.active)} />
                <Fact label="Conversations" value={String(sessions.length)} />
              </dl>
            </Panel>

            <Panel title="Allowance" note="measured, never estimated">
              <p className="chart-lede">
                {weekly
                  ? `${String(weekly.percent)}% of the week is gone${
                      weekly.resetsAt
                        ? `, resetting ${new Date(weekly.resetsAt).toLocaleDateString(undefined, {
                            weekday: 'long',
                          })}`
                        : ''
                    }.`
                  : 'No reading yet. Allowance is read from the usage endpoint, never estimated.'}
              </p>
              <dl className="facts">
                {(usage?.limits ?? []).map((l) => (
                  <Fact
                    key={`${l.kind}${l.model ?? ''}`}
                    label={
                      l.kind === 'session'
                        ? '5-hour block'
                        : l.kind === 'weekly_all'
                          ? 'Weekly'
                          : `Weekly · ${modelName(l.model ?? '')}`
                    }
                    value={`${String(l.percent)}%`}
                    meter={l.percent}
                  />
                ))}
                {(usage?.limits ?? []).length === 0 && <Fact label="Allowance" value={BLANK} />}
              </dl>
            </Panel>
          </div>

          <Panel title="Which projects" note="click one to filter the conversations">
            <RankedBars
              onSelect={onFilter}
              rows={ranked(projects(sessions), (p) => ({
                key: p.name,
                label: p.name,
                raw: p.cost,
                meta: plural(p.sessions, 'conversation'),
              }))}
            />
          </Panel>

          <Panel title="Which models" note="share of new tokens">
            <RankedBars
              rows={ranked(models.slice(0, 6), (m) => ({
                key: m.model,
                label: modelName(m.model),
                raw: m.newTokens,
                meta: plural(m.sessions, 'conversation'),
                tone: toneFor(m.model),
              }))}
            />
          </Panel>

          <p className="chart-foot">
            Cache reads are excluded from every figure here. Each request re-reads the whole prefix,
            so counting them sums the same tokens once per request and swamps everything true beside
            it. {worked.length} of the last {DAYS} days had work in them.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ---- The stacked day chart ---------------------------------------------- */

/**
 * Each day as what it was spent on, drawn to one scale.
 *
 * Stacked rather than a single total, because the total was the number the app
 * already had and it never answered anything. The composition is the finding.
 */
function Stacked({ days, onFilter }: { days: DayRollup[]; onFilter: (q: string) => void }) {
  const peak = Math.max(1, ...days.map((d) => d.newTokens + d.delegated));

  return (
    <div className="stacked">
      {days.map((d) => {
        const total = d.newTokens + d.delegated;
        const label = new Date(`${d.day}T12:00:00`);
        return (
          <button
            key={d.day}
            className="stacked-day"
            disabled={d.sessions === 0}
            onClick={() => {
              onFilter(d.day);
            }}
            title={
              d.sessions === 0
                ? `${d.day}: nothing`
                : `${d.day}: ${tokens(total)} across ${plural(d.sessions, 'conversation')}`
            }
          >
            <span className="stacked-col" style={{ height: `${String((total / peak) * 100)}%` }}>
              <span
                className="seg"
                style={{
                  height: `${String((d.delegated / Math.max(total, 1)) * 100)}%`,
                  background: 'var(--blue)',
                }}
              />
              <span
                className="seg"
                style={{
                  height: `${String((d.usage.output / Math.max(total, 1)) * 100)}%`,
                  background: 'var(--accent)',
                }}
              />
              <span
                className="seg"
                style={{
                  height: `${String((d.usage.cacheWrite / Math.max(total, 1)) * 100)}%`,
                  background: 'var(--warn)',
                }}
              />
            </span>
            <span className="stacked-tick mono">
              {label.toLocaleDateString(undefined, { day: 'numeric' })}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ---- Small pieces ------------------------------------------------------- */

function Fact({ label, value, meter }: { label: string; value: string; meter?: number }) {
  return (
    <div className="fact">
      <dt>{label}</dt>
      <dd className="mono">{value}</dd>
      {meter !== undefined && (
        <span className="fact-meter" aria-hidden>
          <span
            style={{
              width: `${String(Math.min(100, meter))}%`,
              background:
                meter >= 80 ? 'var(--err)' : meter >= 50 ? 'var(--warn)' : 'var(--accent)',
            }}
          />
        </span>
      )}
    </div>
  );
}

/**
 * Rows in the shape RankedBars wants: a formatted value and a fraction of the
 * largest, worked out once here rather than at each call site.
 */
function ranked<T>(
  items: T[],
  shape: (item: T) => { key: string; label: string; raw: number; meta?: string; tone?: string },
): Array<{
  key: string;
  label: string;
  value: string;
  fraction: number;
  meta?: string;
  tone?: string;
}> {
  const rows = items.map(shape);
  const peak = Math.max(1, ...rows.map((r) => r.raw));
  return rows.map((r) => ({
    key: r.key,
    label: r.label,
    value: tokens(r.raw),
    fraction: r.raw / peak,
    ...(r.meta === undefined ? {} : { meta: r.meta }),
    ...(r.tone === undefined ? {} : { tone: r.tone }),
  }));
}

/** New tokens per project, largest first. */
function projects(
  sessions: SessionSummary[],
): Array<{ name: string; cost: number; sessions: number }> {
  const by = new Map<string, { cost: number; sessions: number }>();
  for (const s of sessions) {
    const at = by.get(s.repo) ?? { cost: 0, sessions: 0 };
    at.cost += newTokens(s.usage) + newTokens(s.subagentUsage);
    at.sessions++;
    by.set(s.repo, at);
  }
  return [...by.entries()]
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 7);
}
