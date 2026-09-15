import { Fragment, useMemo, useState } from 'react';
import {
  cacheHitRate,
  newTokens,
  totalNewTokens,
  type SessionStatus,
  type SessionSummary,
} from '../shared/model.js';
import { groupBy } from '../shared/group.js';
import { rowProps, useRowNav } from './useRowNav.js';
import { BLANK, duration, model, percent, tokens, when } from './format.js';
import { useWidth } from './useWidth.js';
import { Empty } from './ui/Empty.js';
import { GroupHeader } from './ui/GroupHeader.js';
import { TopBar } from './ui/TopBar.js';
import { Tooltip } from './ui/Tooltip.js';

/**
 * What a group's band says about the sessions under it.
 *
 * Counting worktrees separately matters: "3 sessions across 2 worktrees" is the
 * answer to where work came from, where "3 sessions" alone hides that half of
 * it happened on a branch checked out beside the repo.
 */
function summarise(group: SessionSummary[]): string {
  const total = group.reduce((n, s) => n + totalNewTokens(s), 0);
  const active = group.reduce((n, s) => n + s.activeMs, 0);
  const trees = new Set(group.map((s) => s.project)).size;
  const parts = [
    `${String(group.length)} ${group.length === 1 ? 'session' : 'sessions'}`,
    ...(trees > 1 ? [`${String(trees)} worktrees`] : []),
    `${tokens(total)} new`,
    duration(active),
  ];
  return parts.join('  ·  ');
}

type SortKey =
  | 'name'
  | 'project'
  | 'when'
  | 'dur'
  | 'model'
  | 'prompts'
  | 'tools'
  | 'tokens'
  | 'cache'
  | 'allowance';

interface Column {
  key: SortKey;
  label: string;
  /** Narrowest layout this column survives into. */
  from: 'tiny' | 'narrow' | 'mid' | 'wide';
  align?: 'right';
}

/**
 * Columns, widest layout first. The design drops columns at 700 / 920 / 1180,
 * so each column records the narrowest layout it survives into rather than
 * every layout listing its own set.
 */
const COLUMNS: Column[] = [
  { key: 'name', label: 'Session', from: 'tiny' },
  { key: 'project', label: 'Project', from: 'narrow' },
  { key: 'when', label: 'When', from: 'mid' },
  { key: 'dur', label: 'Active', from: 'narrow', align: 'right' },
  { key: 'model', label: 'Model', from: 'mid' },
  { key: 'prompts', label: 'Prompts', from: 'wide', align: 'right' },
  { key: 'tools', label: 'Tools', from: 'wide', align: 'right' },
  { key: 'tokens', label: 'New tokens', from: 'tiny', align: 'right' },
  { key: 'cache', label: 'Cache', from: 'narrow', align: 'right' },
  { key: 'allowance', label: 'Allowance', from: 'mid', align: 'right' },
];

/** Column widths per layout, from the design's `srow` definitions. */
const WIDTHS: Record<string, string> = {
  tiny: 'minmax(100px,2fr) 78px',
  narrow: 'minmax(140px,2fr) 100px 62px 72px 66px',
  mid: 'minmax(150px,2fr) 108px 92px 62px 84px 78px 62px 78px',
  wide: 'minmax(180px,2fr) 112px 92px 62px 84px 62px 52px 84px 60px 76px',
};
const MIN_WIDTH: Record<string, string> = {
  tiny: '260px',
  narrow: '542px',
  mid: '680px',
  wide: '1008px',
};

const RANK = { tiny: 0, narrow: 1, mid: 2, wide: 3 } as const;

const VALUE: Record<SortKey, (s: SessionSummary) => string | number> = {
  name: (s) => s.name.toLowerCase(),
  project: (s) => s.project,
  when: (s) => s.startedAt,
  dur: (s) => s.activeMs,
  model: (s) => s.models[0] ?? '',
  prompts: (s) => s.prompts,
  tools: (s) => s.toolCalls,
  tokens: (s) => totalNewTokens(s),
  cache: (s) => cacheHitRate(s.usage) ?? -1,
  allowance: (s) => s.allowance ?? -1,
};

