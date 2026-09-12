import { useMemo, useState } from 'react';
import { cacheHitRate, newTokens, type SessionSummary } from '../shared/model.js';
import { BLANK, duration, model, percent, tokens, when } from './format.js';
import { useWidth } from './useWidth.js';
import { Empty } from './ui/Empty.js';
import { TopBar } from './ui/TopBar.js';
import { Tooltip } from './ui/Tooltip.js';

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
  tokens: (s) => newTokens(s.usage),
  cache: (s) => cacheHitRate(s.usage) ?? -1,
  allowance: (s) => s.allowance ?? -1,
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
}: {
  sessions: SessionSummary[];
  onOpen: (s: SessionSummary) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>('when');
  const [asc, setAsc] = useState(false);
  const [query, setQuery] = useState('');
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
      const x = VALUE[sortKey](a);
      const y = VALUE[sortKey](b);
      return x === y ? 0 : (x < y ? -1 : 1) * dir;
    });
  }, [sessions, sortKey, asc, query]);

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
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
          placeholder="Filter sessions…"
          spellCheck={false}
          style={{
            marginLeft: 'auto',
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

      <div style={{ overflow: 'auto', minHeight: 0, flex: 1 }}>
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

        {rows.map((s) => (
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
        {s.status === 'active' && (
          <span style={{ color: 'var(--live)', fontSize: 9, flex: 'none' }}>●</span>
        )}
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
    dur: (
      <div className="num" title={`Spans ${duration(s.spanMs)} including idle`}>
        {duration(s.activeMs)}
      </div>
    ),
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
        {tokens(newTokens(s.usage))}
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
    <div className="trow" style={grid} onClick={onOpen}>
      {columns.map((c) => (
        <div key={c.key} style={{ minWidth: 0 }}>
          {cell[c.key]}
        </div>
      ))}
    </div>
  );
}