const running = (s: SessionSummary): number => (s.status === 'active' ? 1 : 0);

/** What the dot beside a Session name means, for a tooltip and a screen reader. */
const STATUS: Record<SessionStatus, string> = {
  active: 'Running',
  completed: 'Finished',
  interrupted: 'Interrupted',
};

const HINT: Partial<Record<SortKey, string>> = {
  allowance:
    'Measured from the usage endpoint. Blank for sessions recorded before this app was installed.',
  tokens:
    'Input, cache writes and output. Cache reads are excluded — every request re-reads the whole prefix.',
  dur: 'Time actually worked, excluding gaps over five minutes.',
};

export function Sessions({
  sessions,
  onOpen,
  grouped,
  onGrouped,
}: {
  sessions: SessionSummary[];
  onOpen: (s: SessionSummary) => void;
  grouped: boolean;
  onGrouped: (v: boolean) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>('when');
  const [asc, setAsc] = useState(false);
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [listRef, onListKeys] = useRowNav();
  const width = useWidth();

  const layout = width < 700 ? 'tiny' : width < 920 ? 'narrow' : width < 1180 ? 'mid' : 'wide';
  const columns = COLUMNS.filter((c) => RANK[c.from] <= RANK[layout]);
  const grid = { gridTemplateColumns: WIDTHS[layout]!, minWidth: MIN_WIDTH[layout]! };

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? sessions.filter(
          (s) => s.name.toLowerCase().includes(q) || s.project.toLowerCase().includes(q),
        )
      : sessions;
    const dir = asc ? 1 : -1;
    return [...filtered].sort((a, b) => {
      // A running Session has no start date that reflects it. `when` sorts on
      // when a Session began, so one opened on Monday and still going sorts
      // below one that finished an hour ago - which is backwards for the
      // question the column answers. Under newest-first they come to the top.
      if (sortKey === 'when') {
        const rank = running(a) - running(b);
        if (rank !== 0) return rank * dir;
      }
      const x = VALUE[sortKey](a);
      const y = VALUE[sortKey](b);
      return x === y ? 0 : (x < y ? -1 : 1) * dir;
    });
  }, [sessions, sortKey, asc, query]);

  const groups = useMemo(() => groupBy(rows, (s) => s.repo), [rows]);

  const toggle = (key: string): void => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  };

  const sort = (key: SortKey): void => {
    if (key === sortKey) setAsc((v) => !v);
    else {
      setSortKey(key);
      // Text reads best A–Z; figures read best largest-first.
      setAsc(key === 'name' || key === 'project' || key === 'model');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
      <TopBar title="Sessions" count={rows.length}>
        <button
          className="ghost-button"
          aria-pressed={grouped}
          onClick={() => {
            onGrouped(!grouped);
          }}
          style={{ marginLeft: 'auto' }}
        >
          {grouped ? 'Grouped by project' : 'Group by project'}
        </button>
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
          placeholder="Filter sessions…"
          spellCheck={false}
          style={{
            width: 300,
            height: 26,
            padding: '0 9px',
            fontSize: 12,
            border: '1px solid var(--line)',
            borderRadius: 5,
            background: 'var(--bg)',
            color: 'var(--fg)',
          }}
        />
      </TopBar>

      <div style={{ overflow: 'auto', minHeight: 0, flex: 1 }} ref={listRef} onKeyDown={onListKeys}>
        <div className="thead" style={grid}>
          {columns.map((c) => (
            <Tooltip key={c.key} text={HINT[c.key]}>
              <div
                onClick={() => {
                  sort(c.key);
                }}
                className="ellipsis"
                style={{
                  textAlign: c.align ?? 'left',
                  color: sortKey === c.key ? 'var(--dim)' : 'inherit',
                }}
              >
                {c.label}
                {sortKey === c.key && (
                  <span style={{ color: 'var(--accent)' }}>{asc ? ' ↑' : ' ↓'}</span>
                )}
              </div>
            </Tooltip>
          ))}
        </div>

        {!grouped &&
          rows.map((s) => (
            <Row
              key={s.id}
              session={s}
              columns={columns}
              grid={grid}
              onOpen={() => {
                onOpen(s);
              }}
            />
          ))}

        {grouped &&
          groups.map((g) => (
            <Fragment key={g.key}>
              <GroupHeader
                name={g.key}
                meta={summarise(g.items)}
                collapsed={collapsed.has(g.key)}
                onToggle={() => {
                  toggle(g.key);
                }}
              />
              {!collapsed.has(g.key) &&
                g.items.map((s) => (
                  <Row
                    key={s.id}
                    session={s}
                    columns={columns}
                    grid={grid}
                    onOpen={() => {
                      onOpen(s);
                    }}
                  />
                ))}
            </Fragment>
          ))}

        {rows.length === 0 && (
          <Empty>
            {sessions.length === 0 ? 'No transcripts found.' : 'Nothing matches that filter.'}
          </Empty>
        )}
      </div>
    </div>
  );
}

function Row({
  session: s,
  columns,
  grid,
  onOpen,
}: {
  session: SessionSummary;
  columns: Column[];
  grid: React.CSSProperties;
  onOpen: () => void;
}) {
  const hit = cacheHitRate(s.usage);

  const cell: Record<SortKey, React.ReactNode> = {
    name: (
      <div
        className="ellipsis"
        style={{ display: 'flex', alignItems: 'center', gap: 7, paddingRight: 10 }}
      >
        <span className="status-dot" data-status={s.status} title={STATUS[s.status]} />
        <span className="ellipsis">{s.name}</span>
      </div>
    ),
    project: (
      <div
        className="mono ellipsis"
        style={{ fontSize: 11.5, color: 'var(--dim)', paddingRight: 10 }}
      >
        {s.project}
      </div>
    ),
    when: (
      <div className="ellipsis" style={{ fontSize: 11.5, color: 'var(--dim)' }}>
        {when(s.startedAt)}
      </div>
    ),
    dur: <div className="num">{duration(s.activeMs)}</div>,
    model: (
      <div className="mono ellipsis" style={{ fontSize: 11, color: 'var(--dim)' }}>
        {s.models[0] ? model(s.models[0]) : BLANK}
        {s.models.length > 1 && (
          <span style={{ color: 'var(--faint)' }}> +{s.models.length - 1}</span>
        )}
      </div>
    ),
    prompts: <div className="num">{s.prompts}</div>,
    tools: <div className="num">{s.toolCalls}</div>,
    tokens: (
      <div className="num" style={{ color: 'var(--fg)' }}>
        {tokens(totalNewTokens(s))}
        {/*
          Subagents have their own context windows, so their cost is real,
          separate, and invisible unless it is said out loud. A row showing only
          its own work understates the heaviest session here five-fold.
        */}
        {newTokens(s.subagentUsage) > 0 && (
          <span
            className="mono"
            style={{ color: 'var(--faint)', fontSize: 10.5, marginLeft: 5 }}
            title={`${tokens(newTokens(s.usage))} in this session, ${tokens(
              newTokens(s.subagentUsage),
            )} across ${String(s.subagents)} subagents`}
          >
            +{tokens(newTokens(s.subagentUsage))}
          </span>
        )}
      </div>
    ),
    cache: (
      <div
        className="num"
        style={{ color: hit !== null && hit < 0.5 ? 'var(--err)' : 'var(--dim)' }}
      >
        {percent(hit)}
      </div>
    ),
    // Blank, never reconstructed.
    allowance: (
      <div
        className={s.allowance === null ? 'num blank' : 'num'}
        style={s.allowance === null ? {} : { color: 'var(--accent)' }}
        title={
          s.allowanceShared
            ? 'Shared with another session running at the same time. Correct for each; do not add them together.'
            : ''
        }
      >
        {s.allowance === null ? BLANK : `+${s.allowance}%`}
        {s.allowanceShared && <span style={{ color: 'var(--faint)' }}> ⊕</span>}
      </div>
    ),
  };

  return (
    <div className="trow" style={grid} {...rowProps(onOpen)}>
      {columns.map((c) => (
        <div key={c.key} style={{ minWidth: 0 }}>
          {cell[c.key]}
        </div>
      ))}
    </div>
  );
}
